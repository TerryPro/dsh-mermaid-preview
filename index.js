/**
 * dsh-mermaid-preview — host half.
 *
 * Serves two things and mounts nothing else:
 *
 * 1. one route family (`/api/dsh-mermaid-preview/*`, see lib/routes.js) that
 *    reads and writes the Mermaid file a right-sidebar tab has open, addressed by
 *    its `dsh-resource://file/…` resource address;
 * 2. one immutable static route (`/dsh-mermaid-preview/mermaid-runtime.js`)
 *    that ships the esbuild-bundled Mermaid library the browser half imports to
 *    render diagrams. It lives here rather than on a CDN so the panel works
 *    fully offline and the Mermaid version is pinned to whatever this package
 *    was built against.
 *
 * The browser half (`./client`) renders the tab; the client bundle is loaded by
 * the shell's module loader, independent of this module.
 *
 * Why a host half exists at all: a browser cannot read or write a host file, so
 * this plugin owns the one capability the editor needs — "read the file this tab
 * names, and save my edits back into the session workspace." The client forwards
 * the opaque resource address the shell handed the tab; the host parses it and
 * resolves it against the Session's workspace root (`ctx.sessions.get(id).header
 * .cwd`), the same source the shipped document preview reads through. Writes are
 * confined to that root.
 *
 * Dependencies: `webServer` mounts the routes; `sessions` resolves a session id
 * to its workspace root. Nothing else.
 */
import { fileURLToPath } from 'node:url'

import { makeRoutes, ROUTES } from './lib/routes.js'

/** Stable cordis plugin name (must match the patch row). */
export const name = 'dsh-mermaid-preview'

/** Services required before the routes can mount. */
export const inject = ['webServer', 'sessions']

/** The public path the bundled Mermaid runtime is served from. */
export const RUNTIME_PATH = '/dsh-mermaid-preview/mermaid-runtime.js'

/** On-disk location of the built runtime bundle. */
const runtimeFile = new URL('./lib/mermaid-runtime.js', import.meta.url)
const runtimePath = fileURLToPath(runtimeFile)

/**
 * A cheap content revision for the runtime bundle: its size and mtime, hashed.
 *
 * The client requests the runtime with `?rev=<this>` so a rebuild that changes
 * the bytes busts the browser's immutable cache, while an unchanged bundle keeps
 * its cache hit. Stat-ing the file costs nothing next to reading a multi-megabyte
 * bundle, and an absent bundle (not yet built) reports the `unbuilt` revision —
 * the runtime route then answers 404 and the client shows a clear error.
 *
 * @returns a short revision token for the current bundle on disk.
 */
async function runtimeRevision() {
  try {
    const { stat } = await import('node:fs/promises')
    const info = await stat(runtimePath)
    const crypto = await import('node:crypto')
    return crypto.createHash('sha1').update(`${info.size}-${Math.floor(info.mtimeMs)}`).digest('hex').slice(0, 12)
  } catch {
    return 'unbuilt'
  }
}

/**
 * A logger that never throws when the host's logger shape differs.
 *
 * Logging runs inside request handling, so an incompatible logger must cost the
 * message, never the response.
 *
 * @param ctx - host context.
 * @returns the logger surface the routes use.
 */
function makeLogger(ctx) {
  const emit = (level, message) => {
    try {
      ctx.logger?.[level]?.(message)
    } catch {
      /* logging must never break a request */
    }
  }
  return {
    info: message => emit('info', message),
    warn: message => emit('warn', message),
  }
}

/**
 * The workspace root one Session resolves to, for turning a relative session file
 * address into an absolute path. `undefined` when the Session is unknown or holds
 * no cwd; the routes then refuse a relative read/write rather than guess.
 *
 * @param ctx - host context carrying `sessions`.
 * @returns `sessionId => cwd | undefined`.
 */
function makeWorkspaceRootOf(ctx) {
  return (sessionId) => {
    try {
      const cwd = ctx.sessions?.get?.(sessionId)?.header?.cwd
      return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
    } catch {
      return undefined
    }
  }
}

/**
 * Mount the file routes and the Mermaid runtime.
 *
 * @param ctx - host plugin context carrying `webServer` and `sessions`.
 */
export function apply(ctx) {
  const logger = makeLogger(ctx)
  const routes = makeRoutes({ ctx, workspaceRootOf: makeWorkspaceRootOf(ctx), logger, runtimeRevision })

  for (const route of routes) ctx.effect(() => ctx.webServer.register(route))

  // The bundled Mermaid runtime: served once per boot, cacheable forever by the
  // browser (the client requests it with a content-hash revision in the query, so
  // an immutable max-age is safe across rebuilds). A missing bundle — a checkout
  // that has not run `npm run build` — answers 404; the client then shows a clear
  // "Mermaid runtime unavailable" state rather than a blank pane.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RUNTIME_PATH,
    async handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const { readFile } = await import('node:fs/promises')
        const body = await readFile(runtimePath)
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'content-length': String(body.length),
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      } catch {
        logger.warn(`dsh-mermaid-preview: Mermaid runtime not built — expected ${runtimePath}. Run "npm run build".`)
        res.writeHead(404)
        res.end()
      }
    },
  }), 'dsh-mermaid-preview: mermaid runtime route')

  logger.info(`dsh-mermaid-preview: mounted ${routes.length} routes under ${ROUTES.state.replace(/\/state$/u, '/*')} + ${RUNTIME_PATH}`)
}
