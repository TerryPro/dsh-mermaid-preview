/**
 * The `dsh-resource://file/…` address grammar, host side.
 *
 * The right sidebar names an open file with a resource address, and a body reads
 * it back through `useTabInfo().tab.navigation.address`. The client does not
 * import the internal `@deepseek-ai/dsh-util-workspace-path` package (a linked
 * plugin's module table cannot resolve it, and the purity convention keeps
 * runtime collaboration to method calls), so the client forwards the opaque
 * address string to these routes and the host parses it here. This mirrors the
 * shipped grammar exactly:
 *
 * - `dsh-resource://file/session/<sessionId>/<path>` — a file the Session's Host
 *   workspace resolves; `<path>` is workspace-relative, or absolute when the
 *   file sits outside the root (`fileAddressFor` keeps an out-of-root path
 *   absolute but session-scoped).
 * - `dsh-resource://file/absolute/<path>` — a bare absolute path, no Session.
 *
 * Every id and path segment is component-encoded (`encodeURIComponent`, with
 * `:` restored literal so a drive letter reads as written). Query/fragment
 * suffixes are ignored and `.`/`..` are not resolved here — `path.resolve` does
 * that, and containment is checked by the routes.
 */
import path from 'node:path'

/** The scheme + type every file address opens with. */
const FILE_PREFIX = 'dsh-resource://file/'

/** Whether a first decoded segment is a Windows drive (`C:`). */
function isDriveSegment(segment) {
  return segment !== undefined && /^[A-Za-z]:$/.test(segment)
}

/**
 * Parse a `dsh-resource://file/…` address into its scope, session id and path.
 * @param address - the raw resource address.
 * @returns `{ scope:'session', sessionId, path }` | `{ scope:'absolute', path }` | undefined.
 */
export function parseFileAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(FILE_PREFIX)) return undefined
  let body = address.slice(FILE_PREFIX.length)
  const end = body.search(/[?#]/u)
  if (end !== -1) body = body.slice(0, end)
  const segments = body.split('/')
  const scope = segments[0]
  const rest = segments.slice(1)
  try {
    if (scope === 'session') {
      const [id, ...pathSegments] = rest
      if (id === undefined || id === '' || pathSegments.length === 0) return undefined
      return { scope: 'session', sessionId: decodeURIComponent(id), path: pathSegments.map(decodeURIComponent).join('/') }
    }
    if (scope === 'absolute') {
      const unc = rest[0] === '' && rest.length > 1
      const decoded = (unc ? rest.slice(1) : rest).map(decodeURIComponent)
      if (decoded.length === 0 || decoded[0] === '') return undefined
      return {
        scope: 'absolute',
        path: unc ? `//${decoded.join('/')}` : (isDriveSegment(decoded[0]) ? decoded.join('/') : `/${decoded.join('/')}`),
      }
    }
    return undefined
  } catch {
    // decodeURIComponent throws URIError on a malformed escape.
    return undefined
  }
}

/** Whether a decoded path is already absolute (POSIX `/`, Windows drive, or UNC). */
export function looksAbsolute(candidate) {
  return candidate.startsWith('/') || candidate.startsWith('//') || /^[A-Za-z]:[\\/]/u.test(candidate)
}

/**
 * Resolve a parsed address to an absolute host path.
 *
 * A session-scoped relative path joins onto the Session's workspace root; a path
 * that is already absolute (an out-of-root file the Session still names) is used
 * as-is. An absolute-scope address needs no root.
 *
 * @param parsed - the result of {@link parseFileAddress}.
 * @param cwd - the Session workspace root, when the scope needs one and it is known.
 * @returns `{ absolute }`, or `{ error }` when it cannot be resolved.
 */
export function resolveAddress(parsed, cwd) {
  if (parsed === undefined) return { error: 'mp/bad-address' }
  if (parsed.scope === 'absolute') return { absolute: path.resolve(parsed.path) }
  if (looksAbsolute(parsed.path)) return { absolute: path.resolve(parsed.path) }
  if (cwd === undefined || cwd === '') return { error: 'mp/no-workspace' }
  return { absolute: path.resolve(cwd, parsed.path), cwd: path.resolve(cwd) }
}

/**
 * Whether `child` is at or under `dir` after resolution.
 * @param child - a candidate absolute path.
 * @param dir - a directory absolute path.
 * @returns true when child lives inside dir.
 */
export function isUnderDir(child, dir) {
  if (child === undefined || dir === undefined || dir === '') return false
  const resolvedChild = path.resolve(child)
  const resolvedDir = path.resolve(dir)
  const prefix = resolvedDir.endsWith(path.sep) ? resolvedDir : `${resolvedDir}${path.sep}`
  return resolvedChild === resolvedDir || resolvedChild.startsWith(prefix)
}

/**
 * The file name one address points at (decoded last segment).
 * @param parsed - the result of {@link parseFileAddress}.
 * @returns the basename, or `''` for the workspace root itself.
 */
export function basenameFromAddress(parsed) {
  if (parsed === undefined) return ''
  const segments = String(parsed.path ?? '').split('/').filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : ''
}
