import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { RolloutRecord } from './breakdown.js'

export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.CODEX_HOME
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
  }
  return join(homedir(), '.codex')
}

export function readRollout(path: string): {
  records: RolloutRecord[]
  skippedLines: number
} {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split(/\r?\n/)
  const records: RolloutRecord[] = []
  let skippedLines = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      continue
    }
    try {
      const parsed = JSON.parse(line) as {
        timestamp?: string
        type?: string
        payload?: Record<string, unknown>
      }
      if (
        typeof parsed.type !== 'string' ||
        !parsed.payload ||
        typeof parsed.payload !== 'object'
      ) {
        skippedLines += 1
        continue
      }
      records.push({
        line: i + 1,
        timestamp:
          typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
        type: parsed.type,
        payload: parsed.payload,
      })
    } catch {
      skippedLines += 1
    }
  }

  return { records, skippedLines }
}

function rolloutCandidates(home: string): string[] {
  const sessionsRoot = join(home, 'sessions')
  const paths: string[] = []

  function walk(dir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full)
      } else if (
        stat.isFile() &&
        entry.startsWith('rollout-') &&
        entry.endsWith('.jsonl')
      ) {
        paths.push(full)
      }
    }
  }

  walk(sessionsRoot)
  return paths
}

function rolloutSortKey(path: string): { date: string; mtime: number } {
  const match = /sessions\/(\d{4})\/(\d{2})\/(\d{2})\/rollout-/.exec(
    path.replace(/\\/g, '/'),
  )
  const date = match ? `${match[1]}-${match[2]}-${match[3]}` : ''
  let mtime = 0
  try {
    mtime = statSync(path).mtimeMs
  } catch {
    mtime = 0
  }
  return { date, mtime }
}

export function findLatestRollout(home: string): string | undefined {
  const candidates = rolloutCandidates(home)
  if (candidates.length === 0) {
    return undefined
  }
  candidates.sort((a, b) => {
    const ka = rolloutSortKey(a)
    const kb = rolloutSortKey(b)
    if (ka.date !== kb.date) {
      return ka.date < kb.date ? -1 : 1
    }
    return ka.mtime - kb.mtime
  })
  return candidates[candidates.length - 1]
}

export function resolveSession(home: string, arg: string): string {
  try {
    const stat = statSync(arg)
    if (stat.isFile()) {
      return arg
    }
  } catch {
    // not a filesystem path
  }
  const matches = sessionsMatchingPrefix(home, arg)
  if (matches.length === 0) {
    throw new Error(`No session matching "${arg}" in ${join(home, 'sessions')}`)
  }
  if (matches.length === 1) {
    return matches[0].path
  }
  const lines = matches.map((m) => `  ${m.id}  ${m.started}`)
  throw new Error(`Multiple sessions match "${arg}":\n${lines.join('\n')}`)
}

function idFromRolloutFilename(path: string): string {
  const name = basename(path)
  const match =
    /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/.exec(name)
  return match ? match[1] : ''
}

function sessionsMatchingPrefix(
  home: string,
  prefix: string,
): SessionSummary[] {
  const sessions = listSessions(home)
  return sessions.filter((s) =>
    idFromRolloutFilename(s.path).startsWith(prefix),
  )
}

export type SessionSummary = {
  id: string
  path: string
  started: string
  cwd: string
  firstPrompt: string
  windowMax: number
}

export function listSessions(home: string): SessionSummary[] {
  const candidates = rolloutCandidates(home)
  candidates.sort((a, b) => {
    const ka = rolloutSortKey(a)
    const kb = rolloutSortKey(b)
    if (ka.date !== kb.date) {
      return ka.date < kb.date ? 1 : -1
    }
    return kb.mtime - ka.mtime
  })
  return candidates.map((path) => summarizeRolloutPath(path))
}

function summarizeRolloutPath(path: string): SessionSummary {
  const fallbackId = idFromRolloutFilename(path)
  let id = fallbackId
  let started = ''
  let cwd = ''
  let firstPrompt = ''
  let windowMax = 0

  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue
    }
    let parsed: {
      type?: string
      payload?: Record<string, unknown>
    }
    try {
      parsed = JSON.parse(line) as {
        type?: string
        payload?: Record<string, unknown>
      }
    } catch {
      continue
    }
    if (typeof parsed.type !== 'string' || !parsed.payload) {
      continue
    }
    if (parsed.type === 'session_meta') {
      const payload = parsed.payload
      if (typeof payload.id === 'string') {
        id = payload.id
      }
      if (typeof payload.timestamp === 'string') {
        started = payload.timestamp
      }
      if (typeof payload.cwd === 'string') {
        cwd = payload.cwd
      }
    }
    if (firstPrompt === '' && parsed.type === 'response_item') {
      const payload = parsed.payload
      if (payload.type === 'message' && payload.role === 'user') {
        const text = userMessageText(payload)
        if (text !== undefined) {
          const firstLine = text.split('\n')[0] ?? ''
          if (!firstLine.startsWith('<')) {
            firstPrompt =
              firstLine.length > 60 ? firstLine.slice(0, 60) : firstLine
          }
        }
      }
    }
    if (parsed.type === 'event_msg' && parsed.payload.type === 'token_count') {
      const info = parsed.payload.info
      if (info && typeof info === 'object') {
        const modelWindow = (info as { model_context_window?: unknown })
          .model_context_window
        if (typeof modelWindow === 'number') {
          windowMax = modelWindow
        }
      }
    }
  }

  return { id, path, started, cwd, firstPrompt, windowMax }
}

function userMessageText(payload: Record<string, unknown>): string | undefined {
  const content = payload.content
  if (!Array.isArray(content)) {
    return undefined
  }
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue
    }
    const block = part as { type?: unknown; text?: unknown }
    if (block.type === 'input_text' && typeof block.text === 'string') {
      return block.text
    }
  }
  return undefined
}
