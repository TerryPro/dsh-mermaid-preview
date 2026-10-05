/**
 * dsh-mermaid-preview — client half.
 *
 * A Mermaid viewer + editor for the right sidebar, driven by FILE ADDRESSES — not
 * a self-standing page with its own launcher. The plugin registers a tab TYPE that
 * claims `dsh-resource://file/…` addresses ending in `.mmd` / `.mermaid`. Open such
 * a file anywhere it is reachable — from the workspace Files panel, a chat file
 * link, a produced deliverable — and the right column opens this tab on it: the
 * source on the left, the rendered diagram live on the right, Save writes back.
 * There is deliberately no guide-page capsule; the entry point is the file.
 *
 * ## How it mounts
 *
 * The shipped two-stage path: the tab TYPE into `ctx.sidebarRightTabs` (stage one,
 * with `patterns` + `canOpen` so the router claims `.mmd` addresses at the default
 * `extension` band — which beats the built-in document preview's `fallback` text
 * viewer for these files), and the body into the keyed `sidebar.right.pane.tab`
 * seat under the same id (stage two). The body reads the file it belongs to from
 * `useTabInfo().tab.navigation.address`, the same address the router matched.
 *
 * ## How the file is read and written
 *
 * The body sends the opaque resource address to the host (`/api/dsh-mermaid-preview/read`
 * and `/write`); the host parses it and resolves it against the Session's workspace
 * root. The client never turns an address into a path. Saving a file that lives
 * outside that root is refused by the host; the panel then flips to read-only.
 *
 * Mermaid itself is NOT in this bundle — it is a multi-megabyte ESM bundle the host
 * serves at `/dsh-mermaid-preview/mermaid-runtime.js`, imported once with a content
 * revision so a rebuild busts the cache.
 *
 * Failure policy: nothing here throws out of `apply` (the shell fails its whole boot
 * when a plugin's apply throws), and every async path catches and shows in-panel copy
 * rather than rejecting into the console.
 */

window.__ModuleLoader__.load({
  id: 'dsh-mermaid-preview',

  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    let React = null
    try {
      React = require('react')
    } catch {
      React = null
    }
    const h = React === null ? null : React.createElement

    /* ------------------------------------------------------------------ *
     * Identity and wire surface
     * ------------------------------------------------------------------ */

    /** Tab-type identity; also the key the body registers under. */
    const TYPE_ID = 'dsh-mermaid-preview'
    /** Tab kind the type owns. */
    const KIND = 'mermaid'
    /** Locale namespace for this surface. */
    const NS = 'dsh-mermaid-preview'
    /** Suffixes this type claims, without a leading dot. */
    const EXTENSIONS = ['mmd', 'mermaid']

    /** Host route family (mirrors `lib/routes.js` ROUTES). */
    const API = {
      state: '/api/dsh-mermaid-preview/state',
      read: '/api/dsh-mermaid-preview/read',
      write: '/api/dsh-mermaid-preview/write',
      stat: '/api/dsh-mermaid-preview/stat',
    }

    /** Public path of the Mermaid runtime bundle (mirrors `index.js` RUNTIME_PATH). */
    const RUNTIME_PATH = '/dsh-mermaid-preview/mermaid-runtime.js'

    /** Debounce between the last keystroke and a re-render, in ms. */
    const RENDER_DEBOUNCE_MS = 350
    /** A guard so a runaway paste does not lock the browser in one render pass. */
    const MAX_SOURCE_CHARS = 100_000
    /** How often the open tab checks whether its file changed on disk, in ms. */
    const DRAFT_POLL_MS = 3000
    /** localStorage key prefix for a per-file unsaved draft. */
    const DRAFT_PREFIX = 'dsh-mermaid-preview:draft:'

    /* ------------------------------------------------------------------ *
     * Copy, with a built-in fallback so the panel never renders raw keys
     * ------------------------------------------------------------------ */

    const STRINGS = {
      zh: {
        loading: '加载中…',
        notFound: '文件不存在或已被移动。',
        readOnly: '此文件在工作区之外，只能预览、不能保存。',
        save: '保存',
        saved: '已保存',
        saveFailed: '保存失败',
        readFailed: '读取失败',
        reload: '重新载入',
        dirty: '未保存',
        code: '代码',
        preview: '预览',
        split: '分栏',
        zoomIn: '放大',
        zoomOut: '缩小',
        zoomFit: '适应',
        exportSvg: '导出 SVG',
        exportPng: '导出 PNG',
        templates: '模板',
        renderError: '渲染失败',
        runtimeMissing: 'Mermaid 运行库未构建，请在插件目录执行 npm run build',
        runtimeLoading: '正在加载 Mermaid 运行库…',
        emptyPreview: '没有可渲染的内容。',
        placeholder: '在此输入 Mermaid 代码…',
        noAddress: '这个标签没有关联文件地址。',
        draftRestored: '已恢复未保存的草稿',
        externalConflict: '文件在磁盘上已被修改（可能被 agent 改写）。',
        keep: '保留我的',
        reloaded: '已从磁盘更新',
      },
      en: {
        loading: 'Loading…',
        notFound: 'The file does not exist or has moved.',
        readOnly: 'This file is outside the workspace — preview only, it cannot be saved here.',
        save: 'Save',
        saved: 'Saved',
        saveFailed: 'Save failed',
        readFailed: 'Read failed',
        reload: 'Reload',
        dirty: 'unsaved',
        code: 'Code',
        preview: 'Preview',
        split: 'Split',
        zoomIn: 'Zoom in',
        zoomOut: 'Zoom out',
        zoomFit: 'Fit',
        exportSvg: 'Export SVG',
        exportPng: 'Export PNG',
        templates: 'Templates',
        renderError: 'Render failed',
        runtimeMissing: 'The Mermaid runtime is not built — run npm run build in the plugin folder',
        runtimeLoading: 'Loading the Mermaid runtime…',
        emptyPreview: 'Nothing to render.',
        placeholder: 'Type Mermaid code here…',
        noAddress: 'This tab is not bound to a file address.',
        draftRestored: 'Restored an unsaved draft',
        externalConflict: 'The file changed on disk (possibly rewritten by the agent).',
        keep: 'Keep mine',
        reloaded: 'Updated from disk',
      },
    }

    /** Diagram templates offered by the Templates menu. */
    const TEMPLATES = [
      { id: 'flowchart', code: 'flowchart TD\n  A[Start] --> B{Is it working?}\n  B -- Yes --> C[Great]\n  B -- No --> D[Debug]\n  D --> B\n' },
      { id: 'sequence', code: 'sequenceDiagram\n  participant Alice\n  participant Bob\n  Alice->>Bob: Hello Bob, how are you?\n  Bob-->>Alice: I am good, thanks!\n' },
      { id: 'class', code: 'classDiagram\n  Animal <|-- Duck\n  Animal: +introduce()\n  Duck: +nest()\n' },
      { id: 'state', code: 'stateDiagram-v2\n  [*] --> Still\n  Still --> Moving\n  Moving --> Still\n  Moving --> Crash\n  Crash --> [*]\n' },
      { id: 'er', code: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE-ITEM : contains\n' },
      { id: 'gantt', code: 'gantt\n  title Project plan\n  dateFormat YYYY-MM-DD\n  Design :a1, 2026-01-01, 5d\n  Build   :after a1, 10d\n' },
      { id: 'pie', code: 'pie title Pet preferences\n  "Dog" : 386\n  "Cat" : 85\n  "Other" : 15\n' },
    ]

    /* ------------------------------------------------------------------ *
     * Pure helpers (no React, no DOM) — unit-assertable in a Node process
     * ------------------------------------------------------------------ */

    /** Interpolate `{name}` placeholders from a vars object. */
    function interpolate(text, vars) {
      if (vars === undefined || vars === null) return text
      return text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
    }

    /** Pick a string for a key from a language, falling back to English. */
    function pick(lang, key, vars) {
      const dict = STRINGS[lang] ?? STRINGS.en
      const value = dict[key] ?? STRINGS.en[key] ?? key
      return interpolate(value, vars)
    }

    /** The current UI language, read from the document's html lang. */
    function detectLang() {
      if (typeof document === 'undefined') return 'en'
      const lang = (document.documentElement?.lang ?? navigator?.language ?? 'en').toLowerCase()
      return lang.startsWith('zh') ? 'zh' : 'en'
    }

    /** Whether the shell is in its dark theme, so Mermaid can match it. */
    function isDark() {
      if (typeof document === 'undefined') return false
      return document.body?.hasAttribute('data-ds-dark-theme') ?? false
    }

    /**
     * The file name an address points at: its decoded last path segment, with the
     * scope/session preamble dropped and any query/fragment removed.
     * @param address - a `dsh-resource://file/…` address.
     * @returns the basename, or '' when the address has no file segment.
     */
    function basenameOfAddress(address) {
      const clean = String(address ?? '').replace(/[?#].*$/u, '')
      const segment = clean.slice(clean.lastIndexOf('/') + 1)
      if (segment === '') return ''
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    }

    /** The file name without its extension. */
    function stripExt(name) {
      const at = name.lastIndexOf('.')
      return at <= 0 ? name : name.slice(0, at)
    }

    /**
     * Whether an address names an absolute-scope file (no session, so no workspace
     * to save back into) — the panel shows the read-only notice up front for these.
     * @param address - a resource address.
     * @returns true for a `dsh-resource://file/absolute/…` address.
     */
    function isAbsoluteAddress(address) {
      return String(address ?? '').startsWith('dsh-resource://file/absolute/')
    }

    /**
     * A monotonic token source that makes only the newest render win. Two renders
     * can be in flight (a slow diagram overtaken by a keystroke); each claims a
     * token and drops its result once a newer token exists.
     * @returns `{ begin, isCurrent }`.
     */
    function createRenderGuard() {
      let current = 0
      return {
        begin() { current += 1; return current },
        isCurrent(token) { return token === current },
      }
    }

    /** The localStorage key one address's unsaved draft lives under. */
    function draftKey(address) {
      return DRAFT_PREFIX + address
    }

    /**
     * Decide what to show for a freshly-read file when a draft may exist.
     * @param draft - the stored draft text, or null/'' when none.
     * @param disk - the text just read from disk.
     * @returns `{ action: 'none' | 'discard' | 'restore', text? }`.
     */
    function planDraft(draft, disk) {
      if (typeof draft !== 'string' || draft === '') return { action: 'none' }
      if (draft === disk) return { action: 'discard' }
      return { action: 'restore', text: draft }
    }

    /**
     * Whether a polled mtime means the file changed on disk, and how to react.
     * @param loadedMtime - the mtime the editor's baseline was read at.
     * @param currentMtime - the mtime just observed.
     * @param dirty - whether the editor has unsaved changes.
     * @returns 'same' | 'reload' (safe to refresh) | 'conflict' (prompt) | 'unknown'.
     */
    function changeVerdict(loadedMtime, currentMtime, dirty) {
      if (typeof currentMtime !== 'number' || typeof loadedMtime !== 'number') return 'unknown'
      if (currentMtime === loadedMtime) return 'same'
      return dirty ? 'conflict' : 'reload'
    }

    /** The browser localStorage, or null when unavailable (SSR, disabled, private). */
    function draftBackend() {
      try {
        return typeof localStorage !== 'undefined' && localStorage !== null ? localStorage : null
      } catch {
        return null
      }
    }

    /** Persist (or clear, for '') one address's draft. Best-effort. */
    function saveDraft(address, text) {
      const store = draftBackend()
      if (store === null || address === '') return
      try {
        if (text === '') store.removeItem(draftKey(address))
        else store.setItem(draftKey(address), text)
      } catch {
        /* storage full or blocked; losing the draft beats throwing */
      }
    }

    /** Read one address's draft, or null. */
    function loadDraft(address) {
      const store = draftBackend()
      if (store === null || address === '') return null
      try {
        return store.getItem(draftKey(address))
      } catch {
        return null
      }
    }

    /** Drop one address's draft (after a save, a discard, or a reload). */
    function clearDraft(address) {
      saveDraft(address, '')
    }

    /** localStorage key for the editor/preview split ratio (panel-wide, not per file). */
    const SPLIT_KEY = 'dsh-mermaid-preview:split'

    /** Keep a dragged split ratio within a sane band so neither pane collapses. */
    function clampRatio(ratio) {
      if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return 0.5
      return Math.min(0.82, Math.max(0.18, ratio))
    }

    /** Read the persisted split ratio (default half). */
    function readSplitRatio() {
      const store = draftBackend()
      try {
        const raw = store === null ? null : store.getItem(SPLIT_KEY)
        return raw === null ? 0.5 : clampRatio(parseFloat(raw))
      } catch {
        return 0.5
      }
    }

    /** Persist the split ratio. Best-effort. */
    function saveSplitRatio(ratio) {
      const store = draftBackend()
      if (store === null) return
      try {
        store.setItem(SPLIT_KEY, String(clampRatio(ratio)))
      } catch {
        /* storage blocked; the ratio just will not be remembered */
      }
    }

    /** A column of `1..count` line numbers as one newline-joined string. */
    function lineNumbersText(count) {
      let out = '1'
      for (let i = 2; i <= count; i += 1) out += `\n${i}`
      return out
    }

    /** Escape a run of text for the highlight overlay's innerHTML. */
    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    /** Mermaid keywords coloured in the highlight overlay (exact word match). */
    const KEYWORDS = new Set(['flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
      'erDiagram', 'gantt', 'pie', 'journey', 'quadrantChart', 'xyChart', 'sankey', 'mindmap', 'timeline',
      'packet', 'architecture', 'gitGraph', 'subgraph', 'end', 'participant', 'actor', 'create', 'destroy',
      'note', 'Note', 'alt', 'else', 'opt', 'loop', 'par', 'and', 'break', 'rect', 'class', 'cssClass',
      'style', 'linkStyle', 'click'])

    /**
     * Highlight Mermaid source to HTML for the overlay `<pre>`. A single linear
     * scan (comments, strings, connector/arrows, keywords, brackets) that escapes
     * every run it emits; anything unrecognised stays plain. It is presentational
     * only — the textarea still owns the text — so a coarse tokenizer is fine.
     * @param code - the raw source.
     * @returns an HTML string (for `dangerouslySetInnerHTML`).
     */
    function highlightMermaid(code) {
      const src = String(code ?? '')
      const span = (cls, raw) => `<span class="tk-${cls}">${escapeHtml(raw)}</span>`
      let out = ''
      let i = 0
      while (i < src.length) {
        const c = src[i]
        if (c === '\n') { out += '\n'; i += 1; continue }
        if (c === '%' && src[i + 1] === '%') { let j = i; while (j < src.length && src[j] !== '\n') j += 1; out += span('com', src.slice(i, j)); i = j; continue }
        if (c === '"' || c === "'") { let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j += 1; j += 1 } j = Math.min(j + 1, src.length); out += span('str', src.slice(i, j)); i = j; continue }
        if (/[-=><>|]/u.test(c)) { let j = i; while (j < src.length && /[-=><>|]/u.test(src[j])) j += 1; const run = src.slice(i, j); out += run.length >= 2 ? span('arw', run) : escapeHtml(run); i = j; continue }
        if (/[\w]/u.test(c)) { let j = i; while (j < src.length && /[\w]/u.test(src[j])) j += 1; const w = src.slice(i, j); out += KEYWORDS.has(w) ? span('kw', w) : escapeHtml(w); i = j; continue }
        if (/[[\]{}()]/u.test(c)) { out += span('brk', c); i += 1; continue }
        out += escapeHtml(c); i += 1
      }
      return out
    }

    /* ------------------------------------------------------------------ *
     * Host API calls (best-effort: resolve to a shaped value, never reject)
     * ------------------------------------------------------------------ */

    /** POST one JSON body to a host route and parse the reply. */
    async function postJson(url, body) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
      return res.json()
    }

    /** GET one host route and parse the reply. */
    async function getJson(url) {
      const res = await fetch(url)
      return res.json()
    }

    /* ------------------------------------------------------------------ *
     * Mermaid runtime, loaded once per plugin lifetime (shared across tabs)
     * ------------------------------------------------------------------ */

    let mermaidRuntime = null
    let runtimeRev = null
    let runtimeRevPromise = null
    let runtimeLoadPromise = null
    let renderSeq = 0

    /** Read the runtime content revision from the host once. */
    function ensureRev() {
      if (runtimeRevPromise === null) {
        runtimeRevPromise = getJson(API.state)
          .then((reply) => { runtimeRev = reply?.runtimeRev || 'dev'; return runtimeRev })
          .catch(() => { runtimeRev = 'dev'; return runtimeRev })
      }
      return runtimeRevPromise
    }

    /** Import + initialize the served Mermaid bundle once. */
    function loadRuntime() {
      if (mermaidRuntime !== null) return Promise.resolve(mermaidRuntime)
      if (runtimeLoadPromise === null) {
        runtimeLoadPromise = ensureRev()
          .then((rev) => {
            const url = `${RUNTIME_PATH}?rev=${encodeURIComponent(rev)}`
            return import(/* webpackIgnore: true */ url)
          })
          .then((mod) => {
            mermaidRuntime = mod.default ?? mod.mermaid ?? mod
            mermaidRuntime.initialize({
              startOnLoad: false,
              securityLevel: 'strict',
              suppressErrorRendering: true,
              theme: isDark() ? 'dark' : 'default',
              fontFamily: 'inherit',
            })
            return mermaidRuntime
          })
          .catch((error) => { runtimeLoadPromise = null; throw error })
      }
      return runtimeLoadPromise
    }

    /** Re-apply the theme when the shell flips light/dark. */
    function retuneTheme() {
      if (mermaidRuntime !== null) {
        mermaidRuntime.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: isDark() ? 'dark' : 'default',
          fontFamily: 'inherit',
        })
      }
    }

    /** Render one diagram to SVG markup, rejecting with `{ parseError }`. */
    async function renderMermaid(code) {
      const id = `dsh-mmd-preview-${++renderSeq}`
      try {
        const result = await mermaidRuntime.render(id, code)
        return { svg: typeof result === 'string' ? result : result.svg }
      } catch (error) {
        document.getElementById(id)?.remove()
        throw { parseError: String(error?.message ?? error) }
      }
    }

    /* ------------------------------------------------------------------ *
     * Export helpers (SVG markup -> download)
     * ------------------------------------------------------------------ */

    /** Trigger a browser download for a blob. */
    function download(blob, filename) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    /** Serialize an <svg> to standalone SVG text. */
    function svgMarkup(svgEl) {
      const clone = svgEl.cloneNode(true)
      if (!clone.hasAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      return `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`
    }

    /** Rasterize an SVG string to a PNG blob at the given scale. */
    function svgToPng(svgText, scale) {
      return new Promise((resolve, reject) => {
        const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
        const url = URL.createObjectURL(svgBlob)
        const img = new Image()
        img.onload = () => {
          const width = img.naturalWidth || img.width || 800
          const height = img.naturalHeight || img.height || 600
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(width * scale))
          canvas.height = Math.max(1, Math.round(height * scale))
          const ctx2d = canvas.getContext('2d')
          ctx2d.fillStyle = isDark() ? '#1e1e1e' : '#ffffff'
          ctx2d.fillRect(0, 0, canvas.width, canvas.height)
          ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height)
          URL.revokeObjectURL(url)
          canvas.toBlob((blob) => (blob === null ? reject(new Error('toBlob failed')) : resolve(blob)), 'image/png')
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg load failed')) }
        img.src = url
      })
    }

    /* ------------------------------------------------------------------ *
     * React components
     * ------------------------------------------------------------------ */

    /** Toolbar glyph paths (24x24 viewBox, stroke style; drawn on currentColor). */
    const ICONS = {
      save: ['M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M7 3v5h8V3', 'M7 21v-6h10v6'],
      reload: ['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6'],
      split: ['M3 4.5h18v15H3z', 'M12 4.5v15'],
      code: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4'],
      preview: ['M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z', 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
    }

    /** Build an inline SVG icon element from a list of path `d` strings. */
    function iconNode(paths, size) {
      const px = size ?? 16
      return h('svg', {
        width: px, height: px, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', className: 'mp-icon',
      }, ...paths.map((d, index) => h('path', { key: index, d })))
    }

    /** A small toolbar button. */
    function Button(props) {
      return h('button', {
        className: `mp-btn${props.variant === 'primary' ? ' mp-btn--primary' : ''}${props.disabled ? ' mp-btn--disabled' : ''}`,
        type: 'button',
        title: props.title,
        'aria-label': props.ariaLabel,
        disabled: props.disabled,
        onClick: props.onClick,
      }, props.children)
    }

    /** The tab body: reads its own file, edits it, renders it live, saves it back. */
    function MermaidBody(props) {
      const { useTabInfo } = props

      const lang = React.useMemo(detectLang, [])
      const t = React.useCallback((key, vars) => pick(lang, key, vars), [lang])

      const tabInfo = typeof useTabInfo === 'function' ? useTabInfo() : null
      const address = tabInfo?.tab?.navigation?.address ?? ''

      const [text, setText] = React.useState('')
      const [baseline, setBaseline] = React.useState('')
      const [fileName, setFileName] = React.useState('')
      const [loading, setLoading] = React.useState(false)
      const [notFound, setNotFound] = React.useState(false)
      const [loadError, setLoadError] = React.useState('')
      const [readOnly, setReadOnly] = React.useState(isAbsoluteAddress(address))

      const [svg, setSvg] = React.useState('')
      const [renderError, setRenderError] = React.useState('')
      const [zoom, setZoom] = React.useState(1)
      const [view, setView] = React.useState('split')
      const [splitRatio, setSplitRatio] = React.useState(readSplitRatio)
      const [runtimeState, setRuntimeState] = React.useState('idle')
      const [menuOpen, setMenuOpen] = React.useState(false)
      const [templatesOpen, setTemplatesOpen] = React.useState(false)
      const [savedAt, setSavedAt] = React.useState('')
      const [draftRestored, setDraftRestored] = React.useState(false)
      const [externalMtime, setExternalMtime] = React.useState(null)

      const renderTimer = React.useRef(null)
      const previewRef = React.useRef(null)
      const rerenderRef = React.useRef(null)
      const taRef = React.useRef(null)      // the source textarea
      const gutterRef = React.useRef(null)  // the line-number column
      const hlRef = React.useRef(null)      // the highlight overlay <pre>
      const workspaceRef = React.useRef(null)
      const loadedMtime = React.useRef(null)      // mtime the current baseline was read at
      const dismissedMtime = React.useRef(null)   // an external change the user chose to keep over
      const dirtyRef = React.useRef(false)
      const loadSeqRef = React.useRef(0)          // newest read wins; superseded replies are dropped
      const renderGuard = React.useMemo(createRenderGuard, [])

      const dirty = text !== baseline && !readOnly
      dirtyRef.current = dirty
      const visible = tabInfo?.tab?.visible !== false
      const editorVisible = view === 'split' || view === 'code'
      const previewVisible = view === 'split' || view === 'preview'

      /** Load the runtime once; per-panel state is 'ready' | 'missing'. */
      React.useEffect(() => {
        let alive = true
        if (mermaidRuntime !== null) { setRuntimeState('ready'); return undefined }
        setRuntimeState('loading')
        loadRuntime().then(() => { if (alive) setRuntimeState('ready') }).catch(() => { if (alive) setRuntimeState('missing') })
        return () => { alive = false }
      }, [])

      /** Read the file the tab names; optionally honouring an unsaved draft. Newest wins. */
      const pullFromDisk = React.useCallback((options) => {
        const applyDraft = options?.applyDraft === true
        if (address === '') return Promise.resolve(null)
        const seq = ++loadSeqRef.current
        setLoading(true)
        setNotFound(false)
        setLoadError('')
        return postJson(API.read, { address })
          .then((reply) => {
            if (seq !== loadSeqRef.current) return reply // a newer read already ran
            if (reply?.ok) {
              const disk = reply.text
              loadedMtime.current = reply.mtime
              setFileName(reply.name || basenameOfAddress(address))
              setBaseline(disk)
              if (applyDraft) {
                const plan = planDraft(loadDraft(address), disk)
                if (plan.action === 'restore') { setText(plan.text); setDraftRestored(true) }
                else { setText(disk); if (plan.action === 'discard') clearDraft(address); setDraftRestored(false) }
              } else {
                setText(disk); setDraftRestored(false)
              }
              setExternalMtime(null)
              dismissedMtime.current = null
            } else if (reply?.error?.code === 'mp/missing') {
              setNotFound(true); setText(''); setBaseline(''); setFileName(basenameOfAddress(address))
            } else {
              setLoadError(String(reply?.error?.message ?? t('readFailed'))); setFileName(basenameOfAddress(address))
            }
            return reply
          })
          .catch((error) => { if (seq === loadSeqRef.current) setLoadError(String(error?.message ?? error)); return null })
          .finally(() => { if (seq === loadSeqRef.current) setLoading(false) })
      }, [address, t])

      /** Load on mount and whenever the tab navigates to a different address. */
      React.useEffect(() => {
        if (address === '') { setText(''); setBaseline(''); setNotFound(false); return undefined }
        setReadOnly(isAbsoluteAddress(address))
        setSavedAt('')
        void pullFromDisk({ applyDraft: true })
        return undefined
      }, [address, pullFromDisk])

      /** Mirror an unsaved draft to storage so a closed tab restores; clear when clean. */
      React.useEffect(() => {
        if (address === '' || readOnly) return
        if (text === baseline) clearDraft(address)
        else saveDraft(address, text)
      }, [text, baseline, address, readOnly])

      /** Watch the file's mtime: auto-refresh when clean, prompt before overwriting an edit. */
      React.useEffect(() => {
        if (address === '' || readOnly || !visible) return undefined
        let alive = true
        let inFlight = false
        const tick = () => {
          if (inFlight || loadedMtime.current === null) return
          inFlight = true
          postJson(API.stat, { address })
            .then((reply) => {
              if (!alive || !reply?.ok) return
              const verdict = changeVerdict(loadedMtime.current, reply.mtime, dirtyRef.current)
              if (verdict === 'reload') void pullFromDisk({ applyDraft: false })
              else if (verdict === 'conflict' && reply.mtime !== dismissedMtime.current) setExternalMtime(reply.mtime)
            })
            .catch(() => {})
            .finally(() => { inFlight = false })
        }
        const timer = setInterval(tick, DRAFT_POLL_MS)
        return () => { alive = false; clearInterval(timer) }
      }, [address, readOnly, visible, pullFromDisk])

      /** Render the current text (debounced); the newest render wins over any in flight. */
      const scheduleRender = React.useCallback((code) => {
        if (renderTimer.current !== null) clearTimeout(renderTimer.current)
        if (code.trim() === '' || mermaidRuntime === null) { renderGuard.begin(); setSvg(''); return }
        renderTimer.current = setTimeout(() => {
          renderTimer.current = null
          const token = renderGuard.begin()
          if (code.length > MAX_SOURCE_CHARS) { setRenderError(`source exceeds ${MAX_SOURCE_CHARS} chars`); setSvg(''); return }
          renderMermaid(code)
            .then((result) => { if (!renderGuard.isCurrent(token)) return; setSvg(result.svg); setRenderError('') })
            .catch((err) => { if (!renderGuard.isCurrent(token)) return; setSvg(''); setRenderError(String(err?.parseError ?? err?.message ?? err)) })
        }, RENDER_DEBOUNCE_MS)
      }, [renderGuard])

      React.useEffect(() => { scheduleRender(text) }, [text, scheduleRender])
      React.useEffect(() => { if (runtimeState === 'ready') scheduleRender(text) }, [runtimeState])

      /** Watch the shell theme; re-tune and redraw the current text on a flip. */
      React.useEffect(() => {
        rerenderRef.current = () => scheduleRender(text)
      })
      React.useEffect(() => {
        const observer = typeof MutationObserver !== 'undefined'
          ? new MutationObserver(() => { if (mermaidRuntime !== null) { retuneTheme(); rerenderRef.current?.() } })
          : null
        if (observer !== null && typeof document !== 'undefined') observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        return () => observer?.disconnect()
      }, [])

      /* ---------------- actions ---------------- */

      const actions = {
        reload() {
          void pullFromDisk({ applyDraft: false }).then(() => { clearDraft(address); setSavedAt(t('reloaded')) })
        },
        // An external change: take the disk version (also drop my draft), or keep editing.
        acceptExternal() {
          void pullFromDisk({ applyDraft: false }).then(() => clearDraft(address))
        },
        dismissExternal() {
          dismissedMtime.current = externalMtime
          setExternalMtime(null)
        },
        save() {
          if (address === '' || readOnly) return
          setLoading(true)
          postJson(API.write, { address, text })
            .then((reply) => {
              if (reply?.ok) {
                setBaseline(text)
                if (typeof reply.mtime === 'number') loadedMtime.current = reply.mtime
                setSavedAt(t('saved')); setNotFound(false); setDraftRestored(false)
                setExternalMtime(null); dismissedMtime.current = null
              } else if (reply?.error?.code === 'mp/outside-workspace') { setReadOnly(true); setSavedAt(`⚠ ${t('readOnly')}`) }
              else { setSavedAt(`⚠ ${String(reply?.error?.message ?? t('saveFailed'))}`) }
            })
            .catch((error) => setSavedAt(`⚠ ${String(error?.message ?? t('saveFailed'))}`))
            .finally(() => setLoading(false))
        },
        changeText(value) { setText(value); setSavedAt('') },
        insertTemplate(code) { setText(code); setSavedAt('') },
        setViewMode(mode) { setView(mode) },
        zoom(step) { setZoom(z => (step === 0 ? 1 : Math.min(6, Math.max(0.25, Math.round((z + step * 0.25) * 100) / 100)))) },
        // Scroll the line-number column and the highlight overlay with the textarea.
        onEditorScroll() {
          const ta = taRef.current
          if (ta == null) return
          if (gutterRef.current !== null) gutterRef.current.scrollTop = ta.scrollTop
          if (hlRef.current !== null) { hlRef.current.scrollTop = ta.scrollTop; hlRef.current.scrollLeft = ta.scrollLeft }
        },
        // Drag the split handle: map the pointer's x to a ratio of the workspace width.
        startSplitDrag(e) {
          e.preventDefault()
          const ws = workspaceRef.current
          if (ws == null || typeof window === 'undefined') return
          const rect = ws.getBoundingClientRect()
          const move = (ev) => { const r = clampRatio((ev.clientX - rect.left) / rect.width); setSplitRatio(r); saveSplitRatio(r) }
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            if (typeof document !== 'undefined') document.body.style.userSelect = ''
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
          if (typeof document !== 'undefined') document.body.style.userSelect = 'none'
        },
        toggleMenu() { setMenuOpen(v => !v); setTemplatesOpen(false) },
        toggleTemplates() { setTemplatesOpen(v => !v); setMenuOpen(false) },
        exportSvg() {
          const el = previewRef.current?.querySelector('svg')
          if (el == null) return
          download(new Blob([svgMarkup(el)], { type: 'image/svg+xml;charset=utf-8' }), `${stripExt(fileName) || 'diagram'}.svg`)
        },
        exportPng() {
          const el = previewRef.current?.querySelector('svg')
          if (el == null) return
          svgToPng(svgMarkup(el), Math.max(2, zoom * 2))
            .then((blob) => download(blob, `${stripExt(fileName) || 'diagram'}.png`))
            .catch(() => setSavedAt('⚠ PNG export failed'))
        },
      }

      const displayName = fileName || basenameOfAddress(address) || t('noAddress')
      const hasSvg = svg !== '' && renderError === ''
      const shownText = notFound ? '' : text
      const lineCount = shownText.length === 0 ? 1 : shownText.split('\n').length
      const highlighted = highlightMermaid(shownText)

      return h('div', {
        className: 'mp-shell',
        'data-mp-theme': isDark() ? 'dark' : 'light',
        onKeyDown: (e) => {
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && String(e.key).toLowerCase() === 's') {
            e.preventDefault()
            if (dirty && !readOnly && address !== '') actions.save()
          }
        },
      },
        // Toolbar
        h('div', { className: 'mp-toolbar' },
          h(Button, { variant: 'primary', disabled: !dirty || readOnly || address === '', onClick: actions.save, title: t('save'), ariaLabel: t('save') }, iconNode(ICONS.save)),
          address !== '' ? h(Button, { disabled: loading, onClick: actions.reload, title: t('reload'), ariaLabel: t('reload') }, iconNode(ICONS.reload)) : null,
          h('span', { className: 'mp-sep' }),
          h('div', { className: 'mp-seg' },
            ['split', 'code', 'preview'].map(mode => h('button', {
              key: mode, type: 'button', className: `mp-seg-btn${view === mode ? ' mp-seg-btn--on' : ''}`,
              title: t(mode), 'aria-label': t(mode), 'aria-pressed': view === mode,
              onClick: () => actions.setViewMode(mode),
            }, iconNode(ICONS[mode])))),
          h('span', { className: 'mp-spacer' }),
          h('div', { className: 'mp-menu-wrap' },
            h('button', { type: 'button', className: 'mp-seg-btn', onClick: actions.toggleMenu }, `${t('exportSvg')}/${t('exportPng')} ▾`),
            menuOpen ? h('div', { className: 'mp-menu' },
              h('button', { type: 'button', className: 'mp-menu-item', disabled: !hasSvg, onClick: () => { actions.exportSvg(); actions.toggleMenu() } }, t('exportSvg')),
              h('button', { type: 'button', className: 'mp-menu-item', disabled: !hasSvg, onClick: () => { actions.exportPng(); actions.toggleMenu() } }, t('exportPng'))) : null),
          h('div', { className: 'mp-menu-wrap' },
            h('button', { type: 'button', className: 'mp-seg-btn', onClick: actions.toggleTemplates }, `${t('templates')} ▾`),
            templatesOpen && !readOnly ? h('div', { className: 'mp-menu' },
              TEMPLATES.map(tpl => h('button', {
                key: tpl.id, type: 'button', className: 'mp-menu-item',
                onClick: () => { actions.insertTemplate(tpl.code); actions.toggleTemplates() },
              }, tpl.id))) : null)),

        // Status line
        h('div', { className: 'mp-status' },
          h('span', { className: 'mp-status-name' }, displayName),
          dirty ? h('span', { className: 'mp-status-dirty' }, `● ${t('dirty')}`) : null,
          draftRestored ? h('span', { className: 'mp-status-runtime' }, t('draftRestored')) : null,
          readOnly ? h('span', { className: 'mp-status-runtime mp-status-runtime--bad' }, t('readOnly')) : null,
          loading ? h('span', { className: 'mp-status-msg' }, t('loading')) : null,
          savedAt !== '' ? h('span', { className: 'mp-status-msg' }, savedAt) : null,
          runtimeState === 'loading' ? h('span', { className: 'mp-status-runtime' }, t('runtimeLoading')) : null,
          runtimeState === 'missing' ? h('span', { className: 'mp-status-runtime mp-status-runtime--bad' }, t('runtimeMissing')) : null),

        // External-change banner: the file moved on disk while there are unsaved edits.
        externalMtime !== null ? h('div', { className: 'mp-banner' },
          h('span', { className: 'mp-banner-text' }, t('externalConflict')),
          h(Button, { variant: 'primary', onClick: actions.acceptExternal }, t('reload')),
          h(Button, { onClick: actions.dismissExternal }, t('keep'))) : null,

        // Body
        address === ''
          ? h('div', { className: 'mp-preview-empty' }, t('noAddress'))
          : h('div', { className: 'mp-workspace', ref: workspaceRef },
            editorVisible ? h('div', { className: 'mp-editor', style: view === 'split' ? { flex: `0 1 ${splitRatio * 100}%` } : undefined },
              h('div', { ref: gutterRef, className: 'mp-gutter', 'aria-hidden': 'true' }, lineNumbersText(lineCount)),
              h('div', { className: 'mp-code' },
                h('pre', { ref: hlRef, className: 'mp-highlight', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: highlighted } }),
                h('textarea', {
                  ref: taRef,
                  className: 'mp-textarea',
                  wrap: 'off',
                  readOnly,
                  spellCheck: false,
                  placeholder: t('placeholder'),
                  value: shownText,
                  onChange: e => actions.changeText(e.target.value),
                  onScroll: actions.onEditorScroll,
                }))) : null,
            (editorVisible && previewVisible) ? h('div', { className: 'mp-splitter', onPointerDown: actions.startSplitDrag }) : null,
            previewVisible ? h('div', { className: 'mp-preview', style: view === 'split' ? { flex: `0 1 ${(1 - splitRatio) * 100}%` } : undefined },
              h('div', { className: 'mp-preview-scroll' },
                h('div', { ref: previewRef, className: 'mp-canvas', style: { transform: `scale(${zoom})` } },
                  notFound ? h('div', { className: 'mp-preview-empty' }, t('notFound'))
                    : loadError !== '' ? h('div', { className: 'mp-error' }, h('div', { className: 'mp-error-title' }, t('readFailed')), h('pre', { className: 'mp-error-body' }, loadError))
                      : renderError !== '' ? h('div', { className: 'mp-error' }, h('div', { className: 'mp-error-title' }, t('renderError')), h('pre', { className: 'mp-error-body' }, renderError))
                        : hasSvg ? h('div', { className: 'mp-svg', dangerouslySetInnerHTML: { __html: svg } })
                          : h('div', { className: 'mp-preview-empty' }, t('emptyPreview')))),
              h('div', { className: 'mp-zoombar' },
                h('button', { type: 'button', className: 'mp-zoom-btn', title: t('zoomOut'), onClick: () => actions.zoom(-1) }, '−'),
                h('button', { type: 'button', className: 'mp-zoom-pct', title: t('zoomFit'), onClick: () => actions.zoom(0) }, `${Math.round(zoom * 100)}%`),
                h('button', { type: 'button', className: 'mp-zoom-btn', title: t('zoomIn'), onClick: () => actions.zoom(1) }, '+'))) : null))
    }

    /* ------------------------------------------------------------------ *
     * Stylesheet (one owned, tagged node the loader reaps with us)
     * ------------------------------------------------------------------ */

    const STYLES = `
.mp-shell{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-fg,inherit);font-size:13px;box-sizing:border-box}
*{box-sizing:border-box}
.mp-toolbar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border,#ddd);flex-wrap:wrap}
.mp-btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border,#c8c8c8);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12.5px;line-height:1.4}
.mp-btn:hover{background:var(--dsw-alias-bg-layer-2,#f2f2f2)}
.mp-btn--primary{font-weight:600}
.mp-btn--disabled{opacity:.45;cursor:default}
.mp-icon{display:block}
.mp-sep{width:1px;height:18px;background:var(--dsw-alias-border,#ddd);margin:0 2px}
.mp-spacer{flex:1}
.mp-seg{display:inline-flex;border:1px solid var(--dsw-alias-border,#c8c8c8);border-radius:6px;overflow:hidden}
.mp-seg-btn{display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:inherit;padding:4px 9px;cursor:pointer;font-size:12px}
.mp-seg-btn--on{background:var(--dsw-alias-accent,#4a7dff);color:#fff}
.mp-menu-wrap{position:relative}
.mp-menu{position:absolute;right:0;top:100%;margin-top:4px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border,#ccc);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);z-index:30;min-width:140px;padding:4px}
.mp-menu-item{display:block;width:100%;text-align:left;border:none;background:transparent;color:inherit;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12.5px}
.mp-menu-item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f2f2f2)}
.mp-menu-item:disabled{opacity:.4;cursor:default}
.mp-status{display:flex;align-items:center;gap:10px;padding:3px 10px;border-bottom:1px solid var(--dsw-alias-border,#eee);font-size:11.5px;color:var(--dsw-alias-fg-muted,#888)}
.mp-status-name{font-weight:600;color:var(--dsw-alias-fg,#333)}
.mp-status-dirty{color:#e0902a}
.mp-status-runtime--bad{color:#d1495b}
.mp-banner{display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(224,144,42,.12);border-bottom:1px solid #e0902a;color:var(--dsw-alias-fg,#5a4a2a);font-size:12px}
.mp-banner-text{flex:1}
.mp-workspace{display:flex;flex:1;min-height:0;overflow:hidden}
.mp-editor{flex:1 1 50%;min-width:0;display:flex;overflow:hidden}
.mp-code{position:relative;flex:1 1 auto;min-width:0}
.mp-gutter,.mp-highlight,.mp-textarea{font-family:ui-monospace,SFMono-Regular,Cascadia Code,Consolas,monospace;font-size:13px;line-height:20px;tab-size:2}
.mp-gutter{flex:0 0 auto;overflow:hidden;white-space:pre;text-align:right;color:var(--dsw-alias-fg-muted,#b0b0b0);background:var(--dsw-alias-bg-layer-0,#fafafa);border-right:1px solid var(--dsw-alias-border,#eee);padding:10px 8px 10px 10px;user-select:none}
.mp-highlight,.mp-textarea{margin:0;padding:10px 12px;border:0;white-space:pre}
.mp-highlight{position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;color:var(--dsw-alias-fg,#1e1e1e);background:var(--dsw-alias-bg-layer-1,#fff)}
.mp-textarea{position:absolute;inset:0;z-index:2;overflow:auto;background:transparent;color:transparent;caret-color:currentColor;resize:none;outline:none}
.mp-textarea::placeholder{color:var(--dsw-alias-fg-muted,#9a9a9a)}
.mp-textarea::-webkit-scrollbar{width:10px;height:10px}
.tk-com{color:#7a8288;font-style:italic}
.tk-kw{color:#0451a5;font-weight:600}
.tk-str{color:#a31515}
.tk-arw{color:#8b5cf6}
.tk-brk{color:#af6a00}
[data-mp-theme=dark] .tk-com{color:#6a737d}
[data-mp-theme=dark] .tk-kw{color:#569cd6}
[data-mp-theme=dark] .tk-str{color:#ce9178}
[data-mp-theme=dark] .tk-arw{color:#c586c0}
[data-mp-theme=dark] .tk-brk{color:#d7ba7d}
.mp-splitter{flex:0 0 3px;cursor:col-resize;background:var(--dsw-alias-border,#ddd);opacity:.5}
.mp-splitter:hover{opacity:1;background:var(--dsw-alias-accent,#4a7dff)}
.mp-preview{flex:1 1 50%;min-width:0;overflow:hidden;position:relative;background:var(--dsw-alias-bg-layer-0,#fafafa)}
.mp-preview-scroll{position:absolute;inset:0;overflow:auto}
.mp-zoombar{position:absolute;right:10px;bottom:10px;z-index:6;display:flex;align-items:center;gap:2px;padding:2px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border,#ddd);box-shadow:0 2px 8px rgba(0,0,0,.14)}
.mp-zoom-btn,.mp-zoom-pct{border:none;background:transparent;color:inherit;cursor:pointer;border-radius:7px;font-size:13px;line-height:1;padding:4px 7px}
.mp-zoom-pct{font-size:11.5px;min-width:44px;text-align:center;font-variant-numeric:tabular-nums}
.mp-zoom-btn:hover,.mp-zoom-pct:hover{background:var(--dsw-alias-bg-layer-2,#eee)}
.mp-canvas{transform-origin:top left;padding:16px;min-width:100%;display:inline-block}
.mp-svg{display:inline-block;min-width:100px}
.mp-svg svg{max-width:none}
.mp-preview-empty{padding:24px;color:var(--dsw-alias-fg-muted,#999);font-size:12.5px}
.mp-error{margin:12px;padding:12px 14px;border:1px solid #d1495b;border-radius:8px;background:rgba(209,73,91,.08)}
.mp-error-title{font-weight:600;color:#b23a48;margin-bottom:6px}
.mp-error-body{white-space:pre-wrap;font-size:12px;color:#7a2e38;margin:0;font-family:ui-monospace,monospace}
@media (max-width:520px){.mp-workspace{flex-direction:column}.mp-editor,.mp-preview{flex:1 1 auto!important}.mp-splitter{display:none}}
`

    /* ------------------------------------------------------------------ *
     * Plugin contract
     * ------------------------------------------------------------------ */

    /** Required client services. */
    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

    /** Copy registered under the plugin's locale namespace. */
    const LOCALE_DICTS = {
      zh: Object.fromEntries(Object.entries(STRINGS.zh).filter(([, value]) => typeof value === 'string')),
      en: Object.fromEntries(Object.entries(STRINGS.en).filter(([, value]) => typeof value === 'string')),
    }

    /**
     * Stage one: what the type IS. A resource viewer, not a page: it claims file
     * addresses ending in a Mermaid suffix. With no `priority`, it lands in the
     * `extension` band, which outranks the built-in document preview's `fallback`
     * text viewer for these files, so opening a `.mmd` routes here. There is no
     * `guide` entry — the panel is reached by opening a file, not a capsule.
     * @returns the definition handed to `ctx.sidebarRightTabs.register`.
     */
    function tabDefinition() {
      return {
        id: TYPE_ID,
        kind: KIND,
        keepMounted: true,
        patterns: EXTENSIONS.map(ext => `*.${ext}`),
        canOpen: (address) => address.startsWith('dsh-resource://file/')
          && new RegExp(`\\.(${EXTENSIONS.join('|')})$`, 'iu').test(address.replace(/[?#].*$/u, '')),
        title: (address) => basenameOfAddress(address),
      }
    }

    /**
     * Mount the Mermaid viewer/editor tab type.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      if (React === null || h === null) {
        console.warn('[dsh-mermaid-preview] react is unavailable in this shell — mermaid tab disabled')
        return
      }
      if (ctx === null || ctx === undefined || ctx.slots === undefined) {
        console.warn('[dsh-mermaid-preview] the slots service is unavailable — mermaid tab disabled')
        return
      }

      try {
        if (typeof ctx.locale?.register === 'function') {
          ctx.effect(() => ctx.locale.register(NS, LOCALE_DICTS), 'dsh-mermaid-preview: dictionaries')
        }
      } catch (error) {
        console.warn('[dsh-mermaid-preview] locale registration failed:', error)
      }

      if (typeof document !== 'undefined' && document !== null && document.head !== undefined) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.id = 'dsh-mermaid-preview-styles'
          style.setAttribute('data-plugin', 'dsh-mermaid-preview')
          style.setAttribute('data-plugin-css', 'dsh-mermaid-preview-styles')
          style.textContent = STYLES
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-mermaid-preview: styles')
      }

      // Stage one: the file-address type.
      ctx.effect(() => ctx.sidebarRightTabs.register(tabDefinition()), 'dsh-mermaid-preview: tab type')

      // Stage two: the body under the same id, handed the tab-info hook.
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: TYPE_ID },
        (props) => h(MermaidBody, { ctx, useTabInfo: props?.useTabInfo }),
      )), 'dsh-mermaid-preview: tab body')
    }

    exports.apply = apply
    exports.inject = inject
    // Pure helpers for the Node tests only; nothing in the running plugin reads this.
    exports.__test__ = {
      STRINGS, API, TYPE_ID, KIND, NS, EXTENSIONS, RUNTIME_PATH, TEMPLATES, DRAFT_PREFIX, DRAFT_POLL_MS,
      interpolate, pick, basenameOfAddress, stripExt, isAbsoluteAddress, tabDefinition,
      createRenderGuard, draftKey, planDraft, changeVerdict,
      escapeHtml, highlightMermaid, lineNumbersText, clampRatio,
    }
    return module.exports
  },
})
