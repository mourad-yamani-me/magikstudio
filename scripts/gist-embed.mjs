/**
 * Resolving a `{{gist:…}}` embed to the text it stands for.
 *
 * Two things render these: the site build, which wraps the result in a
 * <figure> with a link into the gist, and scripts/devto.mjs, which needs a
 * plain fenced block because dev.to takes markdown. Only the rendering
 * differs, so only the rendering lives in those files — the part that decides
 * *which lines of which file* an embed means is here, once. Two copies of the
 * anchor logic would drift, and the copy that drifted would be the one nobody
 * runs before pushing.
 *
 *   {{gist:wrangler.jsonc}}          whole file
 *   {{gist:ci-cd.yml#head}}          everything above `jobs:`
 *   {{gist:ci-cd.yml#preview}}       one job, found by name
 *   {{gist:ci-cd.yml:64-92}}         explicit lines (fragile — prefer #anchors)
 *
 * Anchors are resolved from the YAML structure, so they survive edits above
 * them; line numbers do not.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
export const GIST_DIR = path.join(ROOT, 'gist');

export const GIST_RE = /\{\{gist:([^:#}]+)(?:#([\w-]+))?(?::(\d+)-(\d+))?\}\}/g;

export const gistAnchor = name => 'file-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const LANG = { '.jsonc': 'json', '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.md': 'markdown', '.mjs': 'javascript', '.js': 'javascript', '.gradle': 'groovy', '.pro': 'properties' };

/* gist/ holds one subdirectory per published gist. An embed may name the file
   alone — `verify.mjs` — and it is found wherever it lives, so posts don't
   have to know which gist a file ended up in. A `dir/file` path also works.
   Ambiguity is an error rather than a coin toss. */
export function resolveGistFile(name, postFile) {
  const direct = path.join(GIST_DIR, name);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;

  const hits = fs.readdirSync(GIST_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(GIST_DIR, e.name, name))
    .filter(f => fs.existsSync(f));

  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const where = hits.map(h => path.relative(GIST_DIR, h)).join(', ');
    throw new Error(`${postFile}: {{gist:${name}}} — ambiguous, matches ${where}. Qualify it with the directory.`);
  }
  throw new Error(`${postFile}: {{gist:${name}}} — no such file under gist/`);
}

/** One embed → the file's basename, the lines it selects, a caption note and a fence language. */
export function resolveGistEmbed(name, anchor, from, to, postFile) {
  const file = resolveGistFile(name.trim(), postFile);
  const base = path.basename(name.trim());
  let content = fs.readFileSync(file, 'utf8').replace(/\s+$/, '');
  let note = '';

  if (anchor) {
    const lines = content.split('\n');
    if (anchor === 'head') {
      const j = lines.findIndex(l => /^jobs:\s*$/.test(l));
      if (j < 0) throw new Error(`${postFile}: {{gist:${name}#head}} — no top-level "jobs:" key found`);
      content = lines.slice(0, j).join('\n').replace(/\s+$/, '');
      note = ' — triggers and permissions';
    } else {
      // find `  <anchor>:` and take everything until the next key at that indent
      const start = lines.findIndex(l => new RegExp(`^(\\s+)${anchor}:\\s*$`).test(l));
      if (start < 0) throw new Error(`${postFile}: {{gist:${name}#${anchor}}} — no "${anchor}:" key in ${path.relative(ROOT, file)}`);
      const indent = lines[start].match(/^\s*/)[0].length;
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.trim() === '' || l.startsWith(' '.repeat(indent + 1))) continue;
        if (/^\s*#/.test(l)) continue;
        end = i; break;
      }
      content = lines.slice(start, end).join('\n').replace(/\s+$/, '');
      note = ` — ${anchor} job`;
    }
  } else if (from) {
    const lines = content.split('\n');
    if (+to > lines.length) throw new Error(`${postFile}: {{gist:${name}:${from}-${to}}} — file has only ${lines.length} lines`);
    content = lines.slice(+from - 1, +to).join('\n');
    note = ` lines ${from}–${to}`;
  }

  return { base, content, note, lang: LANG[path.extname(base)] || '' };
}
