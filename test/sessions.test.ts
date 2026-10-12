import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { main } from '../src/cli.js'
import {
  sessionMeta,
  standardSession,
  tokenCount,
  userMessage,
  writeRollout,
} from './fixtures/build.js'

function captureIo() {
  const stdout: string[] = []
  const stderr: string[] = []
  const io = {
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
    isTTY: false,
  }
  return { stdout, stderr, io }
}

describe('listShowsNewestFirst', () => {
  it('orders sessions newest first', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    writeRollout(home, '2026-01-10', 'older-sess', [
      sessionMeta({ id: 'older-sess', timestamp: '2026-01-10T08:00:00Z' }),
      tokenCount({ input: 10, max: 1000 }),
    ])
    writeRollout(home, '2026-01-20', 'newer-sess', [
      sessionMeta({ id: 'newer-sess', timestamp: '2026-01-20T08:00:00Z' }),
      tokenCount({ input: 20, max: 2000 }),
    ])
    const { stdout, io } = captureIo()
    const code = main(['--list'], { CODEX_HOME: home }, io)
    expect(code).toBe(0)
    const text = stdout.join('')
    const olderIdx = text.indexOf('older-se')
    const newerIdx = text.indexOf('newer-se')
    expect(newerIdx).toBeGreaterThanOrEqual(0)
    expect(olderIdx).toBeGreaterThanOrEqual(0)
    expect(newerIdx).toBeLessThan(olderIdx)
  })
})

describe('idPrefixResolvesOneSession', () => {
  it('resolves a unique id prefix via main', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    writeRollout(home, '2026-01-15', '01a12f00-aaaa-bbbb-cccc-ddddeeeeffff', [
      sessionMeta({ id: '01a12f00-aaaa-bbbb-cccc-ddddeeeeffff' }),
      ...standardSession().slice(1),
    ])
    const { stdout, io } = captureIo()
    const code = main(['01a12f', '--json'], { CODEX_HOME: home }, io)
    expect(code).toBe(0)
    const parsed = JSON.parse(stdout.join('')) as { session: { id: string } }
    expect(parsed.session.id).toBe('01a12f00-aaaa-bbbb-cccc-ddddeeeeffff')
  })
})

describe('ambiguousPrefixListsMatches', () => {
  it('exits 1 and lists ambiguous matches on stderr', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    writeRollout(home, '2026-01-15', '01a12f00-1111-2222-3333-444455556666', [
      sessionMeta({
        id: '01a12f00-1111-2222-3333-444455556666',
        timestamp: '2026-01-15T09:00:00Z',
      }),
      tokenCount({ input: 1, max: 1000 }),
    ])
    writeRollout(home, '2026-01-15', '01a12f00-aaaa-bbbb-cccc-ddddeeeeffff', [
      sessionMeta({
        id: '01a12f00-aaaa-bbbb-cccc-ddddeeeeffff',
        timestamp: '2026-01-15T10:00:00Z',
      }),
      tokenCount({ input: 2, max: 1000 }),
    ])
    const { stderr, io } = captureIo()
    const code = main(['01a12f00'], { CODEX_HOME: home }, io)
    expect(code).toBe(1)
    const err = stderr.join('')
    expect(err).toContain('01a12f00-1111-2222-3333-444455556666')
    expect(err).toContain('01a12f00-aaaa-bbbb-cccc-ddddeeeeffff')
    expect(err).toContain('2026-01-15T09:00:00Z')
    expect(err).toContain('2026-01-15T10:00:00Z')
  })
})

describe('missingRolloutsAreReported', () => {
  it('explains when no rollouts exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    mkdirSync(join(home, 'sessions'), { recursive: true })
    const { stdout, io } = captureIo()
    const code = main(['--list'], { CODEX_HOME: home }, io)
    expect(code).toBe(0)
    const text = stdout.join('')
    expect(text).toMatch(/sessions/i)
    expect(text).toMatch(/no rollout/i)
    expect(text).toMatch(/codex deletes/i)
  })
})

describe('codexHomeIsRespected', () => {
  it('reads sessions from CODEX_HOME', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const other = mkdtempSync(join(tmpdir(), 'codex-autopsy-other-'))
    writeRollout(home, '2026-01-15', 'home-only-sess', [
      sessionMeta({ id: 'home-only-sess' }),
      userMessage('hello from codex home'),
      tokenCount({ input: 5, max: 500 }),
    ])
    writeRollout(other, '2026-01-15', 'other-sess', [
      sessionMeta({ id: 'other-sess' }),
      userMessage('wrong home'),
      tokenCount({ input: 5, max: 500 }),
    ])
    const { stdout, io } = captureIo()
    const code = main(['--list'], { CODEX_HOME: home }, io)
    expect(code).toBe(0)
    const text = stdout.join('')
    expect(text).toContain('hello from codex home')
    expect(text).not.toContain('wrong home')
  })
})
