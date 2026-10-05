/**
 * The Mermaid runtime entry, bundled by scripts/build.mjs into
 * lib/mermaid-runtime.js (an ESM bundle) and served by the host at
 * /dsh-mermaid-preview/mermaid-runtime.js. The browser half imports that URL and
 * reads `module.default` — the mermaid object — exactly like dsh-mermaid ships
 * its own runtime. Keeping the library here (rather than a CDN) pins the version
 * to whatever this package was built against and lets the panel render offline.
 */
import mermaid from 'mermaid'

export default mermaid
