/**
 * The small HTTP vocabulary every route in this plugin speaks.
 *
 * The host runs inside the DSH process with no resolvable third-party
 * dependencies of its own — the plugin is linked into a profile whose
 * `node_modules` are not on this package's resolution path — so everything here
 * is built on `node:http` shapes plus Node's globals.
 *
 * Discipline, borrowed from the shipped route families and from dsh-photo:
 *
 * - one JSON writer, one error writer, so no route invents its own envelope;
 * - a bounded request body, so a malformed POST cannot exhaust memory;
 * - no exception escapes a handler (the webserver answers a throwing handler
 *   `400` with an empty body, which tells the client nothing);
 * - every read route is fenced to loopback, not just the writes: the listing
 *   exposes the names of the user's files, and read returns their contents.
 */
import { MpError } from './files.js'

/** Largest accepted JSON request body (2 MiB — a write carries a whole diagram source). */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/**
 * Write one JSON response.
 * @param res - server response.
 * @param status - HTTP status.
 * @param body - JSON-serializable body.
 */
export function writeJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

/**
 * Write the refusal one failure stands for.
 *
 * An `MpError` carries its own status and code. Anything else is a bug in a
 * handler, reported as a generic `mp/failed` with the message kept in the log
 * rather than on the wire.
 *
 * @param res - server response.
 * @param error - the thrown value.
 * @param logger - optional `{ warn }` sink.
 * @returns the status written.
 */
export function writeError(res, error, logger) {
  if (error instanceof MpError) {
    writeJson(res, error.status, error.payload)
    return error.status
  }
  logger?.warn?.(`dsh-mermaid-preview: handler failed: ${error?.stack ?? error}`)
  writeJson(res, 500, {
    ok: false,
    error: { code: 'mp/failed', message: 'the mermaid plugin failed to answer this request' },
  })
  return 500
}

/**
 * Read and parse a bounded JSON request body.
 *
 * @param req - incoming request.
 * @returns the parsed object; `{}` for an empty body.
 * @throws {MpError} `mp/bad-body` when the body is oversized or not a JSON object.
 */
export async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      req.destroy()
      throw new MpError('mp/bad-body', 'the request body is too large', 413)
    }
    chunks.push(chunk)
  }
  if (total === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new MpError('mp/bad-body', 'the request body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MpError('mp/bad-body', 'the request body must be a JSON object')
  }
  return parsed
}

/**
 * Whether a request originates on the loopback interface.
 *
 * `127.0.0.1`, `::1` and the IPv4-mapped form all count; anything else is a
 * network peer and must clear the shell's own fence.
 *
 * @param req - incoming request.
 * @returns true when the peer is this machine.
 */
export function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || address.startsWith('127.')
}

/**
 * Decide whether a peer may reach these routes.
 *
 * Layered on purpose, because the two layers answer different questions:
 *
 * 1. **Loopback is admitted outright.** That peer is the machine's own user, and
 *    it is the path the in-app panel actually uses. Sending it through the
 *    shell's browser-authentication fence would risk rejecting the shell's own
 *    transport, a worse failure than the one it would prevent, since the
 *    webserver binds to `127.0.0.1` by default.
 * 2. **Anything else is decided by the shell's fence** (`ctx.connection`). When
 *    that service is absent the route stays closed rather than trusting a
 *    network peer on the strength of a missing dependency.
 *
 * @param ctx - host Context.
 * @param req - incoming request.
 * @returns the rejection status, or `undefined` when the peer is admitted.
 */
export function peerRejection(ctx, req) {
  if (isLoopback(req)) return undefined
  const connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
  if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection({ headers: req.headers ?? {} })
      return rejection === 401 || rejection === 403 ? rejection : undefined
    } catch {
      /* an incompatible fence shape must not open the route */
    }
  }
  return 403
}

/**
 * The query string of a request as a plain object.
 * @param req - incoming request.
 * @returns one string per parameter; a repeated parameter keeps its first value.
 */
export function queryOf(req) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const out = {}
  for (const [key, value] of url.searchParams) {
    if (!(key in out)) out[key] = value
  }
  return out
}

/**
 * Read one required string parameter.
 * @param source - the query or body object.
 * @param name - the parameter's name.
 * @returns the trimmed value.
 * @throws {MpError} `mp/bad-request` when it is absent or empty.
 */
export function requiredString(source, name) {
  const value = source?.[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MpError('mp/bad-request', `"${name}" is required`)
  }
  return value.trim()
}
