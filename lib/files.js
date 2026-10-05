/**
 * Absolute-path file IO for the Mermaid editor plane.
 *
 * The routes resolve a `dsh-resource://file/…` address to one absolute host path
 * (lib/address.js) and hand it here; this module owns reading and writing UTF-8
 * text at that path and the failure vocabulary the client switches on.
 *
 * Containment — refusing a write outside the Session's workspace root — is the
 * ROUTE's decision (it knows the root), not this module's: this only reads or
 * writes the single path it is given, bounded by size and a text sniff. Reads are
 * unconfined on purpose (a diagram can be linked from anywhere and previewing it
 * is safe, matching the shipped document preview); the write path is where the
 * route applies the workspace rule before calling {@link writeFileAt}.
 */
import fs from 'node:fs/promises'

/** Extensions this plugin treats as Mermaid source (lowercased, no dot). */
export const MERMAID_EXTS = ['mmd', 'mermaid']

/** Largest file the read route returns, and the largest body the write route accepts (2 MiB). */
export const TEXT_LIMIT_BYTES = 2 * 1024 * 1024

/**
 * One refusal, carrying the wire code the client switches on.
 *
 * Handlers never let anything else escape: an unexpected error would be answered
 * `400` with an empty body by the webserver, which tells the client nothing.
 * Every expected failure is one of these.
 */
export class MpError extends Error {
  /**
   * @param code stable wire code, e.g. `mp/outside-workspace`.
   * @param message human-readable reason.
   * @param status HTTP status to answer with.
   */
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'MpError'
    this.code = code
    this.status = status
  }

  /** The JSON body this refusal is written as. */
  get payload() {
    return { ok: false, error: { code: this.code, message: this.message } }
  }
}

/**
 * Read an absolute path as UTF-8 text.
 * @param absolute - the resolved file path.
 * @returns `{ text, size, mtime }`.
 * @throws {MpError} `mp/missing`, `mp/not-a-file`, `mp/too-large`, `mp/not-text`, `mp/fs-error`.
 */
export async function readFileAt(absolute) {
  let stats
  try {
    stats = await fs.stat(absolute)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new MpError('mp/missing', 'the file does not exist', 404)
    throw new MpError('mp/fs-error', `cannot read the file: ${error?.code ?? error}`, 500)
  }
  if (!stats.isFile()) throw new MpError('mp/not-a-file', 'that path is not a regular file')
  if (stats.size > TEXT_LIMIT_BYTES) throw new MpError('mp/too-large', `the file is larger than ${Math.floor(TEXT_LIMIT_BYTES / 1024)} KiB`, 413)

  let buffer
  try {
    buffer = await fs.readFile(absolute)
  } catch (error) {
    throw new MpError('mp/fs-error', `cannot read the file: ${error?.code ?? error}`, 500)
  }
  // A NUL byte in the first window means binary; a diagram is text.
  if (buffer.subarray(0, 8000).includes(0)) throw new MpError('mp/not-text', 'that file is not UTF-8 text')
  return { text: buffer.toString('utf8'), size: stats.size, mtime: Math.floor(stats.mtimeMs) }
}

/**
 * Write UTF-8 text to an absolute path, creating parent folders as needed.
 *
 * The caller has already decided this path may be written (the route confines it
 * to the workspace root). An existing directory in place of the target is
 * refused; content already on disk is replaced.
 *
 * @param absolute - the resolved file path.
 * @param text - the whole new file contents.
 * @returns `{ created, size, mtime }`.
 * @throws {MpError} `mp/too-large`, `mp/not-a-file`, `mp/fs-error`.
 */
export async function writeFileAt(absolute, text) {
  const contents = String(text ?? '')
  const byteLength = Buffer.byteLength(contents, 'utf8')
  if (byteLength > TEXT_LIMIT_BYTES) throw new MpError('mp/too-large', `the content is larger than ${Math.floor(TEXT_LIMIT_BYTES / 1024)} KiB`, 413)

  const existing = await fs.stat(absolute).catch(() => undefined)
  if (existing !== undefined && !existing.isFile()) throw new MpError('mp/not-a-file', 'that path is not a regular file')
  const created = existing === undefined

  try {
    await fs.mkdir(pathDirname(absolute), { recursive: true })
    await fs.writeFile(absolute, contents, 'utf8')
  } catch (error) {
    throw new MpError('mp/fs-error', `cannot write the file: ${error?.code ?? error}`, 500)
  }
  const stats = await fs.stat(absolute).catch(() => undefined)
  return { created, size: stats?.size ?? byteLength, mtime: stats ? Math.floor(stats.mtimeMs) : Date.now() }
}

/**
 * Stat an absolute path without reading it — the cheap probe the client polls to
 * notice a file changed on disk (e.g. the agent rewrote it while a tab is open).
 * @param absolute - the resolved file path.
 * @returns `{ mtime, size }`.
 * @throws {MpError} `mp/missing`, `mp/not-a-file`, `mp/fs-error`.
 */
export async function statAt(absolute) {
  let stats
  try {
    stats = await fs.stat(absolute)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new MpError('mp/missing', 'the file does not exist', 404)
    throw new MpError('mp/fs-error', `cannot stat the file: ${error?.code ?? error}`, 500)
  }
  if (!stats.isFile()) throw new MpError('mp/not-a-file', 'that path is not a regular file')
  return { mtime: Math.floor(stats.mtimeMs), size: stats.size }
}

/** The directory portion of an absolute path, without importing node:path here. */
function pathDirname(absolute) {
  const normalized = absolute.replace(/[\\/]+$/u, '')
  const at = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return at <= 0 ? normalized : normalized.slice(0, at)
}
