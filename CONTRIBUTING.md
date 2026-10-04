# Contributing to Magikstudio

Use Node.js 22 or newer, then run `npm ci` and `npm run dev`.
Make changes on a feature or maintenance branch. Run `npm run check` before
pushing and stage only the relevant paths. Submit changes through a pull request
when a separate integration branch is available.

The build generates `dist/`; do not commit this directory. Keep browser code
compatible with the Content Security Policy: no inline scripts or styles.

Deployments are explicit GitHub Actions runs. Production credentials belong in
GitHub Secrets. See README.md for setup and the project structure.
