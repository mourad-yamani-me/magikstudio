# Working on this site

## Branching

`main` is always deployable and is what production serves. Never commit to it directly.

```
main ──●─────────●─────────●──►  production (indiecore.net)
        \       /         /
         ●─────●         /       feat/games-page  → preview URL
                        /
                 ●─────●         fix/privacy-typo → preview URL
```

Branch names: `feat/…`, `fix/…`, `content/…`, `chore/…`.

```bash
git switch main && git pull
git switch -c feat/short-description
# ...work...
npm run check          # build + verify, same gate CI runs
git push -u origin feat/short-description
```

Open a PR. CI builds, verifies, runs the Lighthouse budget, and posts a preview URL.
Merge with **squash** once checks are green. Production deploys automatically from `main`.

## Local commands

| Command | What it does |
| --- | --- |
| `npm run build` | Generate `dist/` |
| `npm run verify` | Fail on dead links, missing images, bad meta, broken redirects |
| `npm run check` | `build` + `verify` — run this before pushing |
| `npm run serve` | Serve `dist/` at :4321 with brotli, cache headers and redirects |
| `npm run dev` | `build` + `serve` |
| `npm run lighthouse` | Run the performance/a11y/SEO budget |
| `npm run style` | Flag prose that reads as machine-written (advisory) |

## Content changes

Game copy, features and routes live in the `GAMES` array in `build.mjs`.
Privacy policy text is parsed from `_source/legacy/*.txt` — edit those files to change a policy.
Store metadata (descriptions, category, updated date) lives in `_source/play-data.json`.

## Regenerating assets

These need tools CI does not have, so their output is committed:

```bash
npm run assets:og      # social preview images  (needs Chrome + ImageMagick)
npm run assets:fonts   # subset the webfonts     (needs Python + fontTools)
```

Commit whatever they change under `public/assets/`.
