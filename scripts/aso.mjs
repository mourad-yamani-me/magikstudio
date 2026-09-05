#!/usr/bin/env node
/**
 * The winnable-keywords report: which Google Play search terms a small studio
 * can actually take, and which ones it cannot.
 *
 *   npm run aso                          what to publish next, ranked
 *   npm run aso -- --harvest <category>  build one issue's data snapshot
 *   npm run aso -- --categories          the categories this can report on
 *
 * WHY THIS IS LOCAL-ONLY, AND WHY THE SNAPSHOT IS COMMITTED
 *
 * The numbers come from the ideaminer analytics database, which lives in a
 * Docker container on the machine that crawls Play. CI has no route to it and
 * never will — so a build that queried it would work on a laptop and fail on
 * the runner, which is the one failure mode that makes a check worthless.
 * Instead this script runs by hand, writes _source/aso/<slug>.json, and that
 * file is committed with the issue that reads it. The build only ever reads the
 * JSON. Same shape as `npm run keywords`: a drafting tool, not a gate.
 *
 * It is strictly read-only against the database. It opens no transaction, holds
 * no lock worth the name, and writes nothing back — the analytics app can be
 * mid-refresh while this runs and neither will notice the other.
 *
 * WHAT THE REPORT CLAIMS
 *
 * Every ASO tool sells search volume. Volume is the easy half and the useless
 * half: "puzzles" has enormous demand and is held by a 100M-install app that
 * has been there for years. The number that decides whether to spend a week on
 * a term is who is standing on it — big_dev_slots, title_matches,
 * mature_leaders, oldest_leader_days — and that comes out of observed rankings
 * rather than a model. So each issue prints both halves: the terms that are
 * open, and the demand in the same category that is not, with the app holding
 * it named.
 *
 * WHAT IT DOES NOT CLAIM
 *
 * The gate proposes; a person keeps. Roughly a third of what survives every
 * filter below is still a phrase no studio should chase — a passing meme, a
 * mistranslation, something off-theme. That is why the JSON carries more rows
 * than an issue publishes and why _source/aso/exclude.txt exists. Shipping the
 * raw query output as an article would be the same mistake as trusting search
 * volume alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HARVEST_SQL, BRAND_MIN_DF, DEMAND_FLOOR, MAX_BIG_DEV_SLOTS, MAX_TITLE_MATCHES } from './aso-sql.mjs';
import { rankgrip, bandFor, WEIGHTS } from './rankgrip.mjs';

const ROOT     = path.resolve(import.meta.dirname, '..');
const SNAP_DIR = path.join(ROOT, '_source/aso');
const ASO_DIR  = path.join(ROOT, 'content/aso');
const EXCLUDE  = path.join(SNAP_DIR, 'exclude.txt');

/* The database is addressed through the container rather than a connection
   string: it is bound to a host port that changes with the compose file, and
   the container name has not. Both are overridable for the same reason. */
const CONTAINER = process.env.ASO_DB_CONTAINER || 'ideaminer-analytics-db';
const DB        = process.env.ASO_DB_NAME      || 'analytics_dev';
const DB_USER   = process.env.ASO_DB_USER      || 'ideaminer';

/* The categories worth an issue, with the name a reader would use. Play's own
   labels ("game_puzzle") are not what anybody searches or says out loud.

   This list is deliberately short, and it got shorter on purpose. Six
   categories at one issue a month is 72 pages a year; fourteen would have been
   168, and a series of near-identical pages that differ only in their table is
   the shape Google's scaled-content-abuse policy describes. Six also means
   every entry is a category with the depth to carry an issue every month —
   `--categories` measures what is actually there.

   Games only, and reviewed against the data rather than assumed. The app
   categories are all deeper than the game ones — tools carries 133k keywords
   against game_puzzle's 52k — so the limit here is not supply. This studio
   ships puzzle games, and an issue about productivity apps would be a report
   nobody here can add a sentence of real judgement to.

   Two things to check before ever adding one:

   1. Adding another GAME category makes the overlap worse, not better. Games
      are cross-listed, so their keyword sets already share heavily: across the
      six August issues, 99 of 196 unique keywords appear in more than one, and
      Word games came out 89% shared with Casual. App categories do not have
      that problem — a productivity keyword set has almost nothing in common
      with a puzzle one — so they are the honest direction if this list grows.

   2. The category strings in the data are NOT normalised, and picking the
      wrong variant silently halves the sample with nothing to warn you:

        health_and_fitness  48,105     health_fitness  26,761
        game_simulation     42,334     simulation      23,276

      Count both before choosing, and if a category has two spellings the
      query needs both rather than the larger one. */
export const CATEGORIES = {
  game_puzzle:     { label: 'Puzzle games',     slug: 'puzzle-games' },
  game_casual:     { label: 'Casual games',     slug: 'casual-games' },
  game_arcade:     { label: 'Arcade games',     slug: 'arcade-games' },
  game_word:       { label: 'Word games',       slug: 'word-games' },
  game_simulation: { label: 'Simulation games', slug: 'simulation-games' },
  game_board:      { label: 'Board games',      slug: 'board-games' },
};

const argv = process.argv.slice(2);
const has  = f => argv.includes(f);
const opt  = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  /* -1 + 1 is 0, which would read the first argument as the value — the shape
     that bit `--only` in devto.mjs and `--claim` in schedule.mjs. */
  return !v || v.startsWith('--') ? dflt : v;
};

/* ───────── the database ───────── */

/** Runs one read-only statement and returns stdout. Throws with psql's own
    message, which names the column or relation — worth more than a wrapper. */
function psql(sql, vars = {}) {
  const args = ['exec', '-i', CONTAINER, 'psql', '-U', DB_USER, '-d', DB, '-t', '-A', '--no-psqlrc'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  args.push('-f', '-');
  try {
    return execFileSync('docker', args, { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const detail = (e.stderr || e.stdout || e.message).toString().trim();
    throw new Error(
      `psql failed against ${CONTAINER}/${DB}.\n${detail}\n\n` +
      `Is the analytics stack up? \`docker ps | grep ${CONTAINER}\`. ` +
      `Override with ASO_DB_CONTAINER / ASO_DB_NAME / ASO_DB_USER.`);
  }
}

/* ───────── the editorial layer ───────── */

/** Terms a person has struck off, one per line, `#` comments ignored.

    This file is not a failure of the query. The gate can prove a phrase is
    searched and unheld; it cannot know that it is a film title, a fad three
    weeks from over, or something a studio would rather not rank for. That
    judgement is a person's, and it has to be recorded somewhere the next
    month's issue also reads. */
const excluded = () => new Set(
  (fs.existsSync(EXCLUDE) ? fs.readFileSync(EXCLUDE, 'utf8') : '')
    .split('\n').map(l => l.replace(/#.*$/, '').trim().toLowerCase()).filter(Boolean));

/** The phrase reduced to its distinct words, sorted — the identity used to
    collapse rewordings. "ai girlfriend puzzle game", "ai girlfriend game
    puzzle" and "ai girl puzzle game" are one row on the page, not three, and
    "blocks love blocks love blocks" stops being a row at all. */
const shape = kw => [...new Set(kw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))].sort().join(' ');

function dedupe(rows) {
  const seen = new Map();
  for (const r of rows) {           // already ordered by demand, so first wins
    const k = shape(r.keyword);
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()];
}

/* ───────── harvest ───────── */

/* The slug leads with the phrase people type. Google's own autocomplete returns
   nothing at all for "winnable keyword" — it is a coined term, good for saying
   what the report is and useless for being found. "google play keyword research"
   and "play store keyword research" are the live queries; the category and the
   month are what keep 300 of these pages from competing with each other. */
export const issueSlug = (cat, month) => `google-play-keywords-${CATEGORIES[cat].slug}-${month}`;

/** The month an issue covers: the one that just ended, in UTC. An issue built
    on the 3rd reports on a month with data in it, not on three days. */
export function reportMonth(today = new Date().toISOString().slice(0, 10)) {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function harvest(cat, { country = 'us', lang = 'en', month = reportMonth() } = {}) {
  if (!CATEGORIES[cat]) {
    throw new Error(
      `unknown category "${cat}". Known: ${Object.keys(CATEGORIES).join(', ')}\n` +
      `Add it to CATEGORIES in scripts/aso.mjs if the data supports it — \`npm run aso -- --categories\`.`);
  }
  /* First day of the month after the one being reported on — the exclusive
     bound the query cuts at, so an issue can never contain data from after the
     month on its cover. */
  const [my, mm] = month.split('-').map(Number);
  const monthEnd = mm === 12 ? `${my + 1}-01-01` : `${my}-${String(mm + 1).padStart(2, '0')}-01`;
  const raw = psql(HARVEST_SQL, { cat, country, lang, month_end: monthEnd }).trim();
  if (!raw) throw new Error(`no rows for ${cat} — the query returned nothing at all.`);
  const data = JSON.parse(raw);

  const skip = excluded();
  const keep = r => !skip.has(r.keyword.toLowerCase());
  /* Rankgrip is written into the snapshot rather than computed at render time.
     The weights are the argument the series rests on, so a published report has
     to keep meaning what it meant on the day it was published — if they are ever
     retuned, old issues keep their old numbers instead of silently restating
     themselves. */
  const score = r => { const g = rankgrip(r); return { ...r, rankgrip: g.score, rankgripBand: g.band, rankgripMeasured: g.measured }; };
  const proposed = data.winnable || [];
  const kept     = proposed.filter(keep);
  const winnable = dedupe(kept).map(score);
  const wall     = (data.wall || []).filter(keep).map(score);

  return {
    /* Stamped so a stale snapshot is visible in the diff rather than only in
       the numbers. verify.mjs reads `month` and `generatedAt`. */
    slug: issueSlug(cat, month),
    month,
    category: cat,
    categoryLabel: CATEGORIES[cat].label,
    /* The archive route for this category, so build.mjs never has to map a
       Play category name onto a URL of its own. */
    categorySlug: CATEGORIES[cat].slug,
    country, language: lang,
    generatedAt: new Date().toISOString(),
    window: data.window,
    rankgrip: { weights: WEIGHTS },
    gate: {
      demandFloor: DEMAND_FLOOR,
      maxBigDevSlots: MAX_BIG_DEV_SLOTS,
      maxTitleMatches: MAX_TITLE_MATCHES,
      brandMinDf: BRAND_MIN_DF,
    },
    counts: {
      ...data.counts,
      published: winnable.length,
      /* Struck off by hand and collapsed as rewordings are two different
         things, and `excluded` used to be measured against the post-dedupe
         list — so it silently included the collapsed rows and the page
         published the sum as "N were struck off by hand". The three numbers
         have to add up to the total, because the method paragraph prints them
         as an account of what happened to the gate's output. */
      excluded: proposed.length - kept.length,
      collapsed: kept.length - winnable.length,
    },
    winnable, wall,
  };
}

/* ───────── the picker ───────── */

/* What an issue is worth publishing on, measured rather than guessed: how many
   terms survive the gate in each category, and whether this month's issue for
   it already exists. Ordered by depth, because a thin issue is the one that
   makes a reader stop trusting the series. */
function categoryDepth() {
  const cats = Object.keys(CATEGORIES);
  const sql = `
    with c(cat) as (values ${cats.map(c => `('${c}')`).join(',')})
    select json_agg(json_build_object('category', c.cat, 'keywords', (
      select count(*) from (
        select krc.keyword from keyword_rank_changes krc
        join apps a on a.app_id = krc.app_id
        where krc.country = 'us' and krc.rank <= 10 and a.category = c.cat
        group by 1) k)))
    from c;`;
  return JSON.parse(psql(sql).trim() || '[]');
}

const existing = () => new Set(
  (fs.existsSync(SNAP_DIR) ? fs.readdirSync(SNAP_DIR) : [])
    .filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')));

function pick() {
  const month = reportMonth();
  const have  = existing();
  const depth = categoryDepth().sort((a, b) => b.keywords - a.keywords);

  console.log(`\n  Winnable-keywords issues — reporting month ${month}\n`);
  console.log('  ' + 'category'.padEnd(22) + 'keywords'.padStart(10) + '   this month');
  console.log('  ' + '─'.repeat(50));
  for (const d of depth) {
    const slug = issueSlug(d.category, month);
    const done = have.has(slug);
    console.log('  ' + CATEGORIES[d.category].label.padEnd(22) +
      String(d.keywords).padStart(10) + '   ' + (done ? 'published' : '—'));
  }
  const next = depth.find(d => !have.has(issueSlug(d.category, month)));
  if (next) {
    console.log(`\n  next:  npm run aso -- --harvest ${next.category}\n`);
    console.log(`  then write content/aso/${issueSlug(next.category, month)}.md ` +
      `from content/aso/_template.md\n`);
  } else {
    console.log(`\n  every category has an issue for ${month} — nothing to do.\n`);
  }
}

/* ───────── cli ───────── */

function main() {
  if (has('--categories')) {
    for (const d of categoryDepth().sort((a, b) => b.keywords - a.keywords))
      console.log(`  ${d.category.padEnd(22)} ${String(d.keywords).padStart(8)} keywords`);
    return;
  }
  const cat = opt('harvest');
  if (cat) {
    const month = opt('month', reportMonth());
    const data  = harvest(cat, { month, country: opt('country', 'us'), lang: opt('lang', 'en') });
    const file  = path.join(SNAP_DIR, `${data.slug}.json`);
    if (has('--dry-run')) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    console.log(`\n  wrote _source/aso/${data.slug}.json`);
    console.log(`  ${data.counts.winnable} passed the gate, ${data.counts.collapsed} collapsed as rewordings, ` +
      `${data.counts.excluded} struck off — ${data.counts.published} rows on the page.`);
    console.log(`  ${data.wall.length} terms on the wall.`);
    const gs = data.winnable.map(r => r.rankgrip).sort((a, b) => a - b);
    if (gs.length) console.log(
      `  Rankgrip ${gs[0]}–${gs.at(-1)}, median ${gs[Math.floor(gs.length / 2)]} ` +
      `(${data.winnable.filter(r => r.rankgripBand === 'open').length} open, ` +
      `${data.winnable.filter(r => r.rankgripBand === 'tight').length} tight)\n`);
    console.log(`  next: content/aso/${data.slug}.md, from content/aso/_template.md\n`);
    return;
  }
  if (has('--harvest')) {
    console.error('usage: npm run aso -- --harvest <category>   (see --categories)');
    process.exit(1);
  }
  pick();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); }
  catch (e) { console.error(`\n  ${e.message}\n`); process.exit(1); }
}
