import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildBreakdown, countTokens } from '../src/breakdown.js'
import { readRollout } from '../src/rollout.js'
import {
  assistantMessage,
  compacted,
  customToolCall,
  customToolCallOutput,
  filler,
  sessionMeta,
  tokenCount,
  turnContext,
  userMessage,
  worldState,
  writeRollout,
} from './fixtures/build.js'

function categoryTokens(
  breakdown: ReturnType<typeof buildBreakdown>,
  key: string,
): number {
  const cat = breakdown.categories.find((c) => c.key === key)
  return cat?.tokens ?? 0
}

describe('compactedSessionCountsOnlyReplacementHistory', () => {
  it('drops pre-compaction conversation and tool output from counts', () => {
    const agentsText = filler(30)
    const preUser = filler(80)
    const preAssistant = filler(70)
    const preToolIn = filler(40)
    const preToolOut = filler(50)
    const postUser = filler(25)
    const replacementUser = filler(40)
    const replacementToolOut = filler(35)

    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-compact-'))
    const path = writeRollout(home, '2026-01-15', 'compact-full', [
      sessionMeta({ baseInstructionsText: filler(40) }),
      turnContext(),
      worldState(agentsText),
      userMessage(preUser),
      assistantMessage(preAssistant),
      customToolCall('read_file', preToolIn, 'call-old'),
      customToolCallOutput('call-old', preToolOut),
      compacted('Summary of earlier work.', [
        userMessage(replacementUser).payload,
        customToolCallOutput('call-repl', replacementToolOut).payload,
      ]),
      userMessage(postUser),
      tokenCount({ input: 1200, max: 272000 }),
    ])

    const { records, skippedLines } = readRollout(path)
    const breakdown = buildBreakdown(records, path, skippedLines)

    expect(categoryTokens(breakdown, 'system')).toBe(countTokens(filler(40)))
    expect(categoryTokens(breakdown, 'agents_md')).toBe(countTokens(agentsText))
    expect(categoryTokens(breakdown, 'conversation')).toBe(
      countTokens(replacementUser) + countTokens(postUser),
    )
    expect(categoryTokens(breakdown, 'tool_output')).toBe(
      countTokens(replacementToolOut),
    )
    expect(categoryTokens(breakdown, 'tool_calls')).toBe(0)
  })
})

describe('noCompactionLeavesRecordsUnchanged', () => {
  it('keeps all conversation when there is no compacted line', () => {
    const userText = filler(50)
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-no-compact-'))
    const path = writeRollout(home, '2026-01-15', 'no-compact', [
      sessionMeta(),
      turnContext(),
      userMessage(userText),
      tokenCount({ input: 80, max: 1000 }),
    ])

    const { records, skippedLines } = readRollout(path)
    const breakdown = buildBreakdown(records, path, skippedLines)

    expect(categoryTokens(breakdown, 'conversation')).toBe(
      countTokens(userText),
    )
  })
})

describe('legacyCompactedMessageOnly', () => {
  it('counts compaction summary message and later items only', () => {
    const preUser = filler(80)
    const summary = 'Compacted summary of prior turns.'
    const afterUser = filler(20)

    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-legacy-compact-'))
    const path = writeRollout(home, '2026-01-15', 'legacy-compact', [
      sessionMeta(),
      turnContext(),
      userMessage(preUser),
      {
        timestamp: '2026-01-15T10:00:00Z',
        type: 'compacted',
        payload: { message: summary },
      },
      userMessage(afterUser),
      tokenCount({ input: 200, max: 1000 }),
    ])

    const { records, skippedLines } = readRollout(path)
    const breakdown = buildBreakdown(records, path, skippedLines)

    expect(categoryTokens(breakdown, 'conversation')).toBe(
      countTokens(summary) + countTokens(afterUser),
    )
  })
})
