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
        export: '导出',
        copyGroup: '复制',
        downloadGroup: '下载',
        pngOptions: 'PNG 设置',
        copySvg: '复制 SVG',
        copyPng: '复制 PNG',
        copyMermaid: '复制 Mermaid 代码',
        downloadSvg: '下载 SVG',
        downloadPng: '下载 PNG',
        pngScale: '倍率',
        pngBg: '背景',
        bgTheme: '跟随主题',
        bgWhite: '白色',
        bgTransparent: '透明',
        copied: '已复制到剪贴板',
        copyFailed: '剪贴板不可用',
        theme: '主题',
        themeAuto: '自动（跟随应用）',
        themeDefault: '默认',
        themeDark: '暗色',
        themeForest: '森林',
        themeNeutral: '中性',
        themeBase: '基础',
        fullscreen: '全屏预览',
        exitFullscreen: '退出全屏',
        syncScroll: '同步滚动',
        discardDraft: '丢弃草稿',
        zoomReset: '重置为 100%',
        line: '行',
        close: '关闭',
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
        export: 'Export',
        copyGroup: 'Copy',
        downloadGroup: 'Download',
        pngOptions: 'PNG options',
        copySvg: 'Copy SVG',
        copyPng: 'Copy PNG',
        copyMermaid: 'Copy as ```mermaid',
        downloadSvg: 'Download SVG',
        downloadPng: 'Download PNG',
        pngScale: 'Scale',
        pngBg: 'Background',
        bgTheme: 'Theme',
        bgWhite: 'White',
        bgTransparent: 'Transparent',
        copied: 'Copied to clipboard',
        copyFailed: 'Clipboard unavailable',
        theme: 'Theme',
        themeAuto: 'Auto (follow app)',
        themeDefault: 'Default',
        themeDark: 'Dark',
        themeForest: 'Forest',
        themeNeutral: 'Neutral',
        themeBase: 'Base',
        fullscreen: 'Fullscreen preview',
        exitFullscreen: 'Exit fullscreen',
        syncScroll: 'Sync scroll',
        discardDraft: 'Discard draft',
        zoomReset: 'Reset to 100%',
        line: 'line',
        close: 'Close',
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

    /** localStorage key for the chosen Mermaid theme. */
    const THEME_KEY = 'dsh-mermaid-preview:theme'
    /** The theme options offered: 'auto' follows the app; the rest are Mermaid themes. */
    const THEME_CHOICES = ['auto', 'default', 'dark', 'forest', 'neutral', 'base']

    /**
     * Resolve a theme choice to a Mermaid theme name.
     * @param choice - one of THEME_CHOICES.
     * @param dark - whether the shell is currently in dark mode (only matters for 'auto').
     * @returns the Mermaid theme string to initialize with.
     */
    function resolveTheme(choice, dark) {
      if (choice === 'default' || choice === 'dark' || choice === 'forest' || choice === 'neutral' || choice === 'base') return choice
      return dark ? 'dark' : 'default'
    }

    /** Read the persisted theme choice (default 'auto'). */
    function readThemeChoice() {
      const store = draftBackend()
      try {
        const raw = store === null ? null : store.getItem(THEME_KEY)
        return THEME_CHOICES.includes(raw) ? raw : 'auto'
      } catch {
        return 'auto'
      }
    }

    /** Persist the theme choice. Best-effort. */
    function saveThemeChoice(choice) {
      const store = draftBackend()
      if (store === null) return
      try {
        store.setItem(THEME_KEY, choice)
      } catch {
        /* storage blocked */
      }
    }

    /** Wrap Mermaid source in a ```mermaid fenced block for pasting into Markdown. */
    function mermaidFence(text) {
      return '```mermaid\n' + String(text ?? '').replace(/\s+$/u, '') + '\n```'
    }

    /**
     * The canvas fill for a PNG export.
     * @param bg - 'theme' | 'white' | 'transparent'.
     * @param dark - current shell dark mode (for 'theme').
     * @returns a CSS colour, or null to leave the PNG transparent.
     */
    function resolvePngFill(bg, dark) {
      if (bg === 'transparent') return null
      if (bg === 'white') return '#ffffff'
      return dark ? '#1e1e1e' : '#ffffff'
    }

    /**
     * Detect a diagram's declared type from its first content line, skipping
     * blank lines, `%%` comments, `%%{init}` directives and `---` front-matter.
     * @param code - the Mermaid source.
     * @returns the type keyword (e.g. 'flowchart'), or '' when none is recognised.
     */
    function diagramTypeOf(code) {
      const lines = String(code ?? '').split('\n')
      let i = 0
      // Skip leading blanks and `%%` comment/directive lines.
      while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('%%'))) i += 1
      // A leading YAML front-matter block: consume it whole through its closing '---'.
      if (i < lines.length && lines[i].trim() === '---') {
        i += 1
        while (i < lines.length && lines[i].trim() !== '---') i += 1
        i += 1
      }
      for (; i < lines.length; i += 1) {
        const line = lines[i].trim()
        if (line === '' || line.startsWith('%%')) continue
        const match = line.match(/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|requirementDiagram|erDiagram|journey|gantt|pie|quadrantChart|xyChart|sankey|mindmap|timeline|packet|architecture|gitGraph)\b/u)
        return match === null ? '' : match[1]
      }
      return ''
    }

    /**
     * Pull a line number out of a Mermaid parse error, when it names one.
     * @param message - the render error text.
     * @returns the 1-based line number, or null when the message carries none.
     */
    function extractErrorLine(message) {
      const text = String(message ?? '')
      const m = text.match(/line\s+(\d+)/iu) ?? text.match(/\bL(\d+)\b/u)
      return m === null ? null : Number(m[1])
    }

    /** The closing partner of an opening bracket/quote, or null. */
    function closingFor(ch) {
      return ch === '[' ? ']' : ch === '(' ? ')' : ch === '{' ? '}' : ch === '"' ? '"' : ch === "'" ? "'" : null
    }

    /**
     * Indent (dir > 0) or outdent (dir < 0) every line the [start,end) selection
     * touches, operating on whole lines. Two spaces per step; outdent removes up
     * to two leading spaces. The result re-selects the whole edited block, which
     * keeps repeated Tab presses cascading cleanly.
     * @returns `{ value, selStart, selEnd }`.
     */
    function indentBlock(value, start, end, dir) {
      const src = String(value ?? '')
      const lineStart = src.lastIndexOf('\n', Math.max(0, start) - 1) + 1
      let lineEnd = src.indexOf('\n', Math.max(0, end))
      if (lineEnd === -1) lineEnd = src.length
      const block = src.slice(lineStart, lineEnd)
      const lines = block.split('\n')
      const outdented = lines.map((line) => {
        if (dir > 0) return `  ${line}`
        const lead = line.match(/^ {1,2}/u)
        return lead === null ? line : line.slice(lead[0].length)
      })
      const newBlock = outdented.join('\n')
      const newValue = src.slice(0, lineStart) + newBlock + src.slice(lineEnd)
      return { value: newValue, selStart: lineStart, selEnd: lineStart + newBlock.length }
    }

    /** A column of `1..count` line numbers as one newline-joined string. */
    function lineNumbersText(count) {
      let out = '1'
      for (let i = 2; i <= count; i += 1) out += `\n${i}`
      return out
    }

    /** Clamp a zoom factor to the usable band, rounded to 2dp. */
    function clampZoom(z) {
      if (typeof z !== 'number' || !Number.isFinite(z)) return 1
      return Math.min(6, Math.max(0.25, Math.round(z * 100) / 100))
    }

    /**
     * A rendered SVG's intrinsic size from its `viewBox` (preferred) or width/
     * height attributes — the numbers a fit-to-view needs, read before any CSS
     * scaling is applied. Missing/garbage values fall back to 0 (→ no fit).
     * @returns `{ w, h }`.
     */
    function svgNaturalSize(viewBox, width, height) {
      const parts = String(viewBox ?? '').trim().split(/[\s,]+/u).map(Number)
      if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
        return { w: parts[2], h: parts[3] }
      }
      const w = Number.parseFloat(width) || 0
      const h = Number.parseFloat(height) || 0
      return { w, h }
    }

    /**
     * The zoom that fits a natural-sized diagram into an available box, minus
     * padding, clamped to the usable band. Falls back to 1 when anything is
     * unmeasurable (a zero-size or not-yet-laid-out diagram).
     * @returns a clamped zoom factor.
     */
    function fitScale(availW, availH, natW, natH, pad) {
      const w = availW - pad
      const h = availH - pad
      if (!(natW > 0) || !(natH > 0) || w <= 0 || h <= 0) return 1
      return clampZoom(Math.min(w / natW, h / natH))
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
    let themeChoice = null
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
            initMermaid()
            return mermaidRuntime
          })
          .catch((error) => { runtimeLoadPromise = null; throw error })
      }
      return runtimeLoadPromise
    }

    /** (Re)initialize the loaded Mermaid with the current theme choice + shell mode. */
    function initMermaid() {
      if (mermaidRuntime === null) return
      if (themeChoice === null) themeChoice = readThemeChoice()
      mermaidRuntime.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: resolveTheme(themeChoice, isDark()),
        fontFamily: 'inherit',
      })
    }

    /**
     * Switch the Mermaid theme at runtime: persists the choice, re-initializes the
     * shared runtime, and returns so the caller can redraw. Inline `%%{init}%%`
     * directives and YAML front-matter in a diagram still override this per-diagram.
     * @param choice - one of THEME_CHOICES.
     */
    function applyThemeChoice(choice) {
      themeChoice = THEME_CHOICES.includes(choice) ? choice : 'auto'
      saveThemeChoice(themeChoice)
      initMermaid()
    }

    /** Re-apply the theme when the shell flips light/dark. */
    function retuneTheme() {
      initMermaid()
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

    /** Rasterize an SVG string to a PNG blob at the given scale, over an optional fill. */
    function svgToPng(svgText, scale, fill) {
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
          if (fill !== null && fill !== undefined) {
            ctx2d.fillStyle = fill
            ctx2d.fillRect(0, 0, canvas.width, canvas.height)
          }
          ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height)
          URL.revokeObjectURL(url)
          canvas.toBlob((blob) => (blob === null ? reject(new Error('toBlob failed')) : resolve(blob)), 'image/png')
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg load failed')) }
        img.src = url
      })
    }

    /**
     * Whether the async Clipboard API is usable. It exists only in a secure
     * context; the shell runs on loopback (a secure origin), so this is normally
     * true — but a plain-HTTP remote access would lack it, and copy degrades to a
     * message rather than a crash.
     * @returns true when write is available.
     */
    function clipboardAvailable() {
      return typeof navigator !== 'undefined' && navigator.clipboard != null
        && typeof navigator.clipboard.write === 'function' && typeof ClipboardItem !== 'undefined'
    }

    /** Copy plain text (SVG markup, a ```mermaid fence) to the clipboard. */
    async function copyText(text) {
      if (typeof navigator === 'undefined' || navigator.clipboard?.writeText == null) return false
      await navigator.clipboard.writeText(text)
      return true
    }

    /** Copy an image blob (PNG) to the clipboard, when the API supports it. */
    async function copyImage(blob, mime) {
      if (!clipboardAvailable()) return false
      await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })])
      return true
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
      export: ['M12 3v12', 'M7 11l5 5 5-5', 'M5 21h14'],
      templates: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
      fullscreen: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'],
      fit: ['M4 4h16v16H4z', 'M9 9h6v6H9z'],
      close: ['M6 6l12 12', 'M18 6L6 18'],
      link: ['M9 12h6', 'M8.5 8H7a4 4 0 0 0 0 8h1.5', 'M15.5 8H17a4 4 0 0 1 0 8h-1.5'],
    }

    /** Build an inline SVG icon element from a list of path `d` strings. */
    function iconNode(paths, size) {
      const px = size ?? 16
      return h('svg', {
        width: px, height: px, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
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
      const [theme, setTheme] = React.useState(readThemeChoice)
      const [pngScale, setPngScale] = React.useState(2)
      const [pngBg, setPngBg] = React.useState('theme')
      const [fullscreen, setFullscreen] = React.useState(false)
      const [syncScroll, setSyncScroll] = React.useState(false)
      const [rendering, setRendering] = React.useState(false)
      const [composing, setComposing] = React.useState(false)
      const [panning, setPanning] = React.useState(false)

      const renderTimer = React.useRef(null)
      const previewRef = React.useRef(null)
      const rerenderRef = React.useRef(null)
      const taRef = React.useRef(null)      // the source textarea
      const gutterRef = React.useRef(null)  // the line-number column
      const hlRef = React.useRef(null)      // the highlight overlay <pre>
      const previewScrollRef = React.useRef(null) // the preview's scroll container
      const pendingSel = React.useRef(null)       // caret/selection to restore after a programmatic edit
      const didFitRef = React.useRef(false)       // auto-fit once per opened file
      const panRef = React.useRef(null)           // { x, y, scrollLeft, scrollTop } while dragging
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
        didFitRef.current = false
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
        if (code.trim() === '' || mermaidRuntime === null) { renderGuard.begin(); setSvg(''); setRendering(false); return }
        setRendering(true)
        renderTimer.current = setTimeout(() => {
          renderTimer.current = null
          const token = renderGuard.begin()
          if (code.length > MAX_SOURCE_CHARS) { setRenderError(`source exceeds ${MAX_SOURCE_CHARS} chars`); setSvg(''); setRendering(false); return }
          renderMermaid(code)
            .then((result) => { if (!renderGuard.isCurrent(token)) return; setSvg(result.svg); setRenderError(''); setRendering(false) })
            .catch((err) => { if (!renderGuard.isCurrent(token)) return; setSvg(''); setRenderError(String(err?.parseError ?? err?.message ?? err)); setRendering(false) })
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

      /** Escape leaves fullscreen while it is open. */
      React.useEffect(() => {
        if (!fullscreen || typeof window === 'undefined') return undefined
        const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [fullscreen])

      /** Close an open dropdown on an outside click or Escape, so menus never linger. */
      React.useEffect(() => {
        if ((!menuOpen && !templatesOpen) || typeof document === 'undefined') return undefined
        const dismiss = () => { setMenuOpen(false); setTemplatesOpen(false) }
        const onKey = (e) => { if (e.key === 'Escape') dismiss() }
        const onDown = (e) => { if (e.target?.closest?.('.mp-menu-wrap') === null) dismiss() }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onDown)
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
      }, [menuOpen, templatesOpen])

      /** Restore the caret/selection a programmatic edit (Tab, auto-close) asked for. */
      React.useEffect(() => {
        if (pendingSel.current === null) return
        const ta = taRef.current
        if (ta !== null) {
          ta.selectionStart = pendingSel.current.start
          ta.selectionEnd = pendingSel.current.end
          if (gutterRef.current !== null) gutterRef.current.scrollTop = ta.scrollTop
          if (hlRef.current !== null) { hlRef.current.scrollTop = ta.scrollTop; hlRef.current.scrollLeft = ta.scrollLeft }
        }
        pendingSel.current = null
      })

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
          // Re-check the disk mtime first: an edit that landed after the last poll
          // (or while the tab was hidden) must not be silently overwritten. Only
          // write once the change is acknowledged (dismissed) or absent.
          postJson(API.stat, { address })
            .then((st) => {
              const disk = st?.ok ? st.mtime : null
              if (disk !== null && loadedMtime.current !== null && disk !== loadedMtime.current && dismissedMtime.current !== disk) {
                setExternalMtime(disk)
                setSavedAt(`⚠ ${t('externalConflict')}`)
                return null
              }
              return postJson(API.write, { address, text })
            })
            .then((reply) => {
              if (reply == null) return
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
        zoom(step) { setZoom(z => clampZoom(z + step * 0.25)) },
        resetZoom() { setZoom(1) },
        // Fit the rendered diagram into the visible preview box.
        fitToView() {
          const sc = previewScrollRef.current
          const svgEl = previewRef.current?.querySelector('svg')
          if (sc == null || svgEl == null) { setZoom(1); return }
          const nat = svgNaturalSize(svgEl.getAttribute('viewBox'), svgEl.getAttribute('width'), svgEl.getAttribute('height'))
          setZoom(fitScale(sc.clientWidth, sc.clientHeight, nat.w, nat.h, 32))
        },
        // Scroll the line-number column and the highlight overlay with the textarea.
        onEditorScroll() {
          const ta = taRef.current
          if (ta == null) return
          if (gutterRef.current !== null) gutterRef.current.scrollTop = ta.scrollTop
          if (hlRef.current !== null) { hlRef.current.scrollTop = ta.scrollTop; hlRef.current.scrollLeft = ta.scrollLeft }
          // Optional proportional editor→preview scroll mirror (opt-in toggle).
          if (syncScroll && previewScrollRef.current !== null) {
            const ps = previewScrollRef.current
            const taMax = ta.scrollHeight - ta.clientHeight
            const psMax = ps.scrollHeight - ps.clientHeight
            if (taMax > 0 && psMax > 0) ps.scrollTop = (ta.scrollTop / taMax) * psMax
          }
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
          svgToPng(svgMarkup(el), pngScale, resolvePngFill(pngBg, isDark()))
            .then((blob) => download(blob, `${stripExt(fileName) || 'diagram'}.png`))
            .catch(() => setSavedAt(`⚠ ${t('saveFailed')}`))
        },
        copySvg() {
          const el = previewRef.current?.querySelector('svg')
          if (el == null) return
          copyText(svgMarkup(el)).then((ok) => setSavedAt(ok ? `✓ ${t('copied')}` : `⚠ ${t('copyFailed')}`)).catch(() => setSavedAt(`⚠ ${t('copyFailed')}`))
        },
        copyPng() {
          const el = previewRef.current?.querySelector('svg')
          if (el == null) return
          svgToPng(svgMarkup(el), pngScale, resolvePngFill(pngBg, isDark()))
            .then((blob) => copyImage(blob, 'image/png'))
            .then((ok) => setSavedAt(ok ? `✓ ${t('copied')}` : `⚠ ${t('copyFailed')}`))
            .catch(() => setSavedAt(`⚠ ${t('copyFailed')}`))
        },
        copyMermaid() {
          copyText(mermaidFence(text)).then((ok) => setSavedAt(ok ? `✓ ${t('copied')}` : `⚠ ${t('copyFailed')}`)).catch(() => setSavedAt(`⚠ ${t('copyFailed')}`))
        },
        setThemeChoice(choice) { setTheme(choice); applyThemeChoice(choice); scheduleRender(text) },
        toggleFullscreen() { setFullscreen(v => !v) },
        toggleSyncScroll() { setSyncScroll(v => !v) },
        // Drop the persisted draft and go back to the on-disk contents.
        discardDraft() { void pullFromDisk({ applyDraft: false }).then(() => { clearDraft(address); setDraftRestored(false); setSavedAt(t('reloaded')) }) },
      }

      const displayName = fileName || basenameOfAddress(address) || t('noAddress')
      const hasSvg = svg !== '' && renderError === ''
      const shownText = notFound ? '' : text
      const lineCount = shownText.length === 0 ? 1 : shownText.split('\n').length
      const highlighted = highlightMermaid(shownText)
      const diagramType = diagramTypeOf(shownText)
      const errLine = extractErrorLine(renderError)

      /** Fit-to-view once, when a diagram first renders for this file. */
      React.useEffect(() => {
        if (hasSvg && previewVisible && !didFitRef.current) {
          didFitRef.current = true
          actions.fitToView()
        }
      })

      /** Ctrl/⌘ + wheel zooms the canvas; a non-passive listener so it can cancel page scroll. */
      React.useEffect(() => {
        const sc = previewScrollRef.current
        if (sc == null) return undefined
        const onWheel = (e) => {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          setZoom(z => clampZoom(z + (e.deltaY < 0 ? 0.25 : -0.25)))
        }
        sc.addEventListener('wheel', onWheel, { passive: false })
        return () => sc.removeEventListener('wheel', onWheel)
      }, [previewVisible])

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
          h('span', { className: 'mp-sep' }),
          h(Button, { disabled: !hasSvg, onClick: actions.toggleFullscreen, title: t('fullscreen'), ariaLabel: t('fullscreen') }, iconNode(ICONS.fullscreen)),
          h('button', { type: 'button', className: `mp-seg-btn${syncScroll ? ' mp-seg-btn--on' : ''}`, title: t('syncScroll'), 'aria-label': t('syncScroll'), 'aria-pressed': syncScroll, onClick: actions.toggleSyncScroll }, iconNode(ICONS.link)),
          h('span', { className: 'mp-spacer' }),
          h('select', {
            className: 'mp-select mp-select--ghost', title: t('theme'), 'aria-label': t('theme'),
            value: theme, onChange: (e) => actions.setThemeChoice(e.target.value),
          }, THEME_CHOICES.map(choice => h('option', { key: choice, value: choice }, t(`theme${choice[0].toUpperCase()}${choice.slice(1)}`)))),
          h('div', { className: 'mp-menu-wrap' },
            h('button', { type: 'button', className: 'mp-seg-btn', onClick: actions.toggleMenu, 'aria-expanded': menuOpen, title: t('export'), 'aria-label': t('export') }, iconNode(ICONS.export), h('span', { className: 'mp-caret' }, '▾')),
            menuOpen ? h('div', { className: 'mp-menu mp-menu--wide' },
              h('div', { className: 'mp-menu-group' }, t('copyGroup')),
              h('button', { type: 'button', className: 'mp-menu-item', disabled: !hasSvg, onClick: () => { actions.copySvg(); actions.toggleMenu() } }, t('copySvg')),
              h('button', { type: 'button', className: 'mp-menu-item', disabled: !hasSvg, onClick: () => { actions.copyPng(); actions.toggleMenu() } }, t('copyPng')),
              h('button', { type: 'button', className: 'mp-menu-item', disabled: shownText.trim() === '', onClick: () => { actions.copyMermaid(); actions.toggleMenu() } }, t('copyMermaid')),
              h('div', { className: 'mp-menu-group' }, t('downloadGroup')),
              h('button', { type: 'button', className: 'mp-menu-item', disabled: !hasSvg, onClick: () => { actions.exportSvg(); actions.toggleMenu() } }, t('downloadSvg')),
              h('button', { type: 'button', className: 'mp-menu-item', disabled: !hasSvg, onClick: () => { actions.exportPng(); actions.toggleMenu() } }, t('downloadPng')),
              h('div', { className: 'mp-menu-group' }, t('pngOptions')),
              h('div', { className: 'mp-menu-row' },
                h('label', { className: 'mp-menu-field' }, t('pngScale'),
                  h('select', { className: 'mp-select', value: String(pngScale), onChange: (e) => setPngScale(Number(e.target.value)) },
                    [1, 2, 3, 4].map(s => h('option', { key: s, value: String(s) }, `${s}×`)))),
                h('label', { className: 'mp-menu-field' }, t('pngBg'),
                  h('select', { className: 'mp-select', value: pngBg, onChange: (e) => setPngBg(e.target.value) },
                    h('option', { value: 'theme' }, t('bgTheme')),
                    h('option', { value: 'white' }, t('bgWhite')),
                    h('option', { value: 'transparent' }, t('bgTransparent')))))) : null),
          h('div', { className: 'mp-menu-wrap' },
            h('button', { type: 'button', className: 'mp-seg-btn', onClick: actions.toggleTemplates, title: t('templates'), 'aria-label': t('templates') }, iconNode(ICONS.templates), h('span', { className: 'mp-caret' }, '▾')),
            templatesOpen && !readOnly ? h('div', { className: 'mp-menu' },
              TEMPLATES.map(tpl => h('button', {
                key: tpl.id, type: 'button', className: 'mp-menu-item',
                onClick: () => { actions.insertTemplate(tpl.code); actions.toggleTemplates() },
              }, tpl.id))) : null)),

        // Status line
        h('div', { className: 'mp-status' },
          h('span', { className: 'mp-status-name' }, displayName),
          diagramType !== '' ? h('span', { className: 'mp-badge' }, diagramType) : null,
          dirty ? h('span', { className: 'mp-status-dirty' }, `● ${t('dirty')}`) : null,
          draftRestored ? h('span', { className: 'mp-status-draft' },
            t('draftRestored'),
            h('button', { type: 'button', className: 'mp-discard', onClick: actions.discardDraft }, t('discardDraft'))) : null,
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
                h('pre', { ref: hlRef, className: `mp-highlight${composing ? ' mp-highlight--dim' : ''}`, 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: highlighted } }),
                h('textarea', {
                  ref: taRef,
                  className: `mp-textarea${composing ? ' mp-textarea--composing' : ''}`,
                  wrap: 'off',
                  readOnly,
                  spellCheck: false,
                  placeholder: t('placeholder'),
                  value: shownText,
                  onChange: e => actions.changeText(e.target.value),
                  onScroll: actions.onEditorScroll,
                  onCompositionStart: () => setComposing(true),
                  onCompositionEnd: () => setComposing(false),
                  onKeyDown: (e) => {
                    // Never fight the IME: while composing, leave every key to the browser.
                    if (e.nativeEvent?.isComposing || e.isComposing) return
                    const ta = taRef.current
                    if (ta == null || readOnly) return
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const r = indentBlock(text, ta.selectionStart, ta.selectionEnd, e.shiftKey ? -1 : 1)
                      pendingSel.current = { start: r.selStart, end: r.selEnd }
                      actions.changeText(r.value)
                      return
                    }
                    const close = closingFor(e.key)
                    if (close !== null && !e.ctrlKey && !e.metaKey && !e.altKey) {
                      e.preventDefault()
                      const s = ta.selectionStart
                      const en = ta.selectionEnd
                      if (s !== en) {
                        const sel = text.slice(s, en)
                        pendingSel.current = { start: s + 1, end: en + 1 }
                        actions.changeText(text.slice(0, s) + e.key + sel + close + text.slice(en))
                      } else {
                        pendingSel.current = { start: s + 1, end: s + 1 }
                        actions.changeText(text.slice(0, s) + e.key + close + text.slice(s))
                      }
                    }
                  },
                }))) : null,
            (editorVisible && previewVisible) ? h('div', { className: 'mp-splitter', onPointerDown: actions.startSplitDrag }) : null,
            previewVisible ? h('div', { className: 'mp-preview', style: view === 'split' ? { flex: `0 1 ${(1 - splitRatio) * 100}%` } : undefined },
              h('div', {
                className: `mp-preview-scroll${panning ? ' mp-preview-scroll--panning' : ''}`,
                ref: previewScrollRef,
                onDoubleClick: () => actions.fitToView(),
                onPointerDown: (e) => {
                  const sc = previewScrollRef.current
                  if (sc == null || e.button !== 0) return
                  panRef.current = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop }
                  sc.setPointerCapture?.(e.pointerId)
                  setPanning(true)
                },
                onPointerMove: (e) => {
                  const sc = previewScrollRef.current
                  const p = panRef.current
                  if (sc == null || p == null) return
                  sc.scrollLeft = p.sl - (e.clientX - p.x)
                  sc.scrollTop = p.st - (e.clientY - p.y)
                },
                onPointerUp: (e) => { previewScrollRef.current?.releasePointerCapture?.(e.pointerId); panRef.current = null; setPanning(false) },
                onPointerCancel: () => { panRef.current = null; setPanning(false) },
              },
                h('div', { ref: previewRef, className: 'mp-canvas', style: { zoom: String(zoom) } },
                  notFound ? h('div', { className: 'mp-preview-empty' }, t('notFound'))
                    : loadError !== '' ? h('div', { className: 'mp-error' }, h('div', { className: 'mp-error-title' }, t('readFailed')), h('pre', { className: 'mp-error-body' }, loadError))
                      : renderError !== '' ? h('div', { className: 'mp-error' }, h('div', { className: 'mp-error-title' }, errLine === null ? t('renderError') : `${t('renderError')} · ${t('line')} ${errLine}`), h('pre', { className: 'mp-error-body' }, renderError))
                        : hasSvg ? h('div', { className: 'mp-svg', dangerouslySetInnerHTML: { __html: svg } })
                          : h('div', { className: 'mp-preview-empty' }, t('emptyPreview')))),
              rendering ? h('div', { className: 'mp-busy', 'aria-hidden': 'true' }, h('span', { className: 'mp-spinner' })) : null,
              h('div', { className: 'mp-zoombar' },
                h('button', { type: 'button', className: 'mp-zoom-btn', title: t('zoomOut'), 'aria-label': t('zoomOut'), onClick: () => actions.zoom(-1) }, '−'),
                h('button', { type: 'button', className: 'mp-zoom-pct', title: t('zoomReset'), 'aria-label': t('zoomReset'), onClick: actions.resetZoom }, `${Math.round(zoom * 100)}%`),
                h('button', { type: 'button', className: 'mp-zoom-btn', title: t('zoomFit'), 'aria-label': t('zoomFit'), onClick: actions.fitToView }, iconNode(ICONS.fit, 14)),
                h('button', { type: 'button', className: 'mp-zoom-btn', title: t('zoomIn'), 'aria-label': t('zoomIn'), onClick: () => actions.zoom(1) }, '+'))) : null),
        // Fullscreen preview overlay (Escape or the close button leaves it).
        fullscreen && hasSvg ? h('div', { className: 'mp-fs' },
          h('div', { className: 'mp-fs-head' },
            h('span', { className: 'mp-status-name' }, displayName),
            diagramType !== '' ? h('span', { className: 'mp-badge' }, diagramType) : null,
            h('span', { className: 'mp-spacer' }),
            h('button', { type: 'button', className: 'mp-zoom-btn', title: t('zoomOut'), onClick: () => actions.zoom(-1) }, '−'),
            h('button', { type: 'button', className: 'mp-zoom-pct', title: t('zoomReset'), onClick: actions.resetZoom }, `${Math.round(zoom * 100)}%`),
            h('button', { type: 'button', className: 'mp-zoom-btn', title: t('zoomFit'), 'aria-label': t('zoomFit'), onClick: actions.fitToView }, iconNode(ICONS.fit, 14)),
            h('button', { type: 'button', className: 'mp-zoom-btn', title: t('zoomIn'), onClick: () => actions.zoom(1) }, '+'),
            h('button', { type: 'button', className: 'mp-zoom-btn', title: t('close'), 'aria-label': t('close'), onClick: actions.toggleFullscreen }, iconNode(ICONS.close))),
          h('div', { className: 'mp-fs-body' },
            h('div', { className: 'mp-svg', style: { zoom: String(zoom) }, dangerouslySetInnerHTML: { __html: svg } }))) : null)
    }

    /* ------------------------------------------------------------------ *
     * Stylesheet (one owned, tagged node the loader reaps with us)
     * ------------------------------------------------------------------ */

    const STYLES = `
.mp-shell{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-fg,inherit);font-size:13px;box-sizing:border-box}
*{box-sizing:border-box}
.mp-toolbar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border,#ddd);flex-wrap:wrap}
.mp-btn{display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dsw-alias-fg-muted,#666);border-radius:7px;padding:5px;cursor:pointer;line-height:1}
.mp-btn:hover{background:var(--dsw-alias-bg-layer-2,#eee);color:var(--dsw-alias-fg,#222)}
.mp-btn--primary{color:var(--dsw-alias-accent,#4a7dff)}
.mp-btn--primary:hover{background:rgba(74,125,255,.12);color:var(--dsw-alias-accent,#4a7dff)}
.mp-btn--disabled{opacity:.4;cursor:default;background:transparent}
.mp-icon{display:block}
.mp-sep{width:1px;height:18px;background:var(--dsw-alias-border,#ddd);margin:0 2px}
.mp-spacer{flex:1}
.mp-seg{display:inline-flex;gap:2px}
.mp-seg-btn{display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dsw-alias-fg-muted,#666);border-radius:6px;padding:5px 7px;cursor:pointer;font-size:12px}
.mp-seg-btn:hover{background:var(--dsw-alias-bg-layer-2,#eee);color:var(--dsw-alias-fg,#222)}
.mp-seg-btn--on{background:var(--dsw-alias-bg-layer-2,#e8e8ea);color:var(--dsw-alias-accent,#4a7dff)}
.mp-seg-btn--on:hover{background:var(--dsw-alias-bg-layer-2,#e8e8ea);color:var(--dsw-alias-accent,#4a7dff)}
.mp-menu-wrap{position:relative}
.mp-menu{position:absolute;right:0;top:100%;margin-top:4px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border,#ccc);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);z-index:30;min-width:140px;padding:4px}
.mp-menu-item{display:block;width:100%;text-align:left;border:none;background:transparent;color:inherit;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12.5px}
.mp-menu-item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f2f2f2)}
.mp-menu-item:disabled{opacity:.4;cursor:default}
.mp-menu--wide{min-width:220px}
.mp-menu-group{padding:6px 10px 2px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-fg-muted,#aaa)}
.mp-menu-row{display:flex;align-items:center;gap:8px;padding:4px 10px 8px}
.mp-menu-field{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-fg-muted,#888)}
.mp-select{border:1px solid var(--dsw-alias-border,#c8c8c8);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;border-radius:6px;padding:3px 6px;font-size:12px;cursor:pointer;max-width:150px}
.mp-select--ghost{border:none;background:transparent;color:var(--dsw-alias-fg-muted,#666);padding:5px 6px}
.mp-select--ghost:hover{background:var(--dsw-alias-bg-layer-2,#eee);color:var(--dsw-alias-fg,#222)}
.mp-caret{font-size:9px;margin-left:1px;opacity:.7}
.mp-badge{font-size:10.5px;padding:1px 7px;border-radius:20px;background:var(--dsw-alias-bg-layer-2,#eee);color:var(--dsw-alias-fg-muted,#777);font-family:ui-monospace,monospace}
.mp-status-draft{display:inline-flex;align-items:center;gap:6px;color:#b26a00}
.mp-discard{border:1px solid var(--dsw-alias-border,#c8c8c8);background:transparent;color:inherit;border-radius:6px;padding:1px 7px;cursor:pointer;font-size:11px}
.mp-discard:hover{background:var(--dsw-alias-bg-layer-2,#eee)}
.mp-fs{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-0,#fafafa);color:var(--dsw-alias-fg,inherit)}
.mp-fs-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border,#ddd)}
.mp-fs-body{flex:1;min-height:0;overflow:auto;display:grid;place-items:center;padding:20px}
.mp-fs-body .mp-svg{display:inline-block}
.mp-status{display:flex;align-items:center;gap:10px;padding:3px 10px;border-bottom:1px solid var(--dsw-alias-border,#eee);font-size:11.5px;color:var(--dsw-alias-fg-muted,#888)}
.mp-status-name{font-weight:600;color:var(--dsw-alias-fg,#333)}
.mp-status-dirty{color:#e0902a}
.mp-status-runtime--bad{color:#d1495b}
.mp-banner{display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(224,144,42,.12);border-bottom:1px solid #e0902a;color:var(--dsw-alias-fg,#5a4a2a);font-size:12px}
.mp-banner-text{flex:1}
.mp-workspace{display:flex;flex:1;min-height:0;overflow:hidden}
.mp-editor{flex:1 1 50%;min-width:0;display:flex;overflow:hidden}
.mp-code{position:relative;flex:1 1 auto;min-width:0}
.mp-gutter,.mp-highlight,.mp-textarea{font-family:var(--dsw-font-markdown-code-block-font-family, var(--ds-font-family-code, ui-monospace, SFMono-Regular, 'JetBrains Mono', 'Fira Code', Consolas, monospace));font-size:var(--dsw-font-markdown-code-block-font-size, 12px);line-height:var(--dsw-font-markdown-code-block-line-height, 19px);font-weight:var(--dsw-font-markdown-code-block-font-weight, 400);tab-size:2}
.mp-gutter{flex:0 0 auto;overflow:hidden;white-space:pre;text-align:right;color:var(--dsw-alias-fg-muted,#b0b0b0);background:var(--dsw-alias-bg-layer-0,#fafafa);border-right:1px solid var(--dsw-alias-border,#eee);padding:10px 8px 10px 10px;user-select:none;cursor:default}
.mp-highlight,.mp-textarea{margin:0;padding:10px 12px;border:0;white-space:pre}
.mp-highlight{position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;color:var(--dsw-alias-fg,#1e1e1e);background:var(--dsw-alias-bg-layer-1,#fff)}
.mp-textarea{position:absolute;inset:0;z-index:2;overflow:auto;background:transparent;color:transparent;caret-color:var(--dsw-alias-fg,#1e1e1e);resize:none;outline:none}
.mp-textarea::placeholder{color:var(--dsw-alias-fg-muted,#9a9a9a)}
.mp-textarea::-webkit-scrollbar{width:8px;height:8px;cursor:default;background:transparent}
.mp-textarea::-webkit-scrollbar-thumb{background:var(--dsw-alias-border,#c8c8c8);border-radius:8px;border:2px solid transparent;background-clip:padding-box;cursor:default}
.mp-textarea::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-fg-muted,#999)}
.mp-textarea::-webkit-scrollbar-corner{background:transparent}
.mp-textarea--composing{color:var(--dsw-alias-fg,#1e1e1e)}
.mp-highlight--dim{opacity:0}
.mp-busy{position:absolute;top:8px;right:8px;z-index:5}
.mp-spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--dsw-alias-border,#ccc);border-top-color:var(--dsw-alias-accent,#4a7dff);border-radius:50%;animation:mp-spin .7s linear infinite}
@keyframes mp-spin{to{transform:rotate(360deg)}}
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
.mp-preview-scroll{position:absolute;inset:0;overflow:auto;user-select:none;cursor:grab}
.mp-preview-scroll--panning{cursor:grabbing}
.mp-zoombar{position:absolute;right:10px;bottom:10px;z-index:6;display:flex;align-items:center;gap:2px;padding:2px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border,#ddd);box-shadow:0 2px 8px rgba(0,0,0,.14)}
.mp-zoom-btn,.mp-zoom-pct{border:none;background:transparent;color:inherit;cursor:pointer;border-radius:7px;font-size:13px;line-height:1;padding:4px 7px}
.mp-zoom-pct{font-size:11.5px;min-width:44px;text-align:center;font-variant-numeric:tabular-nums}
.mp-zoom-btn:hover,.mp-zoom-pct:hover{background:var(--dsw-alias-bg-layer-2,#eee)}
.mp-canvas{padding:16px;display:inline-block}
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
      resolveTheme, mermaidFence, resolvePngFill, THEME_CHOICES,
      diagramTypeOf, extractErrorLine, closingFor, indentBlock,
      clampZoom, svgNaturalSize, fitScale,
    }
    return module.exports
  },
})
