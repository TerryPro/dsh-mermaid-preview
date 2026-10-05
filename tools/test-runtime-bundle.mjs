/**
 * Bundle-load smoke test: proves the artifact the browser actually imports —
 * `lib/mermaid-runtime.js`, the esbuild bundle of Mermaid — is a valid ESM module
 * that exposes the API the client depends on (`initialize` + `render`), when the
 * browser DOM globals are present.
 *
 * This deliberately does NOT assert a live diagram render: under happy-dom Mermaid
 * has no layout engine (measuring text via getComputedTextLength/getBBox returns
 * nothing, so a render yields an empty or failing SVG). Rendering fidelity is a
 * browser concern — `dsh-mermaid` stubs the runtime in its own tests for the same
 * reason. What is genuinely untested elsewhere and worth pinning here is that the
 * bundle is well-formed and loadable: a build that emitted a broken module, or an
 * entry that stopped exporting the mermaid default, would fail this without any
 * dependency on layout.
 *
 * It runs against the BUILT bundle, so `npm test` requires `npm run build` first
 * (the CI workflow builds before testing; `prepare` builds on install).
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { Window } from 'happy-dom'

const bundle = path.resolve(fileURLToPath(import.meta.url), '../../lib/mermaid-runtime.js')

test('the built Mermaid runtime bundle exists', () => {
  assert.ok(existsSync(bundle), `run "npm run build" first — expected ${bundle}`)
})

test('the bundle loads under browser globals and exposes the mermaid API', async () => {
  if (!existsSync(bundle)) return // the existence test above already fails the run
  const win = new Window({ url: 'http://localhost/' })
  const names = {
    window: win,
    document: win.document,
    navigator: win.navigator,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
    CSSStyleSheet: win.CSSStyleSheet,
    MutationObserver: win.MutationObserver,
    Blob: win.Blob,
    URL: win.URL,
    getComputedStyle: win.getComputedStyle.bind(win),
  }
  const restore = []
  for (const [name, value] of Object.entries(names)) {
    restore.push([name, Object.getOwnPropertyDescriptor(globalThis, name)])
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  try {
    // a cache-buster query so a prior import in the same process does not mask globals
    const mod = await import(`../lib/mermaid-runtime.js?t=${Date.now()}`)
    const mermaid = mod.default ?? mod.mermaid ?? mod
    assert.equal(typeof mermaid, 'object', 'the bundle must export the mermaid object as default')
    assert.equal(typeof mermaid.initialize, 'function', 'mermaid.initialize must be callable')
    assert.equal(typeof mermaid.render, 'function', 'mermaid.render must be callable')
    // initialize with the same shape the client uses, and confirm it does not throw
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
  } finally {
    for (const [name, descriptor] of restore) {
      if (descriptor === undefined) delete globalThis[name]
      else Object.defineProperty(globalThis, name, descriptor)
    }
    await win.happyDOM.abort()
  }
})
