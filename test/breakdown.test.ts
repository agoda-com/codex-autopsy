import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Breakdown, CategoryKey } from '../src/breakdown.js'
import { buildBreakdown, countTokens, readItems } from '../src/breakdown.js'
import { readRollout } from '../src/rollout.js'
import { main } from '../src/cli.js'
import {
  customToolCall,
  customToolCallOutput,
  filler,
  legacyUserInstructions,
  malformedLine,
  reasoning,
  sessionMeta,
  standardSession,
  tokenCount,
  turnContext,
  worldState,
  writeRollout,
} from './fixtures/build.js'

const CATEGORY_ORDER: CategoryKey[] = [
  'system',
  'developer',
  'agents_md',
  'environment',
  'conversation',
  'tool_calls',
  'tool_output',
  'reasoning',
]

describe('unattributedIsWindowMinusCounted', () => {
  it('sets unattributed from window minus category totals', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const lines = [
      sessionMeta({ baseInstructionsText: filler(10) }),
      turnContext(),
      tokenCount({ input: 100, max: 1000 }),
    ]
    const path = writeRollout(home, '2026-01-15', 'unattrib', lines)
    const { records, skippedLines } = readRollout(path)
    const breakdown = buildBreakdown(records, path, skippedLines)
    const counted = breakdown.categories.reduce(
      (sum, cat) => sum + cat.tokens,
      0,
    )
    expect(breakdown.unattributed).toBe(
      Math.max(0, breakdown.window.used - counted),
    )
  })
})

describe('agentsMdFromWorldState', () => {
  it('counts world_state agents_md text', () => {
    const text = filler(42)
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const path = writeRollout(home, '2026-01-15', 'agents', [
      sessionMeta(),
      turnContext(),
      worldState(text),
      tokenCount({ input: 50, max: 1000 }),
    ])
    const { records, skippedLines } = readRollout(path)
    const items = readItems(records)
    const agents = items.filter((item) => item.category === 'agents_md')
    expect(agents).toHaveLength(1)
    expect(agents[0].tokens).toBe(countTokens(text))
  })
})

describe('legacyUserInstructionsStillCounted', () => {
  it('counts legacy user_instructions messages as agents_md', () => {
    const text = filler(11)
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const path = writeRollout(home, '2026-01-15', 'legacy', [
      sessionMeta(),
      turnContext(),
      legacyUserInstructions(text),
      tokenCount({ input: 20, max: 1000 }),
    ])
    const { records, skippedLines } = readRollout(path)
    const items = readItems(records)
    expect(
      items.some(
        (item) =>
          item.category === 'agents_md' && item.child === 'user_instructions',
      ),
    ).toBe(true)
  })
})

describe('toolOutputGroupedByCallName', () => {
  it('uses the tool name from the matching call_id', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const path = writeRollout(home, '2026-01-15', 'tools', [
      sessionMeta(),
      turnContext(),
      customToolCall('read_file', filler(5), 'cid-1'),
      customToolCallOutput('cid-1', filler(9)),
      tokenCount({ input: 30, max: 1000 }),
    ])
    const { records, skippedLines } = readRollout(path)
    const breakdown = buildBreakdown(records, path, skippedLines)
    const toolOutput = breakdown.categories.find(
      (cat) => cat.key === 'tool_output',
    )
    expect(
      toolOutput?.children.some((child) => child.name === 'read_file'),
    ).toBe(true)
  })
})

describe('reasoningIsEstimated', () => {
  it('marks reasoning tokens as estimated from the next token_count', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const path = writeRollout(home, '2026-01-15', 'reason', [
      sessionMeta(),
      turnContext(),
      reasoning(),
      tokenCount({ input: 40, max: 1000, reasoningOutput: 33 }),
    ])
    const { records, skippedLines } = readRollout(path)
    const items = readItems(records)
    const reasoningItem = items.find((item) => item.category === 'reasoning')
    expect(reasoningItem?.estimated).toBe(true)
    expect(reasoningItem?.tokens).toBe(33)
  })
})

describe('malformedLinesAreSkippedAndCounted', () => {
  it('skips bad json lines', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const path = writeRollout(home, '2026-01-15', 'malformed', [
      sessionMeta(),
      malformedLine(),
      turnContext(),
      tokenCount({ input: 5, max: 1000 }),
    ])
    const { skippedLines } = readRollout(path)
    expect(skippedLines).toBe(1)
  })
})

function assertBreakdownShape(value: unknown): Breakdown {
  expect(value).toBeTruthy()
  const b = value as Breakdown
  expect(b.schemaVersion).toBe(1)
  expect(typeof b.session.id).toBe('string')
  expect(typeof b.session.path).toBe('string')
  expect(typeof b.session.cwd).toBe('string')
  expect(typeof b.session.model).toBe('string')
  expect(typeof b.session.cliVersion).toBe('string')
  expect(typeof b.session.started).toBe('string')
  expect(typeof b.window.used).toBe('number')
  expect(typeof b.window.max).toBe('number')
  expect(typeof b.window.free).toBe('number')
  expect(Array.isArray(b.categories)).toBe(true)
  expect(b.categories).toHaveLength(8)
  b.categories.forEach((cat, index) => {
    expect(cat.key).toBe(CATEGORY_ORDER[index])
    expect(typeof cat.label).toBe('string')
    expect(typeof cat.tokens).toBe('number')
    expect(typeof cat.estimated).toBe('boolean')
    expect(Array.isArray(cat.children)).toBe(true)
    for (const child of cat.children) {
      expect(typeof child.name).toBe('string')
      expect(typeof child.tokens).toBe('number')
    }
  })
  expect(typeof b.unattributed).toBe('number')
  expect(Array.isArray(b.items)).toBe(true)
  for (const item of b.items) {
    expect(CATEGORY_ORDER).toContain(item.category)
    expect(typeof item.child).toBe('string')
    expect(typeof item.preview).toBe('string')
    expect(typeof item.tokens).toBe('number')
    expect(typeof item.line).toBe('number')
    expect(typeof item.estimated).toBe('boolean')
  }
  expect(Array.isArray(b.turns)).toBe(true)
  expect(typeof b.skippedLines).toBe('number')
  return b
}

describe('jsonMatchesBreakdownSchema', () => {
  it('main --json returns the breakdown contract', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const path = writeRollout(home, '2026-01-15', 'json', standardSession())
    const stdout: string[] = []
    const code = main(
      ['--json', path],
      { CODEX_HOME: home },
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
    const parsed = JSON.parse(stdout.join(''))
    assertBreakdownShape(parsed)
  })
})
