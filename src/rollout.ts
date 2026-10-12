import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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
    // fall through
  }
  throw new Error('resolveSession by id prefix: not implemented')
}

export type SessionSummary = {
  id: string
  path: string
  started: string
  cwd: string
  firstPrompt: string
  windowMax: number
}

export function listSessions(_home: string): SessionSummary[] {
  return []
}
