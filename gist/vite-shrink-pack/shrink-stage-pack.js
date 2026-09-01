// Shrink a content pack on its way into dist/.
//
// The level files come out of the generator pretty-printed, and they should:
// they are reviewed in pull requests, diffed when the generator changes, and
// read by hand when a level plays wrong. But nothing reads that whitespace at
// runtime, and it is 45% of the pack — 4.37 MB down to 2.36 MB.
//
// This runs over dist/, never over public/, so the repo copies stay diffable
// and the shipped copies are one line each.
//
// TWO THINGS THAT LOOK LIKE DETAILS AND ARE NOT:
//
// 1. `writeBundle`, not `closeBundle`. closeBundle ALSO fires when the build
//    failed, so a cleanup hook there will throw its own ENOENT about a dist/
//    that was never created — and replace the real error with it. Vite copies
//    publicDir into outDir *before* the write phase, so at writeBundle the
//    files are already there.
//
// 2. outDir comes from `configResolved`, not `import.meta`. Vite may load a
//    config from a temp file elsewhere on disk, which makes import.meta.dirname
//    point at node_modules/.vite-temp/.

import { readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {{ content: { stagesDir: string } }} brand
 *   Which folder to shrink is the game's to declare, not the plugin's to
 *   hardcode — otherwise every sibling game carries a copy of this plugin with
 *   its own folder name baked in.
 */
export const shrinkStagePack = (brand) => {
  let outDir = 'dist';
  return {
    name: 'shrink-stage-pack',
    apply: 'build',

    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },

    writeBundle() {
      // stagesDir is the URL the app fetches from ('/levels'), which is
      // publicDir-relative, so it lands at this path inside dist/.
      const dir = join(outDir, brand.content.stagesDir.replace(/^\//, ''));
      let before = 0;
      let after = 0;

      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const path = join(dir, file);
        before += statSync(path).size;

        // The generator's own build record. The game only ever fetches the
        // catalogue and individual levels — worth grepping for before you
        // delete anything from a content folder.
        if (file === 'index.json') {
          rmSync(path);
          continue;
        }

        const min = JSON.stringify(JSON.parse(readFileSync(path, 'utf8')));
        writeFileSync(path, min);
        after += min.length;
      }

      // Printed on every build. This line is how a pack rebuild that quietly
      // shipped 30 extra levels got noticed months later. A number printed on
      // every build is a regression test that costs nothing.
      const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
      this.info(`stage pack ${mb(before)} -> ${mb(after)}`);
    },
  };
};
