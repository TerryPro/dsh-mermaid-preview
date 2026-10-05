/**
 * Client smoke test: the browser bundle is hand-authored CJS wrapped in a
 * `window.__ModuleLoader__.load({ id, factory })` call. This evaluates it under a
 * mock loader + a stub React and asserts the plugin contract the shell reads
 * (inject, apply, the tab-type definition) plus the pure address/copy helpers.
 * Rendering the panel needs the real shell, which a Node process cannot host;
 * everything that is a pure function is checked here.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState() {}, useRef() {}, useEffect() {}, useMemo() {}, useCallback() {},
}

let captured = null
globalThis.window = { __ModuleLoader__: { load(spec) { captured = spec } } }

await import('../client/client.js')

const load = () => captured.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error(`unexpected require: ${name}`)
})

test('the bundle registers itself under the loader id', () => {
  assert.notEqual(captured, null)
  assert.equal(captured.id, 'dsh-mermaid-preview')
})

test('the factory exposes the plugin contract', () => {
  const exports = load()
  assert.deepEqual(exports.inject, ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'])
  assert.equal(typeof exports.apply, 'function')
  const test0 = exports.__test__
  assert.equal(test0.TYPE_ID, 'dsh-mermaid-preview')
  assert.equal(test0.KIND, 'mermaid')
  assert.equal(test0.RUNTIME_PATH, '/dsh-mermaid-preview/mermaid-runtime.js')
  assert.deepEqual(Object.keys(test0.API).sort(), ['read', 'stat', 'state', 'write'])
})

test('the tab type is a file viewer: it claims .mmd/.mermaid addresses, no guide capsule', () => {
  const definition = load().__test__.tabDefinition()
  assert.equal(definition.id, 'dsh-mermaid-preview')
  assert.equal(definition.kind, 'mermaid')
  assert.deepEqual(definition.patterns, ['*.mmd', '*.mermaid'])
  // the whole point of the rework: reached by opening a file, not a launcher
  assert.equal(definition.guide, undefined)
  assert.equal(typeof definition.title, 'function')

  // canOpen accepts a mermaid file address and refuses everything else
  const ok = definition.canOpen('dsh-resource://file/session/s1/docs/a.mmd')
  const ok2 = definition.canOpen('dsh-resource://file/absolute/C:/x/a.mermaid')
  const noMd = definition.canOpen('dsh-resource://file/session/s1/readme.md')
  const noOtherScheme = definition.canOpen('https://example/a.mmd')
  assert.equal(ok, true)
  assert.equal(ok2, true)
  assert.equal(noMd, false)
  assert.equal(noOtherScheme, false)

  // the chip title is the decoded basename
  assert.equal(definition.title('dsh-resource://file/session/s1/docs/my%20diagram.mmd'), 'my diagram.mmd')
})

test('address and name helpers behave', () => {
  const { basenameOfAddress, stripExt, isAbsoluteAddress } = load().__test__

  assert.equal(basenameOfAddress('dsh-resource://file/session/s1/a/b.mmd'), 'b.mmd')
  assert.equal(basenameOfAddress('dsh-resource://file/session/s1/my%20dir/x.mmd'), 'x.mmd')
  assert.equal(basenameOfAddress('dsh-resource://file/session/s1/a.mmd?rev=1'), 'a.mmd')
  assert.equal(basenameOfAddress(''), '')
  assert.equal(stripExt('c.mmd'), 'c')
  assert.equal(stripExt('.mermaidrc'), '.mermaidrc') // a leading dot is not an extension
  assert.equal(isAbsoluteAddress('dsh-resource://file/absolute/home/a.mmd'), true)
  assert.equal(isAbsoluteAddress('dsh-resource://file/session/s1/a.mmd'), false)
})

test('copy lookup falls back to English and interpolates', () => {
  const { pick, interpolate } = load().__test__
  assert.equal(pick('en', 'save'), 'Save')
  assert.equal(pick('zh', 'save'), '保存')
  assert.equal(pick('fr', 'save'), 'Save')
  assert.equal(pick('en', 'nope_missing_key'), 'nope_missing_key')
  assert.equal(interpolate('Remove {name}?', { name: 'docs' }), 'Remove docs?')
})

test('the render guard makes only the newest render win', () => {
  const { createRenderGuard } = load().__test__
  const guard = createRenderGuard()
  const first = guard.begin()
  const second = guard.begin()
  assert.equal(guard.isCurrent(first), false, 'a superseded render must be rejected')
  assert.equal(guard.isCurrent(second), true)
  assert.equal(guard.isCurrent(first), false, 'the rejection must be stable')
})

test('planDraft decides restore / discard / none', () => {
  const { planDraft } = load().__test__
  assert.deepEqual(planDraft(null, 'disk'), { action: 'none' })
  assert.deepEqual(planDraft('', 'disk'), { action: 'none' })
  assert.deepEqual(planDraft('disk', 'disk'), { action: 'discard' }) // draft == disk: no need to keep
  assert.deepEqual(planDraft('mine', 'disk'), { action: 'restore', text: 'mine' })
})

test('changeVerdict reacts to a moved mtime by editor state', () => {
  const { changeVerdict } = load().__test__
  assert.equal(changeVerdict(100, 100, true), 'same')
  assert.equal(changeVerdict(100, 200, false), 'reload') // clean editor: safe to refresh
  assert.equal(changeVerdict(100, 200, true), 'conflict') // unsaved edits: prompt
  assert.equal(changeVerdict(null, 200, false), 'unknown')
  assert.equal(changeVerdict(100, undefined, true), 'unknown')
})

test('draft keys are namespaced by the full address', () => {
  const { draftKey, DRAFT_PREFIX } = load().__test__
  assert.equal(draftKey('dsh-resource://file/session/s1/a.mmd'), `${DRAFT_PREFIX}dsh-resource://file/session/s1/a.mmd`)
})

test('escapeHtml neutralises the markup metacharacters', () => {
  const { escapeHtml } = load().__test__
  assert.equal(escapeHtml('a<b>&c"d'), 'a&lt;b&gt;&amp;c"d')
})

test('highlightMermaid escapes text and tags mermaid constructs', () => {
  const { highlightMermaid } = load().__test__
  // dangerous characters must never survive as live markup
  const html = highlightMermaid('graph TD\n  A["<img src=x>"] --> B\n  %% a comment')
  assert.doesNotMatch(html, /<img/, 'a raw <img> must be escaped')
  assert.ok(html.includes('&lt;'), 'angle brackets are escaped')
  // keywords, arrows, strings and comments each get a class span
  assert.ok(html.includes('<span class="tk-kw">graph</span>'))
  assert.ok(html.includes('tk-arw'))
  assert.ok(html.includes('tk-str'))
  assert.ok(html.includes('tk-com'))
})

test('lineNumbersText produces one number per line', () => {
  const { lineNumbersText } = load().__test__
  assert.equal(lineNumbersText(1), '1')
  assert.equal(lineNumbersText(3), '1\n2\n3')
})

test('clampRatio bounds the split and tolerates junk', () => {
  const { clampRatio } = load().__test__
  assert.equal(clampRatio(0.5), 0.5)
  assert.equal(clampRatio(0.02), 0.18)
  assert.equal(clampRatio(0.99), 0.82)
  assert.equal(clampRatio(Number.NaN), 0.5)
})

test('resolveTheme maps a choice to a Mermaid theme', () => {
  const { resolveTheme, THEME_CHOICES } = load().__test__
  assert.deepEqual(THEME_CHOICES, ['auto', 'default', 'dark', 'forest', 'neutral', 'base'])
  assert.equal(resolveTheme('auto', true), 'dark')
  assert.equal(resolveTheme('auto', false), 'default')
  // explicit choices win over the shell mode
  assert.equal(resolveTheme('forest', true), 'forest')
  assert.equal(resolveTheme('base', false), 'base')
  // an unknown value falls back to the auto behaviour
  assert.equal(resolveTheme('bogus', true), 'dark')
})

test('mermaidFence wraps source in a ```mermaid block', () => {
  const { mermaidFence } = load().__test__
  assert.equal(mermaidFence('graph TD\n  A-->B'), '```mermaid\ngraph TD\n  A-->B\n```')
  // trailing whitespace/newlines are trimmed before the closing fence
  assert.equal(mermaidFence('graph TD\n\n'), '```mermaid\ngraph TD\n```')
  assert.equal(mermaidFence(''), '```mermaid\n\n```')
})

test('resolvePngFill picks a canvas fill or transparency', () => {
  const { resolvePngFill } = load().__test__
  assert.equal(resolvePngFill('transparent', true), null)
  assert.equal(resolvePngFill('white', true), '#ffffff')
  assert.equal(resolvePngFill('theme', true), '#1e1e1e')
  assert.equal(resolvePngFill('theme', false), '#ffffff')
})

test('diagramTypeOf reads the declared type, skipping directives/comments', () => {
  const { diagramTypeOf } = load().__test__
  assert.equal(diagramTypeOf('graph TD\n  A-->B'), 'graph')
  assert.equal(diagramTypeOf('sequenceDiagram\n  A->>B: hi'), 'sequenceDiagram')
  assert.equal(diagramTypeOf('%%{init: {"theme":"dark"}}%%\nflowchart LR\n  A-->B'), 'flowchart')
  assert.equal(diagramTypeOf('---\ntitle: x\n---\n\n\npie title t\n  "a": 1'), 'pie')
  assert.equal(diagramTypeOf('stateDiagram-v2\n  [*]-->S'), 'stateDiagram-v2')
  assert.equal(diagramTypeOf(''), '')
  assert.equal(diagramTypeOf('%% only a comment'), '')
})

test('extractErrorLine pulls a line number from a parse error', () => {
  const { extractErrorLine } = load().__test__
  assert.equal(extractErrorLine('Parse error on line 3:'), 3)
  assert.equal(extractErrorLine('Problem at Line 12 here'), 12)
  assert.equal(extractErrorLine('no number here'), null)
  assert.equal(extractErrorLine(''), null)
})

test('closingFor maps an opener to its partner', () => {
  const { closingFor } = load().__test__
  assert.equal(closingFor('['), ']')
  assert.equal(closingFor('('), ')')
  assert.equal(closingFor('{'), '}')
  assert.equal(closingFor('"'), '"')
  assert.equal(closingFor("'"), "'")
  assert.equal(closingFor('a'), null)
})

test('indentBlock indents/outdents whole lines and re-selects the block', () => {
  const { indentBlock } = load().__test__
  // indent every touched line, even a caret-only selection
  assert.deepEqual(indentBlock('a\nb', 0, 3, 1), { value: '  a\n  b', selStart: 0, selEnd: 7 })
  // outdent removes up to two leading spaces
  assert.deepEqual(indentBlock('  a\n  b', 0, 7, -1), { value: 'a\nb', selStart: 0, selEnd: 3 })
  // a partial selection still expands to whole lines and leaves the rest intact
  const r = indentBlock('x\n  y\nz', 2, 5, -1)
  assert.equal(r.value, 'x\ny\nz')
  assert.deepEqual({ start: r.selStart, end: r.selEnd }, { start: 2, end: 3 })
})

test('clampZoom bounds and rounds the factor', () => {
  const { clampZoom } = load().__test__
  assert.equal(clampZoom(1.004), 1)
  assert.equal(clampZoom(0.01), 0.25)
  assert.equal(clampZoom(99), 6)
  assert.equal(clampZoom(Number.NaN), 1)
})

test('svgNaturalSize prefers the viewBox, falls back to width/height', () => {
  const { svgNaturalSize } = load().__test__
  assert.deepEqual(svgNaturalSize('0 0 640 480', null, null), { w: 640, h: 480 })
  assert.deepEqual(svgNaturalSize('', '200', '100'), { w: 200, h: 100 })
  assert.deepEqual(svgNaturalSize('garbage', '', ''), { w: 0, h: 0 })
})

test('fitScale fills the width, clamped and guarded', () => {
  const { fitScale } = load().__test__
  // 1000x500 diagram into 500x500 box (minus 40 pad) → width fills: 460/1000
  assert.equal(fitScale(500, 500, 1000, 500, 40), 0.46)
  // a tall diagram fills the WIDTH (not shrunk to fit its height): 460/500, scrolls vertically
  assert.equal(fitScale(500, 500, 500, 2000, 40), 0.92)
  // a tiny diagram would over-zoom; the clamp caps it at 6
  assert.equal(fitScale(500, 500, 10, 10, 40), 6)
  // unmeasurable widths fall back to 1 (no fit)
  assert.equal(fitScale(500, 500, 0, 100, 40), 1)
  assert.equal(fitScale(20, 500, 100, 100, 40), 1)
})
