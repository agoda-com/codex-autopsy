import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildBreakdown } from '../src/breakdown.js'
import { main } from '../src/cli.js'
import { readRollout } from '../src/rollout.js'
import { renderBanner } from '../src/render.js'
import { sessionMeta, standardSession, writeRollout } from './fixtures/build.js'

function captureMain(
  argv: string[],
  env: NodeJS.ProcessEnv,
  isTTY: boolean,
): { code: number; stdout: string; stderr: string } {
  const stdout: string[] = []
  const stderr: string[] = []
  const code = main(argv, env, {
    stdout: {
      write: (chunk: string | Uint8Array) => {
        stdout.push(String(chunk))
        return true
      },
    } as NodeJS.WritableStream,
    stderr: {
      write: (chunk: string | Uint8Array) => {
        stderr.push(String(chunk))
        return true
      },
    } as NodeJS.WritableStream,
    isTTY,
  })
  return { code, stdout: stdout.join(''), stderr: stderr.join('') }
}

function writeStandardSessionHome(): { home: string; id: string } {
  const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
  const records = standardSession()
  const id = 'sess-demo-001'
  writeRollout(home, '2026-01-15', id, records)
  return { home, id }
}

describe('latestSessionShowsEveryCategory', () => {
  it('prints all categories, unattributed, free, and session header', () => {
    const { home, id } = writeStandardSessionHome()
    const { code, stdout } = captureMain([], { CODEX_HOME: home }, false)
    expect(code).toBe(0)
    const prefix = id.slice(0, 8)
    expect(stdout).toContain(`Codex context · ${prefix}`)
    expect(stdout).toContain('System instructions')
    expect(stdout).toContain('Developer instructions')
    expect(stdout).toContain('AGENTS.md')
    expect(stdout).toContain('Environment & plugins')
    expect(stdout).toContain('Conversation')
    expect(stdout).toContain('Tool calls')
    expect(stdout).toContain('Tool output')
    expect(stdout).toContain('Reasoning (est.)')
    expect(stdout).toContain('Unattributed')
    expect(stdout).toContain('Free')
  })
})

describe('percentagesAreOfWindowUsed', () => {
  it('category percentages use window.used as the denominator', () => {
    const { home } = writeStandardSessionHome()
    const { code, stdout } = captureMain([], { CODEX_HOME: home }, false)
    expect(code).toBe(0)

    const path = join(
      home,
      'sessions',
      '2026',
      '01',
      '15',
      'rollout-2026-01-15T12-00-00-sess-demo-001.jsonl',
    )
    const { records, skippedLines } = readRollout(path)
    const breakdown = buildBreakdown(records, path, skippedLines)
    const used = breakdown.window.used

    for (const cat of breakdown.categories) {
      const expected = used > 0 ? ((cat.tokens / used) * 100).toFixed(1) : '0.0'
      expect(stdout).toContain(`${expected}%`)
    }
    const unattribPct =
      used > 0 ? ((breakdown.unattributed / used) * 100).toFixed(1) : '0.0'
    expect(stdout).toContain(`${unattribPct}%`)
  })
})

describe('bannerHiddenForJsonAndPipes', () => {
  const tagline = 'What killed my context window?'

  it('omits the banner for json, non-tty, and --no-banner', () => {
    const { home } = writeStandardSessionHome()

    const jsonRun = captureMain(['--json'], { CODEX_HOME: home }, true)
    expect(jsonRun.code).toBe(0)
    expect(jsonRun.stdout).not.toContain(tagline)

    const piped = captureMain([], { CODEX_HOME: home }, false)
    expect(piped.stdout).not.toContain(tagline)

    const noBanner = captureMain(['--no-banner'], { CODEX_HOME: home }, true)
    expect(noBanner.stdout).not.toContain(tagline)
  })

  it('shows the banner on a TTY', () => {
    const { home } = writeStandardSessionHome()
    const tty = captureMain([], { CODEX_HOME: home }, true)
    expect(tty.stdout).toContain(tagline)
  })

  it('banner fits size constraints', () => {
    const banner = renderBanner()
    const lines = banner.split('\n').filter((line) => line.length > 0)
    expect(lines.length).toBeLessThanOrEqual(6)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60)
    }
  })
})

describe('noSessionsExplainsCodexHome', () => {
  it('exits 1 and names sessions dir and CODEX_HOME when empty', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-empty-'))
    const { code, stderr } = captureMain([], { CODEX_HOME: home }, false)
    expect(code).toBe(1)
    expect(stderr).toContain(`${home}/sessions`)
    expect(stderr).toContain('CODEX_HOME')
  })
})
