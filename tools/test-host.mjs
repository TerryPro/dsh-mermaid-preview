/**
 * Host smoke test for the address grammar and the absolute-path file IO — the two
 * pieces with a correctness/security obligation. Run with `npm test`.
 *
 * The address layer (lib/address.js) is the whole translation from the opaque
 * `dsh-resource://file/…` string the client forwards to a real host path, and the
 * write confinement rests on `isUnderDir`; the IO layer (lib/files.js) reads and
 * writes exactly one resolved absolute path with a size cap and a text sniff. Both
 * are asserted directly, with no webserver.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { basenameFromAddress, isUnderDir, parseFileAddress, resolveAddress } from '../lib/address.js'
import { MpError, readFileAt, writeFileAt } from '../lib/files.js'

const norm = (p) => path.resolve(p)

test('parseFileAddress decodes session and absolute scopes', () => {
  assert.deepEqual(
    parseFileAddress('dsh-resource://file/session/s1/home/me/a.mmd'),
    { scope: 'session', sessionId: 's1', path: 'home/me/a.mmd' })
  // an encoded space and hash survive the round trip
  assert.deepEqual(
    parseFileAddress('dsh-resource://file/session/s1/my%20dir/d.mmd'),
    { scope: 'session', sessionId: 's1', path: 'my dir/d.mmd' })
  // a drive letter keeps its colon
  assert.deepEqual(
    parseFileAddress('dsh-resource://file/absolute/C:/x/y.txt'),
    { scope: 'absolute', path: 'C:/x/y.txt' })
  assert.deepEqual(
    parseFileAddress('dsh-resource://file/absolute/home/ys/n.txt'),
    { scope: 'absolute', path: '/home/ys/n.txt' })
  // query/fragment ignored
  assert.equal(parseFileAddress('dsh-resource://file/session/s1/a.mmd?rev=1').path, 'a.mmd')
})

test('parseFileAddress rejects anything that is not a file address', () => {
  assert.equal(parseFileAddress('https://example/x'), undefined)
  assert.equal(parseFileAddress('dsh-resource://file/'), undefined)
  assert.equal(parseFileAddress('dsh-resource://file/session/onlyId'), undefined)
  assert.equal(parseFileAddress('dsh-resource://file/absolute/'), undefined)
  assert.equal(parseFileAddress(undefined), undefined)
})

test('resolveAddress joins relative paths onto cwd and keeps absolute paths', () => {
  const r = resolveAddress({ scope: 'session', sessionId: 's', path: 'docs/a.mmd' }, '/work')
  assert.equal(r.absolute, norm('/work/docs/a.mmd'))
  assert.equal(r.cwd, norm('/work'))

  // a session path that is already absolute (file outside the root) is used as-is
  assert.equal(resolveAddress({ scope: 'session', sessionId: 's', path: '/elsewhere/a.mmd' }, '/work').absolute, norm('/elsewhere/a.mmd'))
  // no root and a relative path → refuse rather than guess
  assert.equal(resolveAddress({ scope: 'session', sessionId: 's', path: 'a.mmd' }, undefined).error, 'mp/no-workspace')
  // absolute scope needs no root
  assert.equal(resolveAddress({ scope: 'absolute', path: '/tmp/a.mmd' }, undefined).absolute, norm('/tmp/a.mmd'))
  assert.equal(resolveAddress(undefined, '/work').error, 'mp/bad-address')
})

test('isUnderDir is the write-confinement primitive', () => {
  assert.equal(isUnderDir('/work/docs/a.mmd', '/work'), true)
  assert.equal(isUnderDir('/work', '/work'), true)
  assert.equal(isUnderDir('/work/other/a', '/work'), true)
  assert.equal(isUnderDir('/elsewhere/a', '/work'), false)
  assert.equal(isUnderDir('/workfoo/a', '/work'), false) // sibling with a shared prefix
  assert.equal(isUnderDir('/a', ''), false)
})

test('basenameFromAddress reads the file name off the address', () => {
  assert.equal(basenameFromAddress({ scope: 'session', path: 'docs/a.mmd' }), 'a.mmd')
  assert.equal(basenameFromAddress({ scope: 'absolute', path: '/x/y/z.mermaid' }), 'z.mermaid')
  assert.equal(basenameFromAddress({ scope: 'session', path: '' }), '')
})

test('readFileAt / writeFileAt round-trip an absolute path', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-mp-'))
  try {
    const target = path.join(dir, 'fresh', 'a.mmd')
    const wrote = await writeFileAt(target, 'flowchart TD\n  A-->B\n')
    assert.equal(wrote.created, true)
    const read = await readFileAt(target)
    assert.match(read.text, /flowchart/)

    await writeFileAt(target, 'graph LR\n  X---Y\n')
    const again = await readFileAt(target)
    assert.match(again.text, /graph LR/)
    assert.equal((await writeFileAt(target, 'x')).created, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readFileAt refuses missing, directories, and binary', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-mp-'))
  try {
    await assert.rejects(() => readFileAt(path.join(dir, 'nope.mmd')), e => e.code === 'mp/missing')
    await assert.rejects(() => readFileAt(dir), e => e.code === 'mp/not-a-file')
    const bin = path.join(dir, 'b.mmd')
    await writeFile(path.join(dir, 'b.bin'), Buffer.from([0, 1, 2, 0]))
    await assert.rejects(() => readFileAt(path.join(dir, 'b.bin')), e => e.code === 'mp/not-text')
    assert.equal(typeof bin, 'string')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('MpError carries a wire payload', () => {
  const error = new MpError('mp/test', 'a message', 418)
  assert.deepEqual(error.payload, { ok: false, error: { code: 'mp/test', message: 'a message' } })
  assert.equal(error.status, 418)
})
