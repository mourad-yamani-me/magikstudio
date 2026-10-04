# Magikstudio

English-language website for Magikstudio, an independent casual game studio.
Built with static HTML, local fonts, CSS animations, and lightweight JavaScript.

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Preview: http://localhost:4321. Use `PORT=5173 npm run dev` for port 5173.
After editing, run `npm run build` and reload the browser.

## Checks

```sh
npm run check
```

Builds the site and checks page structure, links, assets, metadata, accessibility
attributes, legal draft status, and App Store links.

## Project structure

- `src/magikstudio/config.mjs`: studio details and game information.
- `src/magikstudio/site.mjs`: page templates and shared components.
- `src/magikstudio/styles.css`: shared layouts.
- `src/magikstudio/casual.css`: casual theme and playful animations.
- `src/magikstudio/app.js`: navigation, motion controls, stars, and email copying.
- `src/magikstudio/legal.mjs`: privacy policy, terms, and legal notice.
- `public/assets/`: local fonts and studio illustrations.
- `scripts/build-magikstudio.mjs`: generates `dist/`.
- `scripts/verify-magikstudio.mjs`: validates the generated site.
- `docs/design/`: visual explorations, prompts, and previews.

## Games and legal information

The first game is a placeholder requested by the studio. Its name, screenshots,
and release details are not yet announced. Add an official HTTPS `apps.apple.com`
URL in `config.mjs` to enable the App Store link. Current artwork is studio concept
art, not gameplay imagery.

Privacy, terms, and legal notice remain working drafts marked `noindex`.
Complete the legal entity, address, jurisdiction, hosting, retention periods,
and contact details before production publication.

## GitHub and Cloudflare

Repository: https://github.com/mourad-yamani-me/magikstudio

GitHub Actions runs `npm ci` and `npm run check` on pushes and pull requests.
Cloudflare deployment is a separate manual action named **Deploy Magikstudio**.
It requires GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
The Worker configuration targets `magikstudio.me` and `www.magikstudio.me` and
serves `dist/`. Run the deployment workflow only when ready to publish.
Do not enable a second deployment pipeline in Cloudflare.

## Credits

Fonts: Bricolage Grotesque and Plus Jakarta Sans, served locally.
Studio concept illustrations were created with an image-generation tool;
see `docs/design/IMAGE-PROMPT.md` for prompts and asset details.
