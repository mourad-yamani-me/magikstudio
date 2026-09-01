// Drop the Firebase JS SDK from a native (Capacitor) build.
//
// Nothing in a Capacitor build can reach the firebase/* web SDK, yet it was
// ~730 KB of the shipped bundle. Two separate paths pulled it in:
//
//  1. Services pick a provider at runtime — Capacitor.isNativePlatform()
//     chooses the native plugin, otherwise the web SDK — but import BOTH arms
//     statically, so the bundler emits both.
//
//  2. Every @capacitor-firebase plugin registers a browser fallback as
//         registerPlugin('X', { web: () => import('./web').then(...) })
//     registerPlugin only calls that on a browser, but it is still a static
//     import site, so each of those web.js files drags in its slice of the web
//     SDK. This is where the 525 KB Firestore chunk and the 168 KB Auth chunk
//     were coming from — not from app code at all.
//
// With VITE_NATIVE=1 both resolve to stubs that throw. Nothing calls them, and
// if something ever does the message says why rather than failing somewhere
// inside a tree-shaken Firebase.
//
// Main chunk 909 KB -> 433 KB, and the two large chunks disappear entirely.

/** Module ids whose web-only implementation is unreachable on a device. */
const WEB_ONLY_STUBS = {
  '@your-scope/analytics': ['createAnalytics'],
  // Add the service arms your own app imports statically. Keep the export
  // names accurate — a missing one is a build error, which is the good failure.
};

const PLUGIN_WEB_FALLBACK =
  /@capacitor-firebase[/\\]([a-z]+)[/\\]dist[/\\]esm[/\\]web\.js$/;

export const dropWebFirebase = () => ({
  name: 'drop-web-firebase',
  apply: 'build',
  enforce: 'pre',

  async resolveId(source, importer, options) {
    if (WEB_ONLY_STUBS[source]) return `\0web-only:${source}`;

    // Only './web' can be a plugin fallback, so resolve nothing else — this
    // hook runs for every import in the graph.
    if (!source.startsWith('./web')) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    const plugin = resolved && PLUGIN_WEB_FALLBACK.exec(resolved.id);
    return plugin ? `\0web-only-plugin:${plugin[1]}` : null;
  },

  load(id) {
    if (id.startsWith('\0web-only:')) {
      const from = id.slice('\0web-only:'.length);
      return WEB_ONLY_STUBS[from]
        .map((name) => `export const ${name} = () => { throw new Error(${JSON.stringify(
          `${name} (${from}) is stubbed out of native builds — the Capacitor provider ` +
          'should have been chosen instead.',
        )}) }`)
        .join('\n');
    }

    if (id.startsWith('\0web-only-plugin:')) {
      const plugin = id.slice('\0web-only-plugin:'.length);
      // e.g. authentication -> FirebaseAuthenticationWeb, the name the plugin's
      // index.js constructs off the dynamic import.
      const cls = `Firebase${plugin[0].toUpperCase()}${plugin.slice(1)}Web`;
      return `export class ${cls} { constructor() { throw new Error(${JSON.stringify(
        `${cls} is stubbed out of native builds — registerPlugin should have used the ` +
        'native implementation.',
      )}) } }`;
    }

    return null;
  },

  /**
   * The part worth insisting on.
   *
   * A stub only helps while nothing re-imports the real thing. Assert on the
   * emitted chunks rather than trusting that the import graph stayed clean —
   * without this, the next dependency upgrade quietly puts 700 KB back and
   * nobody finds out.
   */
  generateBundle(_options, bundle) {
    const leaked = Object.entries(bundle)
      .filter(([, c]) => c.type === 'chunk' &&
        /@firebase\/(app|auth|firestore|analytics)\b/.test(c.code))
      .map(([name]) => name);

    if (leaked.length) {
      this.error(
        `VITE_NATIVE=1 but the Firebase JS SDK is still in ${leaked.join(', ')}. ` +
        'Something imports it outside the stubbed entry points.',
      );
    }
  },
});
