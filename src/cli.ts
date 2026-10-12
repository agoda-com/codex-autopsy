import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { buildBreakdown } from './breakdown.js'
import {
  codexHome,
  findLatestRollout,
  listSessions,
  readRollout,
  resolveSession,
} from './rollout.js'
import {
  renderBanner,
  renderBreakdown,
  renderList,
  renderTop,
  renderTurns,
} from './render.js'

import packageJson from '../package.json' with { type: 'json' }

export type MainIo = {
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
  isTTY: boolean
}

export function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: MainIo = {
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: Boolean(process.stdout.isTTY),
  },
): number {
  const parsed = parseArgs({
    args: argv,
    options: {
      list: { type: 'boolean', short: 'l' },
      top: { type: 'string' },
      turns: { type: 'boolean' },
      json: { type: 'boolean' },
      'no-banner': { type: 'boolean' },
      version: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  if (parsed.values.help) {
    io.stderr.write(
      `Usage: codex-autopsy [session] [--list] [--top N] [--turns] [--json]\n`,
    )
    return 0
  }

  if (parsed.values.version) {
    io.stdout.write(`${packageJson.version}\n`)
    return 0
  }

  const home = codexHome(env)

  if (parsed.values.list) {
    const text = renderList(listSessions(home), home)
    io.stdout.write(text)
    if (text.length > 0 && !text.endsWith('\n')) {
      io.stdout.write('\n')
    }
    return 0
  }

  const sessionArg = parsed.positionals[0]
  let path: string | undefined
  if (sessionArg) {
    try {
      path = resolveSession(home, sessionArg)
    } catch (err) {
      io.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      return 1
    }
  } else {
    path = findLatestRollout(home)
  }

  if (!path) {
    io.stderr.write(
      `No Codex sessions found in ${home}/sessions. Set CODEX_HOME if Codex stores them elsewhere.\n`,
    )
    return 1
  }

  const { records, skippedLines } = readRollout(path)
  const breakdown = buildBreakdown(records, path, skippedLines)

  if (parsed.values.json) {
    io.stdout.write(`${JSON.stringify(breakdown, null, 2)}\n`)
    return 0
  }

  const noBanner = parsed.values['no-banner'] ?? false
  if (io.isTTY && !noBanner) {
    const banner = renderBanner()
    if (banner) {
      io.stdout.write(banner)
      if (!banner.endsWith('\n')) {
        io.stdout.write('\n')
      }
    }
  }

  const chunks: string[] = []
  if (parsed.values.top !== undefined) {
    const n = Number(parsed.values.top)
    chunks.push(renderTop(breakdown, Number.isFinite(n) ? n : 10))
  }
  if (parsed.values.turns) {
    chunks.push(renderTurns(breakdown))
  }
  if (parsed.values.top === undefined && !parsed.values.turns) {
    chunks.push(renderBreakdown(breakdown))
  } else {
    chunks.push(renderBreakdown(breakdown))
  }

  const body = chunks.filter((chunk) => chunk.length > 0).join('\n')
  io.stdout.write(body)
  if (body.length > 0 && !body.endsWith('\n')) {
    io.stdout.write('\n')
  }

  return 0
}

function isCliEntry(): boolean {
  if (!process.argv[1]) {
    return false
  }
  const entry = realpathSync(fileURLToPath(import.meta.url))
  const invoked = realpathSync(resolve(process.argv[1]))
  return entry === invoked
}

if (isCliEntry()) {
  process.exit(main(process.argv.slice(2), process.env))
}
