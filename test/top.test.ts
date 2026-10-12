import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildBreakdown, countTokens, previewOf } from '../src/breakdown.js'
import { readRollout } from '../src/rollout.js'
import { formatTokens, renderTop } from '../src/render.js'
import {
  customToolCall,
  customToolCallOutput,
  filler,
  sessionMeta,
  tokenCount,
  turnContext,
  writeRollout,
} from './fixtures/build.js'

describe('topRanksToolOutputsBySize', () => {
  it('lists the largest items in descending token order', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const small = filler(30)
    const medium = filler(50)
    const large = filler(70)
    const path = writeRollout(home, '2026-01-15', 'top-rank', [
      sessionMeta(),
      turnContext(),
      customToolCall('out_small', filler(5), 'call-a'),
      customToolCallOutput('call-a', small),
      customToolCall('out_medium', filler(5), 'call-b'),
      customToolCallOutput('call-b', medium),
      customToolCall('out_large', filler(5), 'call-c'),
      customToolCallOutput('call-c', large),
      tokenCount({ input: 1000, max: 10000 }),
    ])
    const { records, skippedLines } = readRollout(path)
    const breakdown = buildBreakdown(records, path, skippedLines)
    const toolOutputs = breakdown.items.filter(
      (item) => item.category === 'tool_output',
    )
    expect(toolOutputs).toHaveLength(3)

    const text = renderTop(breakdown, 3)
    const lines = text.split('\n').filter((line) => /^\s*\d/.test(line))
    expect(lines).toHaveLength(3)

    const ranks = lines.map((line) => {
      const match = /^(\d+)/.exec(line.trimStart())
      return match ? Number(match[1]) : 0
    })
    expect(ranks).toEqual([1, 2, 3])

    const tokenOrder = toolOutputs
      .sort((a, b) => b.tokens - a.tokens)
      .map((item) => item.tokens)
    expect(tokenOrder[0]).toBeGreaterThan(tokenOrder[1])
    expect(tokenOrder[1]).toBeGreaterThan(tokenOrder[2])

    expect(text.indexOf('out_large')).toBeLessThan(text.indexOf('out_medium'))
    expect(text.indexOf('out_medium')).toBeLessThan(text.indexOf('out_small'))
  })
})

describe('execPreviewShowsCommand', () => {
  it('shows the cmd field from exec JSON input', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const path = writeRollout(home, '2026-01-15', 'exec-preview', [
      sessionMeta(),
      turnContext(),
      customToolCall('exec', '{"cmd":"git status"}', 'call-exec'),
      tokenCount({ input: 10, max: 1000 }),
    ])
    const { records } = readRollout(path)
    const call = records.find(
      (record) =>
        record.type === 'response_item' &&
        record.payload.type === 'custom_tool_call',
    )
    expect(call).toBeDefined()
    expect(previewOf(call!)).toBe('git status')
  })
})

describe('longOutputIsFlagged', () => {
  it('marks outputs over 5k tokens and not smaller ones', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-autopsy-'))
    const huge = filler(6000)
    const small = filler(1000)
    expect(countTokens(huge)).toBe(6000)
    expect(countTokens(small)).toBe(1000)
    const path = writeRollout(home, '2026-01-15', 'large-flag', [
      sessionMeta(),
      turnContext(),
      customToolCall('exec', '{"cmd":"run"}', 'call-big'),
      customToolCallOutput('call-big', huge),
      customToolCall('exec', '{"cmd":"run"}', 'call-small'),
      customToolCallOutput('call-small', small),
      tokenCount({ input: 8000, max: 100000 }),
    ])
    const { records, skippedLines } = readRollout(path)
    const breakdown = buildBreakdown(records, path, skippedLines)
    const text = renderTop(breakdown, 10)

    const hugeItem = breakdown.items.find((item) => item.tokens > 5000)
    const smallItem = breakdown.items.find(
      (item) => item.category === 'tool_output' && item.tokens < 2000,
    )
    expect(hugeItem).toBeDefined()
    expect(smallItem).toBeDefined()

    const rankedLines = text.split('\n').filter((line) => /^\s*\d/.test(line))
    const hugeLine = rankedLines.find((line) => line.includes('⚠'))
    const smallLine = rankedLines.find(
      (line) =>
        line.includes(formatTokens(smallItem!.tokens)) && !line.includes('⚠'),
    )
    expect(hugeLine).toBeDefined()
    expect(smallLine).toBeDefined()
    expect(text).toMatch(/5,?000/)
  })
})
