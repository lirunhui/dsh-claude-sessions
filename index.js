/**
 * Host half of the Claude Code session browser.
 *
 * Scans `~/.claude/projects/<project>/<session>.jsonl` and serves three JSON
 * routes on the composition's `webServer`:
 *
 * - `GET  /dsh-claude-sessions/list` — every readable session, newest first.
 * - `POST /dsh-claude-sessions/open` — resume one session in a new terminal
 *   (`claude --resume <id>`) in the session's own working directory.
 * - `POST /dsh-claude-sessions/new`  — start a fresh `claude` session in a
 *   directory the caller names.
 *
 * Reading is bounded: each transcript is scanned from the head only until the
 * working directory, the first human prompt and the generated title are known,
 * plus a small tail window for the newest title and last prompt. Results are
 * cached per file and invalidated by mtime/size, so an idle list costs one stat
 * per transcript.
 *
 * Every mutating route is guarded by the composition's `connection` service
 * (browser authentication and the Host/Origin fence) when it is present, and by
 * this plugin's own loopback same-origin check.
 */
import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'

/** Cordis function-plugin name. */
export const name = 'claude-sessions'
/** The route carrier; `connection` is read opportunistically through `ctx.get`. */
export const inject = ['webServer']

const LIST_PATH = '/dsh-claude-sessions/list'
const OPEN_PATH = '/dsh-claude-sessions/open'
const NEW_PATH = '/dsh-claude-sessions/new'

/** How far into one transcript the head scan may read before giving up on a title. */
const HEAD_BUDGET_BYTES = 768 * 1024
const CHUNK_BYTES = 64 * 1024
const TAIL_BYTES = 32 * 1024
const MAX_SESSIONS = 1000
const MAX_BODY_BYTES = 8 * 1024

/** A Claude session id is a filename stem: letters, digits and dashes. */
const SESSION_ID_RE = /^[0-9a-zA-Z][0-9a-zA-Z-]{7,127}$/
/** Accepted `terminal` preferences. */
const TERMINALS = new Set(['auto', 'windows-terminal', 'windows-console'])

const DEFAULT_CONFIG = {
  /** Command that starts the Claude Code CLI. */
  claudeCommand: 'claude',
  /** Flag that resumes an existing session by id. */
  resumeFlag: '--resume',
  /** Extra arguments inserted before the resume flag. */
  extraArgs: [],
  /** `auto` | `windows-terminal` | `windows-console`. */
  terminal: 'auto',
  /** Claude home directory; empty means `~/.claude`. */
  claudeHome: '',
}

/** JSON response; session facts are live, so nothing is cached. */
function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

/** Answer 405 with the route's one supported method. */
function sendMethodNotAllowed(response, allow) {
  response.statusCode = 405
  response.setHeader('allow', allow)
  response.end()
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling. */
async function readBoundedBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      // Drain the rest so the refusal is a readable response, not a socket cut.
      request.resume()
      return null
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** `host[:port]` reduced to one loopback identity, or null for anything else. */
function loopbackAuthority(authority) {
  try {
    const parsed = new URL(`http://${authority}`)
    const hostname = parsed.hostname.toLowerCase()
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') return null
    return `loopback:${parsed.port === '' ? '80' : parsed.port}`
  } catch {
    return null
  }
}

/**
 * Accept a mutating request only from this machine's own page: loopback Host,
 * and an Origin that is absent, the desktop shell's protocol, or the same
 * loopback authority. (The desktop shell strips Origin before forwarding.)
 */
function isSameOrigin(request) {
  const host = request.headers.host
  const hostKey = typeof host === 'string' ? loopbackAuthority(host) : null
  if (hostKey === null) return false
  const origin = request.headers.origin
  if (origin === undefined || origin === '') return true
  try {
    const parsed = new URL(origin)
    if (parsed.protocol === 'dsh-app:') return true
    return loopbackAuthority(parsed.host) === hostKey
  } catch {
    return false
  }
}

/** Collapse whitespace and strip XML-ish wrappers that Claude embeds in prompts. */
function clean(text) {
  return text
    .replace(/<[^>\n]{1,120}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Text of one message's content, whether it is a string or content blocks. */
function messageText(message) {
  if (message === null || typeof message !== 'object') return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** Fold one transcript record into the scan accumulator. */
function accumulate(entry, acc) {
  const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN
  if (Number.isFinite(timestamp)) {
    acc.updatedAt = Math.max(acc.updatedAt, timestamp)
    if (acc.createdAt === 0) acc.createdAt = timestamp
  }
  if (acc.cwd === '' && typeof entry.cwd === 'string' && entry.cwd !== '') acc.cwd = entry.cwd
  if (acc.branch === '' && typeof entry.gitBranch === 'string') acc.branch = entry.gitBranch
  if (acc.version === '' && typeof entry.version === 'string') acc.version = entry.version
  if (acc.entrypoint === '' && typeof entry.entrypoint === 'string') acc.entrypoint = entry.entrypoint
  if (typeof entry.aiTitle === 'string' && entry.aiTitle.trim() !== '') acc.title = clean(entry.aiTitle)
  if (acc.title === '' && typeof entry.summary === 'string' && entry.summary.trim() !== '') acc.title = clean(entry.summary)
  if (typeof entry.lastPrompt === 'string' && entry.lastPrompt.trim() !== '') acc.lastPrompt = clean(entry.lastPrompt)
  if (entry.type === 'user' && entry.isSidechain !== true && entry.isMeta !== true && acc.firstPrompt === '') {
    const text = clean(messageText(entry.message))
    // Tool results and injected reminders are not what the person asked.
    if (text !== '' && !text.startsWith('[') && !text.startsWith('<')) acc.firstPrompt = text.slice(0, 400)
  }
}

/** Parse one JSONL line, ignoring unreadable lines. */
function parseLine(line, acc) {
  const trimmed = line.trim()
  if (trimmed === '') return
  let entry
  try {
    entry = JSON.parse(trimmed)
  } catch {
    return
  }
  if (entry !== null && typeof entry === 'object') accumulate(entry, acc)
}

/** Read a byte range and decode it as UTF-8. */
async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, position)
  return buffer.subarray(0, bytesRead).toString('utf8')
}

/**
 * Read one transcript's display facts with bounded IO.
 * @param {string} file - absolute transcript path.
 * @param {number} size - current file size in bytes.
 * @returns {Promise<object>} the accumulator's facts.
 */
async function readSessionFacts(file, size) {
  const acc = {
    title: '', firstPrompt: '', lastPrompt: '', cwd: '', branch: '',
    version: '', entrypoint: '', createdAt: 0, updatedAt: 0,
  }
  const handle = await open(file, 'r')
  try {
    let position = 0
    let pending = ''
    while (position < size && position < HEAD_BUDGET_BYTES) {
      const length = Math.min(CHUNK_BYTES, size - position, HEAD_BUDGET_BYTES - position)
      const text = pending + await readAt(handle, position, length)
      position += length
      const lines = text.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) parseLine(line, acc)
      if (acc.cwd !== '' && acc.title !== '' && acc.firstPrompt !== '') break
    }
    if (pending !== '' && position >= size) parseLine(pending, acc)
    if (size > position) {
      // The newest generated title and last prompt live near the end.
      const tailLength = Math.min(TAIL_BYTES, size)
      const tail = await readAt(handle, size - tailLength, tailLength)
      const firstBreak = tail.indexOf('\n')
      for (const line of (firstBreak >= 0 ? tail.slice(firstBreak + 1) : '').split('\n')) parseLine(line, acc)
    }
  } finally {
    await handle.close()
  }
  return acc
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/** Resolve the Claude home and projects directory from config. */
function claudeRoots(config) {
  const configured = typeof config.claudeHome === 'string' ? config.claudeHome.trim() : ''
  const home = configured !== '' ? configured : join(homedir(), '.claude')
  return { home, projects: join(home, 'projects') }
}

/** Every `*.jsonl` transcript under the projects directory, with its stat. */
async function discoverTranscripts(projectsDir) {
  let projectDirs
  try {
    projectDirs = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    // No Claude home yet: an empty list, not an error.
    return []
  }
  const transcripts = []
  for (const directory of projectDirs) {
    if (!directory.isDirectory()) continue
    const directoryPath = join(projectsDir, directory.name)
    let names
    try {
      names = await readdir(directoryPath)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const file = join(directoryPath, name)
      let info
      try {
        info = await stat(file)
      } catch {
        continue
      }
      if (!info.isFile() || info.size === 0) continue
      transcripts.push({
        file,
        projectDir: directory.name,
        sessionId: name.slice(0, -'.jsonl'.length),
        size: info.size,
        mtimeMs: info.mtimeMs,
      })
    }
  }
  return transcripts
}

/** Launch a detached process and report whether it actually started. */
function trySpawn(command, args, options) {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false, ...options })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      resolve({ ok: false, error })
    })
    child.once('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolve({ ok: true, pid: child.pid })
    })
  })
}

/** The Windows Terminal executable, when this machine has it. */
function windowsTerminal() {
  const localAppData = process.env.LOCALAPPDATA
  if (typeof localAppData !== 'string' || localAppData === '') return null
  const candidate = join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe')
  // The Store alias denies stat/read but allows access, so `existsSync` reports it missing.
  try {
    accessSync(candidate, constants.X_OK)
    return candidate
  } catch {
    return null
  }
}

/** Quote one POSIX shell word. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/**
 * Open a terminal running the given command line in `cwd`.
 * @param {object} request - resolved launch inputs, including the terminal preference.
 * @returns {Promise<{ ok: boolean, terminal?: string, pid?: number, error?: Error }>}
 */
async function launchTerminal({ cwd, title, command, args, terminal: preference }) {
  const commandLine = [command, ...args].join(' ')
  if (process.platform === 'win32') {
    const terminal = preference === 'windows-console' ? null : windowsTerminal()
    if (terminal !== null) {
      const launched = await trySpawn(terminal, [
        '-w', '0', 'new-tab',
        '--title', title,
        '--startingDirectory', cwd,
        'cmd.exe', '/k', command, ...args,
      ], { cwd })
      if (launched.ok) return { ok: true, terminal: 'windows-terminal', pid: launched.pid }
    }
    // `start` opens the machine's default console host in `cwd`.
    const launched = await trySpawn(process.env.ComSpec ?? 'cmd.exe', [
      '/d', '/c', 'start', '', 'cmd.exe', '/k', command, ...args,
    ], { cwd })
    if (launched.ok) return { ok: true, terminal: 'console', pid: launched.pid }
    return { ok: false, error: launched.error }
  }
  if (process.platform === 'darwin') {
    const script = `cd ${shellQuote(cwd)} && ${commandLine}`
    const launched = await trySpawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(script)}`], {})
    if (launched.ok) return { ok: true, terminal: 'terminal.app', pid: launched.pid }
    return { ok: false, error: launched.error }
  }
  const script = `cd ${shellQuote(cwd)} && ${commandLine}; exec $SHELL -i`
  const candidates = [
    ['x-terminal-emulator', ['-e', 'sh', '-c', script], 'x-terminal-emulator'],
    ['gnome-terminal', ['--', 'sh', '-c', script], 'gnome-terminal'],
    ['konsole', ['-e', 'sh', '-c', script], 'konsole'],
    ['xterm', ['-e', 'sh', '-c', script], 'xterm'],
  ]
  let lastError
  for (const [binary, argv, label] of candidates) {
    const launched = await trySpawn(binary, argv, {})
    if (launched.ok) return { ok: true, terminal: label, pid: launched.pid }
    lastError = launched.error
  }
  return { ok: false, error: lastError }
}

/**
 * Register the three routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {object} [config] - optional overrides from the bundle patch.
 */
export function apply(ctx, config = {}) {
  const resolved = { ...DEFAULT_CONFIG, ...config }
  const terminal = TERMINALS.has(resolved.terminal) ? resolved.terminal : 'auto'
  const claudeCommand = typeof resolved.claudeCommand === 'string' && resolved.claudeCommand.trim() !== ''
    ? resolved.claudeCommand.trim()
    : DEFAULT_CONFIG.claudeCommand
  const resumeFlag = typeof resolved.resumeFlag === 'string' && resolved.resumeFlag.trim() !== ''
    ? resolved.resumeFlag.trim()
    : DEFAULT_CONFIG.resumeFlag
  const extraArgs = Array.isArray(resolved.extraArgs)
    ? resolved.extraArgs.filter((value) => typeof value === 'string')
    : []
  /** file path -> { size, mtimeMs, facts } */
  const cache = new Map()
  /** sessionId -> current file facts, refreshed by every list. */
  const index = new Map()

  /** Build the public session list, reusing cached facts for unchanged files. */
  const scan = async (force) => {
    const { home, projects } = claudeRoots(resolved)
    const transcripts = await discoverTranscripts(projects)
    const facts = await mapLimit(transcripts, 8, async (transcript) => {
      const cached = cache.get(transcript.file)
      if (!force && cached !== undefined && cached.size === transcript.size && cached.mtimeMs === transcript.mtimeMs) {
        return { transcript, facts: cached.facts }
      }
      try {
        const read = await readSessionFacts(transcript.file, transcript.size)
        cache.set(transcript.file, { size: transcript.size, mtimeMs: transcript.mtimeMs, facts: read })
        return { transcript, facts: read }
      } catch {
        // A transcript removed or replaced mid-scan is simply absent.
        cache.delete(transcript.file)
        return null
      }
    })
    const sessions = []
    index.clear()
    for (const item of facts) {
      if (item === null) continue
      const { transcript, facts: read } = item
      const title = read.title !== ''
        ? read.title
        : read.firstPrompt !== ''
          ? read.firstPrompt.slice(0, 120)
          : read.lastPrompt !== ''
            ? read.lastPrompt.slice(0, 120)
            : transcript.sessionId.slice(0, 8)
      const session = {
        sessionId: transcript.sessionId,
        cwd: read.cwd,
        projectDir: transcript.projectDir,
        title,
        lastPrompt: read.lastPrompt.slice(0, 300),
        firstPrompt: read.firstPrompt.slice(0, 300),
        branch: read.branch,
        version: read.version,
        entrypoint: read.entrypoint,
        createdAt: read.createdAt,
        updatedAt: Math.max(read.updatedAt, transcript.mtimeMs),
        sizeBytes: transcript.size,
      }
      sessions.push(session)
      index.set(transcript.sessionId, { file: transcript.file, session })
    }
    sessions.sort((left, right) => right.updatedAt - left.updatedAt)
    const limited = sessions.slice(0, MAX_SESSIONS)
    // Keep only what the client is offered, so a truncated list cannot be opened by id.
    const offered = new Set(limited.map((session) => session.sessionId))
    for (const sessionId of index.keys()) {
      if (!offered.has(sessionId)) index.delete(sessionId)
    }
    return {
      ok: true,
      home,
      projectsRoot: projects,
      sessions: limited,
      truncated: sessions.length > limited.length,
      scannedAt: Date.now(),
    }
  }

  /** Answer an untrusted or unauthenticated request; true when it was rejected. */
  const rejected = (request, response) => {
    let connection
    try {
      connection = ctx.get('connection')
    } catch {
      connection = undefined
    }
    if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
      const rejection = connection.requestRejection(request)
      if (rejection !== undefined) {
        response.statusCode = rejection
        response.end()
        return true
      }
    }
    return false
  }

  /**
   * Read one JSON POST body after the shared trust and media-type checks.
   * @returns {Promise<object | null>} the parsed object, or null after answering the refusal.
   */
  const readJsonPost = async (request, response) => {
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { ok: false, code: 'untrusted-origin' })
      return null
    }
    const essence = String(request.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
    if (essence !== 'application/json') {
      sendJson(response, 415, { ok: false, code: 'unsupported-media-type' })
      return null
    }
    let text
    try {
      text = await readBoundedBody(request)
    } catch {
      sendJson(response, 400, { ok: false, code: 'bad-request' })
      return null
    }
    if (text === null) {
      sendJson(response, 413, { ok: false, code: 'payload-too-large' })
      return null
    }
    let body
    try {
      body = JSON.parse(text)
    } catch {
      sendJson(response, 400, { ok: false, code: 'bad-request' })
      return null
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(response, 400, { ok: false, code: 'bad-request' })
      return null
    }
    return body
  }

  /** Launch failure shared by the two terminal routes. */
  const launchFailure = (response, launched) => {
    sendJson(response, 502, {
      ok: false,
      code: 'launch-failed',
      message: launched.error instanceof Error ? launched.error.message : String(launched.error),
    })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LIST_PATH,
    handler: async (request, response) => {
      if (rejected(request, response)) return
      if (request.method !== 'GET') {
        sendMethodNotAllowed(response, 'GET')
        return
      }
      try {
        const url = new URL(String(request.url), 'http://localhost')
        const force = url.searchParams.get('refresh') === '1'
        sendJson(response, 200, await scan(force))
      } catch (error) {
        sendJson(response, 500, { ok: false, code: 'scan-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), `claude-sessions: GET ${LIST_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_PATH,
    handler: async (request, response) => {
      if (rejected(request, response)) return
      if (request.method !== 'POST') {
        sendMethodNotAllowed(response, 'POST')
        return
      }
      const body = await readJsonPost(request, response)
      if (body === null) return
      const sessionId = body.sessionId
      if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
        sendJson(response, 400, { ok: false, code: 'bad-session-id' })
        return
      }
      let known = index.get(sessionId)
      if (known === undefined) {
        // The transcript may have appeared after the last list: rescan once.
        await scan(false)
        known = index.get(sessionId)
      }
      if (known === undefined) {
        sendJson(response, 404, { ok: false, code: 'session-not-found' })
        return
      }
      const cwd = known.session.cwd
      if (typeof cwd !== 'string' || cwd === '' || !existsSync(cwd)) {
        sendJson(response, 409, {
          ok: false,
          code: 'cwd-missing',
          cwd: typeof cwd === 'string' ? cwd : '',
        })
        return
      }
      const launched = await launchTerminal({
        cwd,
        title: `Claude · ${known.session.title}`.slice(0, 120),
        command: claudeCommand,
        args: [...extraArgs, resumeFlag, sessionId],
        terminal,
      })
      if (!launched.ok) {
        launchFailure(response, launched)
        return
      }
      sendJson(response, 200, {
        ok: true,
        terminal: launched.terminal,
        pid: launched.pid ?? null,
        command: [claudeCommand, ...extraArgs, resumeFlag, sessionId].join(' '),
      })
    },
  }), `claude-sessions: POST ${OPEN_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: NEW_PATH,
    handler: async (request, response) => {
      if (rejected(request, response)) return
      if (request.method !== 'POST') {
        sendMethodNotAllowed(response, 'POST')
        return
      }
      const body = await readJsonPost(request, response)
      if (body === null) return
      const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
      if (cwd === '' || !isAbsolute(cwd)) {
        sendJson(response, 400, { ok: false, code: 'bad-cwd' })
        return
      }
      let directory
      try {
        directory = (await stat(cwd)).isDirectory()
      } catch {
        directory = false
      }
      if (!directory) {
        sendJson(response, 404, { ok: false, code: 'not-a-directory', cwd })
        return
      }
      const launched = await launchTerminal({
        cwd,
        title: `Claude · ${basename(cwd)}`.slice(0, 120),
        command: claudeCommand,
        args: [...extraArgs],
        terminal,
      })
      if (!launched.ok) {
        launchFailure(response, launched)
        return
      }
      sendJson(response, 200, {
        ok: true,
        terminal: launched.terminal,
        pid: launched.pid ?? null,
        command: [claudeCommand, ...extraArgs].join(' '),
      })
    },
  }), `claude-sessions: POST ${NEW_PATH}`)
}
