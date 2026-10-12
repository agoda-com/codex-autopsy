import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { standardSession, writeRollout } from './fixtures/build.js'

const BANNED = [
  /\/home\//i,
  /\/Users\//,
  /\bagoda\b/i,
  /\bsk-/,
  /\bglpat-/,
  /\bghp_/,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
]

function scanText(text: string, label: string): void {
  for (const pattern of BANNED) {
    expect(text, `${label} matched ${pattern}`).not.toMatch(pattern)
  }
}

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(full))
    } else {
      files.push(full)
    }
  }
  return files
}

describe('fixturesContainNoPrivateData', () => {
  it('fixture sources and standard rollout stay synthetic', () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
    for (const file of walk(fixtureDir)) {
      scanText(readFileSync(file, 'utf8'), file)
    }

    const tmp = mkdtempSync(join(tmpdir(), 'codex-autopsy-privacy-'))
    const path = writeRollout(
      tmp,
      '2026-01-15',
      'privacy-check',
      standardSession(),
    )
    scanText(readFileSync(path, 'utf8'), path)
  })
})
