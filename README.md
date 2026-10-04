# Magikstudio

Site de studio de jeux vidéo, adapté du dépôt `oettaib/indie-core-dev`. La nouvelle version reprend sa génération statique Node, ses polices locales, son serveur de prévisualisation et ses principes de navigation et d’accessibilité.

## Développement

```sh
npm ci
npm run dev
```

Le serveur démarre sur http://localhost:4321. Pour l’aperçu de cette session :

```sh
PORT=5173 npm run dev
```

Après une modification : `npm run build`, puis recharger le navigateur. Ce serveur statique n’utilise pas de HMR.

## Vérifications

```sh
npm run check
```

Compile les pages Magikstudio, vérifie les liens, fichiers, métadonnées, états App Store, brouillons légaux et anciennes adresses de confidentialité, puis vérifie les extraits générés et les articles de référence conservés. Node 22 est utilisé pour le site ; le Lighthouse optionnel du dépôt nécessite Node 22.19 ou ultérieur.

## Sources

- `src/magikstudio/config.mjs` : identité, contact et jeux.
- `src/magikstudio/site.mjs` : pages et composants HTML.
- `src/magikstudio/styles.css` : identité visuelle et responsive.
- `src/magikstudio/app.js` : navigation mobile, animations et copie du contact.
- `src/magikstudio/legal.mjs` : confidentialité, CGU et mentions légales.
- `scripts/build-magikstudio.mjs` : génération de `dist/`.
- `scripts/verify-magikstudio.mjs` : contrôle de la version Magikstudio.
- `public/assets/magikstudio/play-world.jpg` : illustration originale d’ambiance.
- `docs/design/IMAGE-PROMPT.md` : méthode et prompt du visuel.

## Jeu provisoire

Le propriétaire a demandé un placeholder. Aucun nom, capture ni lien réel n’a été fourni. Le projet est donc présenté comme en développement, et les visuels sont explicitement des concepts du studio.

Renseigner le nom, la description, le statut et `appStoreUrl` dans `config.mjs`. Un lien HTTPS `apps.apple.com` transforme automatiquement l’état « À venir » en lien de téléchargement officiel.

## Pages et publication

Accueil `/`, studio `/about/`, contact `/contact/`, jeu `/games/prochain-jeu/`, confidentialité `/privacy/`, conditions `/terms/`, mentions légales `/legal/`.

Les pages légales sont des brouillons en `noindex`. L’identité juridique, le pays, le responsable de publication, les prestataires, les durées de conservation et le contact doivent être confirmés avant publication. La politique du futur jeu devra décrire ses données et SDK réels.

Le Worker de destination est nommé `magikstudio` et ses routes ciblent `magikstudio.me`. Aucun déploiement, changement DNS, push ou message externe n’a été effectué. Les automatisations GitHub de SEO et de publication sociale héritées du dépôt restent à adapter avant tout raccordement de production. Les déploiements doivent passer par GitHub Actions, conformément à `AGENTS.md`.

## Référence conservée

Le générateur original `build.mjs`, ses sources et ses contenus sont conservés. `npm run build:reference` et `npm run verify:reference` permettent de travailler sur cette version ; attention, elle écrit également dans `dist/`. Relancer `npm run build` pour revenir à Magikstudio.

Les politiques `/privacy/<ancien-jeu>/` et leurs redirections Blogger sont préservées et attribuées à l’éditeur d’origine. Elles ne constituent pas le catalogue Magikstudio. Les anciennes adresses de newsletter restent accessibles, avec un état inactif et aucun formulaire relié au compte d’origine.

Voir `docs/REFERENCE-README.md` pour la documentation historique. Références utilisées pour les brouillons légaux : [CNIL — Informer les personnes](https://www.cnil.fr/fr/informer-les-personnes).

### Direction visuelle actuelle

Le thème casual est dans `src/magikstudio/casual.css`, assemblé après les styles partagés. L’illustration est `public/assets/magikstudio/casual-world.jpg`. Les anciens visuels sont conservés comme variantes ; ils ne sont plus référencés par les pages. Voir `docs/design/IMAGE-PROMPT.md` pour la provenance et `docs/design/preview-casual.jpg` pour l’aperçu.
