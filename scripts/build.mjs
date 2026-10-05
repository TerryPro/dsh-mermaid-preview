/**
 * Build for dsh-mermaid-preview.
 *
 * Only the Mermaid runtime is bundled: esbuild resolves `mermaid` from this
 * package's devDependencies and produces a single self-contained ESM file at
 * lib/mermaid-runtime.js, which the host serves to the browser. `mermaid` pulls
 * in d3 and every diagram parser, so bundling it here is what lets the panel run
 * offline with a pinned version.
 *
 * The client half (client/client.js) is hand-authored as a `__ModuleLoader__`
 * CJS factory and is NOT bundled — it imports nothing but `react` (which the
 * shell's module table provides) and reaches Mermaid through a runtime dynamic
 * `import()` of the served bundle. This mirrors dsh-photo, whose client ships as
 * source with no build step.
 */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

await mkdir('lib', { recursive: true })

await build({
  entryPoints: ['src/mermaid-runtime.js'],
  outfile: 'lib/mermaid-runtime.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120'],
  legalComments: 'none',
  logLevel: 'warning',
})

console.log('dsh-mermaid-preview: built lib/mermaid-runtime.js')
