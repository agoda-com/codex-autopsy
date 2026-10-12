import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { main } from '../src/cli.js'
import packageJson from '../package.json' with { type: 'json' }
import { standardSession, writeRollout } from './fixtures/build.js'

function run(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const stdout: string[] = []
  const stderr: string[] = []
  const sink = (into: string[]) =>
    ({
      write: (chunk: string | Uint8Array) => {
        into.push(String(chunk))
        return true
      },
    }) as NodeJS.WritableStream
  const code = main(argv, env, {
    stdout: sink(stdout),
    stderr: sink(stderr),
    isTTY: false,
  })
  return { code, stdout: stdout.join(''), stderr: stderr.join('') }
}

function homeWithStandardSession(): string {
  const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
  writeRollout(home, '2026-01-15', 'standard', standardSession())
  return home
}

describe('versionMatchesPackageJson', () => {
  it('prints package.json version', () => {
    const { code, stdout } = run(['--version'])
    expect(code).toBe(0)
    expect(stdout.trim()).toBe(packageJson.version)
  })
})

describe('topAndTurnsShowOnlyTheirView', () => {
  it('omits the category table for --top and --turns', () => {
    const home = homeWithStandardSession()
    for (const argv of [['--top', '3'], ['--turns']]) {
      const { code, stdout } = run(argv, { CODEX_HOME: home })
      expect(code).toBe(0)
      expect(stdout).not.toContain('Free')
    }
    expect(run([], { CODEX_HOME: home }).stdout).toContain('Free')
  })
})

describe('topRejectsInvalidCount', () => {
  it('exits 1 for a non-positive or non-numeric --top', () => {
    const home = homeWithStandardSession()
    for (const value of ['abc', '0', '2.5']) {
      const { code, stderr } = run(['--top', value], { CODEX_HOME: home })
      expect(code).toBe(1)
      expect(stderr).toContain('--top')
    }
  })
})
