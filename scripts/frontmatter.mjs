/**
 * The frontmatter parser the cross-posting scripts read posts with.
 *
 * It is a second implementation of the one inside build.mjs, on purpose: a
 * script has to read a post without importing the site build. That means a
 * frontmatter shape added there has to be taught here too, or a cross-post
 * silently drops it — which is why this lives in one module rather than once
 * per script. It was a copy in devto.mjs alone until linkedin.mjs needed the
 * same thing, and two copies drift where one cannot.
 */

/** @returns {{meta: Record<string, unknown>, body: string} | null} */
export function frontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim().replace(/^["']|["']$/g, '');
    // Block lists (`changes:`, then `  - ` items).
    if (v === '' && /^\s+-\s/.test(lines[i + 1] || '')) {
      const items = [];
      while (/^\s+-\s/.test(lines[i + 1] || ''))
        items.push(lines[++i].replace(/^\s+-\s+/, '').trim());
      meta[k] = items;
      continue;
    }
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[k] = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else if (v === 'true' || v === 'false') {
      meta[k] = v === 'true';
    } else meta[k] = v;
  }
  return { meta, body: m[2] };
}
