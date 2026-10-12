import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildBreakdown, collectTurns } from '../src/breakdown.js'
import { readRollout } from '../src/rollout.js'
import { renderTurns } from '../src/render.js'
import {
  compacted,
  sessionMeta,
  tokenCount,
  turnContext,
  writeRollout,
} from './fixtures/build.js'

function turnWithId(turnId: string) {
  const base = turnContext()
  return {
    ...base,
    payload: { ...base.payload, turn_id: turnId },
  }
}

function recordsFromLines(
  lines: ReturnType<typeof sessionMeta>[],
): import('../src/breakdown.js').RolloutRecord[] {
  return lines.map((record, index) => ({
    line: index + 1,
    timestamp: record.timestamp,
    type: record.type,
    payload: record.payload,
  }))
}

describe('turnsFollowTokenCountEvents', () => {
  it('uses the last token_count input per turn', () => {
    const lines = [
      sessionMeta(),
      turnWithId('a'),
      tokenCount({ input: 50, max: 1000 }),
      tokenCount({ input: 100, max: 1000 }),
      turnWithId('b'),
      tokenCount({ input: 200, max: 1000 }),
      turnWithId('c'),
      tokenCount({ input: 300, max: 1000 }),
    ]
    const turns = collectTurns(recordsFromLines(lines))
    expect(turns).toHaveLength(3)
    expect(turns[0].turnId).toBe('a')
    expect(turns[0].inputTokens).toBe(100)
    expect(turns[1].inputTokens).toBe(200)
    expect(turns[2].inputTokens).toBe(300)
  })

  it('skips turns with no token_count', () => {
    const lines = [
      sessionMeta(),
      turnWithId('a'),
      tokenCount({ input: 100, max: 1000 }),
      turnWithId('b'),
      turnWithId('c'),
      tokenCount({ input: 250, max: 1000 }),
    ]
    const turns = collectTurns(recordsFromLines(lines))
    expect(turns).toHaveLength(2)
    expect(turns[1].turnId).toBe('c')
    expect(turns[1].inputTokens).toBe(250)
  })
})

describe('deltaIsDifferenceBetweenTurns', () => {
  it('sets the first delta to the turn input and later deltas to the difference', () => {
    const lines = [
      sessionMeta(),
      turnWithId('1'),
      tokenCount({ input: 100, max: 5000 }),
      turnWithId('2'),
      tokenCount({ input: 250, max: 5000 }),
      turnWithId('3'),
      tokenCount({ input: 400, max: 5000 }),
    ]
    const turns = collectTurns(recordsFromLines(lines))
    expect(turns[0].delta).toBe(100)
    expect(turns[1].delta).toBe(150)
    expect(turns[2].delta).toBe(150)
  })
})

describe('turnsMarkCompaction', () => {
  it('marks the turn after compaction and reports a negative delta', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const lines = [
      sessionMeta(),
      turnWithId('1'),
      tokenCount({ input: 500, max: 10000 }),
      turnWithId('2'),
      tokenCount({ input: 800, max: 10000 }),
      compacted('rolled up history', []),
      turnWithId('3'),
      tokenCount({ input: 200, max: 10000 }),
    ]
    const path = writeRollout(home, '2026-01-15', 'compact-turns', lines)
    const { records, skippedLines } = readRollout(path)
    const breakdown = buildBreakdown(records, path, skippedLines)
    expect(breakdown.turns).toHaveLength(3)
    expect(breakdown.turns[0].compacted).toBe(false)
    expect(breakdown.turns[1].compacted).toBe(false)
    expect(breakdown.turns[2].compacted).toBe(true)
    expect(breakdown.turns[2].delta).toBe(-600)

    const text = renderTurns(breakdown)
    expect(text).toContain('compacted')
    expect(text).toMatch(/-0\.6k/)
  })
})
