/**
 * End-to-end host test: boot the real `apply()` from index.js against a mock
 * webServer + a mock sessions registry (one session with a workspace cwd), mount
 * every route on a live `node:http` server, and drive the plane over real HTTP —
 * state, read a workspace file by its resource address, write a new file back,
 * and the write confinement (a save outside the workspace is refused).
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, RUNTIME_PATH } from '../index.js'

/** The session id the mock registry knows, and its resource-address prefix. */
const SID = 'sess-1'
const addr = (rel) => `dsh-resource://file/session/${SID}/${rel}`

/** Boot apply() against mock services; return a base URL and a close(). */
async function boot(cwd) {
  const routes = []
  const ctx = {
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(fn) { fn() },
    get() { return undefined },
    sessions: { get: (id) => (id === SID ? { header: { cwd } } : undefined) },
    logger: { info() {}, warn() {} },
  }
  apply(ctx)

  const byPath = new Map(routes.map(route => [route.path, route]))
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = byPath.get(url.pathname)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void Promise.resolve(route.handler(req, res)).catch(() => {
      if (!res.headersSent) { res.writeHead(500); res.end() }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

const post = async (base, url, body) => (await fetch(`${base}${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json()

test('read / write a workspace file by resource address, with write confinement', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-mp-e2e-'))
  await writeFile(path.join(dir, 'flow.mmd'), 'flowchart TD\n  A-->B\n', 'utf8')

  const server = await boot(dir)
  try {
    // state carries the runtime revision
    const state = await (await fetch(`${server.base}/api/dsh-mermaid-preview/state`)).json()
    assert.equal(state.ok, true)
    assert.equal(typeof state.runtimeRev, 'string')

    // read the existing file
    const read = await post(server.base, '/api/dsh-mermaid-preview/read', { address: addr('flow.mmd') })
    assert.equal(read.ok, true)
    assert.equal(read.name, 'flow.mmd')
    assert.match(read.text, /flowchart/)

    // write a new file inside the workspace (parents created)
    const wrote = await post(server.base, '/api/dsh-mermaid-preview/write', {
      address: addr('out/seq.mmd'), text: 'sequenceDiagram\n  A->>B: hi\n',
    })
    assert.equal(wrote.ok, true)
    assert.equal(wrote.created, true)
    const reread = await post(server.base, '/api/dsh-mermaid-preview/read', { address: addr('out/seq.mmd') })
    assert.match(reread.text, /sequenceDiagram/)

    // stat is the cheap external-change probe: it reports the same mtime read returned
    const stat = await post(server.base, '/api/dsh-mermaid-preview/stat', { address: addr('flow.mmd') })
    assert.equal(stat.ok, true)
    assert.equal(typeof stat.mtime, 'number')
    assert.equal(stat.mtime, read.mtime)
    // stat on a missing file reports mp/missing, not a crash
    const statMissing = await post(server.base, '/api/dsh-mermaid-preview/stat', { address: addr('nope.mmd') })
    assert.equal(statMissing.ok, false)
    assert.equal(statMissing.error.code, 'mp/missing')

    // a save that escapes the workspace root is refused
    const escape = await post(server.base, '/api/dsh-mermaid-preview/write', {
      address: addr('../escape.mmd'), text: 'graph TD\n  A\n',
    })
    assert.equal(escape.ok, false)
    assert.equal(escape.error.code, 'mp/outside-workspace')

    // a bad address is rejected
    const bad = await post(server.base, '/api/dsh-mermaid-preview/read', { address: 'https://nope' })
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'mp/bad-address')

    // the runtime route serves the built bundle or 404s cleanly, never a 500
    const runtime = await fetch(`${server.base}${RUNTIME_PATH}`)
    assert.ok(runtime.status === 200 || runtime.status === 404)
    if (runtime.status === 200) assert.match(runtime.headers.get('content-type') ?? '', /javascript/)
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('an absolute-scope address reads but is read-only (save refused)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-mp-e2e-'))
  const file = path.join(dir, 'x.mmd')
  await writeFile(file, 'pie title t\n  "a": 1\n', 'utf8')
  const server = await boot(dir)
  try {
    const abs = `dsh-resource://file/absolute/${dir.replace(/\\/g, '/').replace(/^\/+/, '')}/x.mmd`
    const read = await post(server.base, '/api/dsh-mermaid-preview/read', { address: abs })
    assert.equal(read.ok, true)
    assert.match(read.text, /pie/)
    const wrote = await post(server.base, '/api/dsh-mermaid-preview/write', { address: abs, text: 'x' })
    assert.equal(wrote.ok, false)
    assert.equal(wrote.error.code, 'mp/outside-workspace')
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
