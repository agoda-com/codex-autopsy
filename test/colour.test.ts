import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { main } from '../src/cli.js'
import { paint } from '../src/render.js'
import { standardSession, writeRollout } from './fixtures/build.js'

const ESC = '\x1b['
const BRAND_RED_TRUECOLOR = `${ESC}38;2;255;41;56m`

function run(
  argv: string[],
  env: NodeJS.ProcessEnv,
  isTTY: boolean,
  colorDepth?: number,
) {
  const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
  writeRollout(home, '2026-01-15', 'colour', standardSession())
  const out: string[] = []
  const sink = {
    write: (chunk: string | Uint8Array) => {
      out.push(String(chunk))
      return true
    },
  } as NodeJS.WritableStream
  main(
    argv,
    { CODEX_HOME: home, ...env },
    { stdout: sink, stderr: sink, isTTY, colorDepth },
  )
  return out.join('')
}

describe('colourUsesBrandTruecolorOnCapableTerminals', () => {
  it('paints tool output in brand red at 24-bit depth', () => {
    const text = run(['--no-banner'], { COLORTERM: 'truecolor' }, true)
    expect(text).toContain(BRAND_RED_TRUECOLOR)
  })

  it('falls back to the 256-colour cube and to basic ANSI', () => {
    expect(paint('x', '#FF2938', 8)).toBe(`${ESC}38;5;197mx${ESC}0m`)
    expect(paint('x', '#FF2938', 4)).toBe(`${ESC}91mx${ESC}0m`)
  })
})

describe('colourIsOffForPipesAndNoColor', () => {
  it('emits no escape codes when piped, with NO_COLOR, or with --json', () => {
    expect(run([], { COLORTERM: 'truecolor' }, false)).not.toContain(ESC)
    expect(
      run([], { COLORTERM: 'truecolor', NO_COLOR: '1' }, true),
    ).not.toContain(ESC)
    expect(run(['--json'], {}, true, 24)).not.toContain(ESC)
  })

  it('FORCE_COLOR turns colour on even when piped', () => {
    expect(run(['--no-banner'], { FORCE_COLOR: '3' }, false)).toContain(
      BRAND_RED_TRUECOLOR,
    )
  })
})

describe('gridShowsTwoHundredCells', () => {
  it('draws a 20 by 10 grid of used and free cells', () => {
    const lines = run(['--no-banner'], {}, false).split('\n').slice(0, 10)
    const cells = lines.flatMap((line) =>
      [...line.slice(0, 41)].filter((c) => c === '⛁' || c === '⛶'),
    )
    expect(cells).toHaveLength(200)
    expect(cells).toContain('⛁')
    expect(cells).toContain('⛶')
  })
})
