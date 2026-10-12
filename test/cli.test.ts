import { describe, expect, it } from 'vitest'

import { main } from '../src/cli.js'
import packageJson from '../package.json' with { type: 'json' }

describe('versionMatchesPackageJson', () => {
  it('prints package.json version', () => {
    const stdout: string[] = []
    const code = main(
      ['--version'],
      {},
      {
        stdout: {
          write: (chunk: string | Uint8Array) => {
            stdout.push(String(chunk))
            return true
          },
        } as NodeJS.WritableStream,
        stderr: process.stderr,
        isTTY: false,
      },
    )
    expect(code).toBe(0)
    expect(stdout.join('').trim()).toBe(packageJson.version)
  })
})
