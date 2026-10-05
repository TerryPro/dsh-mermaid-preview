/**
 * The route family this plugin's host half serves under `/api/dsh-mermaid-preview/*`.
 *
 * Every handler is wrapped once, so peer fencing and error translation are
 * properties of the family rather than of each route: a handler body only ever
 * throws an `MpError` and only ever answers through the JSON writer. Three routes:
 *
 * - `state` (GET) hands the client the Mermaid runtime's content revision, so the
 *   browser can import the bundle with a cache-busting `?rev=` and rebuild busts it;
 * - `read` (POST `{ address }`) returns the text a right-sidebar file tab opened —
 *   the address is the opaque `dsh-resource://file/…` the body read from its tab,
 *   resolved here against the Session workspace root (reads are unconfined, matching
 *   the shipped document preview);
 * - `write` (POST `{ address, text }`) saves the edited text back, but ONLY inside
 *   the Session's workspace root — an address that resolves outside it is refused.
 *
 * The client never sends a filesystem path; it sends the resource address the
 * shell gave the tab, and the host is the only thing that turns it into a path.
 */
import { MpError, readFileAt, statAt, writeFileAt } from './files.js'
import { basenameFromAddress, isUnderDir, parseFileAddress, resolveAddress } from './address.js'
import { peerRejection, readJsonBody, requiredString, writeJson, writeError } from './http.js'

/** The exact paths of the route family (mirrored by the client's API table). */
export const ROUTES = {
  state: '/api/dsh-mermaid-preview/state',
  read: '/api/dsh-mermaid-preview/read',
  write: '/api/dsh-mermaid-preview/write',
  stat: '/api/dsh-mermaid-preview/stat',
}

/**
 * Turn a request's `address` into an absolute path, resolving the Session root
 * when the address is session-scoped and relative.
 * @param parsed - the parsed address.
 * @param workspaceRootOf - `sessionId => cwd | undefined`.
 * @returns `{ absolute, cwd }`.
 * @throws {MpError} `mp/bad-address`, `mp/no-workspace`.
 */
function addressToPath(parsed, workspaceRootOf) {
  if (parsed === undefined) throw new MpError('mp/bad-address', 'the address is not a dsh-resource file address')
  const cwd = parsed.scope === 'session' ? workspaceRootOf(parsed.sessionId) : undefined
  const resolved = resolveAddress(parsed, cwd)
  if (resolved.error !== undefined) throw new MpError(resolved.error, resolved.error === 'mp/no-workspace' ? 'the session workspace root is unknown' : 'unresolvable address')
  return { absolute: resolved.absolute, cwd }
}

/**
 * Build the route table.
 * @param options.ctx - host Context, for the connection fence.
 * @param options.workspaceRootOf - `sessionId => the Session's workspace cwd | undefined`.
 * @param options.logger - `{ info, warn }` sink.
 * @param options.runtimeRevision - async `() => string`, the Mermaid bundle's content token.
 * @returns the routes to register on `ctx.webServer`.
 */
export function makeRoutes({ ctx, workspaceRootOf, logger, runtimeRevision }) {
  /**
   * Wrap one handler with the family's fence and error discipline.
   * @param handler - the route body.
   * @returns the `WebRoute['handler']` to register.
   */
  function route(handler) {
    return async (req, res) => {
      const rejection = peerRejection(ctx, req)
      if (rejection !== undefined) {
        writeJson(res, rejection, { ok: false, error: { code: 'mp/forbidden', message: 'this route only answers this machine' } })
        return
      }
      try {
        await handler(req, res)
      } catch (error) {
        if (!res.headersSent) writeError(res, error, logger)
        else res.destroy()
      }
    }
  }

  return [
    {
      kind: 'exact',
      path: ROUTES.state,
      handler: route(async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new MpError('mp/bad-method', 'use GET to read the state', 405)
        writeJson(res, 200, { ok: true, runtimeRev: typeof runtimeRevision === 'function' ? await runtimeRevision() : 'unbuilt' })
      }),
    },

    {
      kind: 'exact',
      path: ROUTES.read,
      handler: route(async (req, res) => {
        if (req.method !== 'POST') throw new MpError('mp/bad-method', 'use POST to read a file', 405)
        const body = await readJsonBody(req)
        const address = requiredString(body, 'address')
        const parsed = parseFileAddress(address)
        const { absolute } = addressToPath(parsed, workspaceRootOf)
        const file = await readFileAt(absolute)
        writeJson(res, 200, { ok: true, address, name: basenameFromAddress(parsed), ...file })
      }),
    },

    {
      kind: 'exact',
      path: ROUTES.write,
      handler: route(async (req, res) => {
        if (req.method !== 'POST') throw new MpError('mp/bad-method', 'use POST to write a file', 405)
        const body = await readJsonBody(req)
        const address = requiredString(body, 'address')
        const text = typeof body.text === 'string' ? body.text : ''
        const parsed = parseFileAddress(address)
        const { absolute, cwd } = addressToPath(parsed, workspaceRootOf)
        // A save must land inside the Session's workspace; out-of-root links open
        // read-only, which is the whole write confinement rule.
        if (cwd === undefined || !isUnderDir(absolute, cwd)) {
          throw new MpError('mp/outside-workspace', 'this file is outside the session workspace and cannot be saved here', 403)
        }
        const result = await writeFileAt(absolute, text)
        logger?.info?.(`dsh-mermaid-preview: ${result.created ? 'created' : 'saved'} ${basenameFromAddress(parsed)}`)
        writeJson(res, 200, { ok: true, address, name: basenameFromAddress(parsed), ...result })
      }),
    },

    {
      kind: 'exact',
      path: ROUTES.stat,
      handler: route(async (req, res) => {
        if (req.method !== 'POST') throw new MpError('mp/bad-method', 'use POST to stat a file', 405)
        const body = await readJsonBody(req)
        const address = requiredString(body, 'address')
        const parsed = parseFileAddress(address)
        const { absolute } = addressToPath(parsed, workspaceRootOf)
        const info = await statAt(absolute)
        writeJson(res, 200, { ok: true, address, ...info })
      }),
    },
  ]
}
