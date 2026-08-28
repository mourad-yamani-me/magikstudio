#!/usr/bin/env node
/**
 * Style check — flags the patterns that make prose read as machine-written.
 * Advisory by default; `--strict` exits non-zero so CI can gate on it.
 *
 * Thresholds are calibrated against the posts already published here, not
 * against a generic "AI writing" list. Em dashes are a good example: this site
 * runs about 10 per 1000 words and always has, so flagging them at the usual
 * threshold would just tell you to stop sounding like yourself. What actually
 * reads as generated is *formula* — the same rhetorical move at a regular
 * interval — so that is what this measures.
 *
 * Pure Node, no dependencies. `npm run style`
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '..', 'content', 'blog');
const STRICT = process.argv.includes('--strict');
const DRAFTS = process.argv.includes('--drafts');   // drafts are skipped unless asked for

/** per 1000 words unless noted. Above HI (or below LO) gets flagged. */
const LIMITS = {
  emDash:     { hi: 15,  label: 'em dashes',            note: 'house style is ~10/1k — only a spike matters' },
  antithesis: { hi: 2.5, label: '"not X, it\'s Y"',     note: 'the single most recognisable LLM cadence' },
  aiVocab:    { hi: 1.0, label: 'AI-flavoured words',   note: 'delve, leverage, crucial, ecosystem, …' },
  formula:    { hi: 3.0, label: 'filler formulas',      note: '"that\'s the point", "which is why", …' },
};
/** share of sections carrying a bolded claim. Posts here sit around 0.5; a
 *  bolded thesis in nearly every section is formula rather than emphasis. */
const MAX_BOLD_RHYTHM = 0.7;
const MIN_BURSTINESS = 5;   // stdev of sentence length; detectors flag below 4

const PATTERNS = {
  emDash:     /—/g,
  antithesis: /\b(?:not|isn'?t|wasn'?t|aren'?t)\b[^.?!]{2,60}?\b(?:it'?s|but|it is)\b/gi,
  aiVocab:    /\b(?:delve|leverage|crucial|robust|seamless|underscor\w+|moreover|furthermore|ecosystem|landscape|tapestry|realm|holistic|pivotal|myriad|testament|utilise|utilize)\b/gi,
  formula:    /(?:that'?s the (?:point|whole|idea)|the (?:tell|thing) is|which is why|it'?s worth noting|at the end of the day|in today'?s|when it comes to|the key (?:is|takeaway))/gi,
};

const mean = a => a.reduce((s, n) => s + n, 0) / a.length;
const stdev = a => a.length < 2 ? 0 : Math.sqrt(mean(a.map(n => (n - mean(a)) ** 2)));

/** prose only: drop frontmatter, fenced code, tables, headings, list markers */
const prose = src => src
  .replace(/^---\n[\s\S]*?\n---\n/, '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/^\|.*$/gm, ' ')
  .replace(/^\s*[>#*\-\d]+\.?\s*/gm, '');

const sentences = t => t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)
  .map(s => s.trim()).filter(s => s.split(' ').length > 2);

const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md');

let flagged = 0;

for (const f of files.sort()) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  if (/^draft:\s*true/m.test(src) && !DRAFTS) continue;

  const body  = prose(src);
  const words = body.split(/\s+/).filter(Boolean).length;
  const lens  = sentences(body).map(s => s.split(' ').length);
  const burst = stdev(lens);

  const counts = Object.fromEntries(
    Object.entries(PATTERNS).map(([k, re]) => [k, (body.match(re) || []).length]));
  // a bolded run of 5+ words is a claim; **term** is emphasis and fine
  const isClaim = t => t.split(/\s+/).length >= 5;
  const sections = src.split(/^## /m).slice(1);
  const withClaim = sections
    .filter(x => [...x.matchAll(/\*\*([^*]+)\*\*/g)].some(m => isClaim(m[1]))).length;
  const boldRhythm = sections.length ? withClaim / sections.length : 0;

  const notes = [];
  for (const [key, { hi, label, note }] of Object.entries(LIMITS)) {
    const per1k = counts[key] / words * 1000;
    if (per1k > hi) notes.push(`${label}: ${counts[key]} (${per1k.toFixed(1)} > ${hi}) — ${note}`);
  }
  if (boldRhythm > MAX_BOLD_RHYTHM)
    notes.push(`bolded claim in ${withClaim}/${sections.length} sections `
      + `(${boldRhythm.toFixed(2)} > ${MAX_BOLD_RHYTHM}) — emphasis on a schedule reads as formula`);
  if (burst < MIN_BURSTINESS)
    notes.push(`sentence-length stdev ${burst.toFixed(1)} < ${MIN_BURSTINESS} — vary the rhythm`);

  const head = `${f}  ${words}w  burstiness ${burst.toFixed(1)}`;
  if (!notes.length) { console.log(`  ok     ${head}`); continue; }
  flagged++;
  console.log(`  FLAG   ${head}`);
  for (const n of notes) console.log(`           ${n}`);
}

console.log(`\n${files.length} file(s) scanned, ${flagged} flagged.`);
if (flagged && STRICT) process.exit(1);
