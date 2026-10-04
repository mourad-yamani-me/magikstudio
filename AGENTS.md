# Working on Magikstudio

- Run `npm run check` before pushing.
- Work on a feature or maintenance branch; do not commit directly to `main`.
- Stage explicit paths, never `git add .` or `git add -A`.
- Preserve unrelated user changes.
- Use `src/magikstudio/` for the site and `public/assets/` for local assets.
- Keep user-facing copy in English and the visual direction casual and playful.
- Every image needs descriptive alt text. Decorative SVG icons use `aria-hidden`.
- Respect reduced-motion preferences and keep the animation pause control usable.
- Keep unpublished games clearly marked and never invent App Store URLs.
- Legal documents are drafts until the studio confirms its legal information.
- Deployment must use GitHub Actions. Do not run `wrangler deploy` locally.
- Never change email-related MX or TXT records.
- Never commit credentials or local private keys.
