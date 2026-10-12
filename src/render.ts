import { homedir } from 'node:os'
import { join } from 'node:path'
import { styleText } from 'node:util'

import type { Breakdown, CategoryKey } from './breakdown.js'
import type { SessionSummary } from './rollout.js'

export function renderBanner(): string {
  return [
    '      ___',
    '     /   \\',
    '    | o o |   CODEX AUTOPSY',
    '     \\___/',
    ' What killed my context window?',
  ].join('\n')
}

export function renderBreakdown(b: Breakdown): string {
  return breakdownFormat(b, Boolean(process.stdout.isTTY))
}

const LARGE_ITEM_TOKENS = 5000

function categoryLabel(b: Breakdown, key: CategoryKey): string {
  return b.categories.find((cat) => cat.key === key)?.label ?? key
}

export function renderTop(b: Breakdown, n: number): string {
  const count = Math.max(0, Math.min(n, b.items.length))
  const items = b.items.slice(0, count)
  const lines: string[] = []
  let hasLarge = false

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const rank = String(index + 1).padStart(2, ' ')
    const tokens = formatTokens(item.tokens).padStart(6, ' ')
    const label = categoryLabel(b, item.category).padEnd(22, ' ')
    const marker = item.tokens > LARGE_ITEM_TOKENS ? ' ⚠' : ''
    if (item.tokens > LARGE_ITEM_TOKENS) {
      hasLarge = true
    }
    lines.push(
      `${rank}  ${tokens}  ${label}  ${item.child}  ${item.preview}${marker}`,
    )
  }

  if (hasLarge) {
    lines.push('')
    lines.push(
      '⚠ Items over 5,000 tokens are unusually large and may dominate the context window.',
    )
  }

  return lines.join('\n')
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '-'
  return `${sign}${formatTokens(Math.abs(delta))}`
}

function turnBar(inputTokens: number, max: number): string {
  if (max <= 0) {
    return '░'.repeat(40)
  }
  const filled = Math.min(40, Math.max(0, Math.round((40 * inputTokens) / max)))
  return `${'█'.repeat(filled)}${'░'.repeat(40 - filled)}`
}

export function renderTurns(b: Breakdown): string {
  const lines: string[] = [`Window max: ${formatTokens(b.window.max)}`]
  for (let index = 0; index < b.turns.length; index++) {
    const turn = b.turns[index]
    const compactedSuffix = turn.compacted ? '  compacted' : ''
    lines.push(
      `  ${index + 1}  ${formatTokens(turn.inputTokens)}  ${formatDelta(turn.delta)}  ${turnBar(turn.inputTokens, b.window.max)}${compactedSuffix}`,
    )
  }
  return lines.join('\n')
}

export function renderList(
  sessions: SessionSummary[],
  codexHomeDir: string,
): string {
  if (sessions.length === 0) {
    return (
      `No rollouts found under ${join(codexHomeDir, 'sessions')}. ` +
      'Codex deletes old rollouts over time; only sessions still on disk can be listed.\n'
    )
  }
  const home = homedir()
  const homePrefix = home.endsWith('/') ? home : `${home}/`
  const rows = sessions.map((session) => {
    let cwd = session.cwd
    if (cwd.startsWith(homePrefix)) {
      cwd = `~/${cwd.slice(homePrefix.length)}`
    } else if (cwd === home) {
      cwd = '~'
    }
    const idShort = session.id.slice(0, 8)
    const window = formatTokens(session.windowMax)
    return `${session.started}  ${idShort}  ${window}  ${cwd}  ${session.firstPrompt}`
  })
  return `${rows.join('\n')}\n`
}

export function formatTokens(n: number): string {
  return `${(n / 1000).toFixed(1)}k`
}

function breakdownFormat(b: Breakdown, color: boolean): string {
  const lines: string[] = []
  lines.push(breakdownHeaderLine(b))
  lines.push(breakdownSummaryLine(b))
  lines.push(breakdownBar(b, color))
  lines.push('')

  const labelWidth = 28
  for (const cat of b.categories) {
    lines.push(
      breakdownCategoryRow(
        cat.label,
        cat.tokens,
        breakdownPercentOfUsed(cat.tokens, b.window.used),
        breakdownChildrenLine(cat.children),
        labelWidth,
      ),
    )
  }

  lines.push(
    breakdownCategoryRow(
      'Unattributed',
      b.unattributed,
      breakdownPercentOfUsed(b.unattributed, b.window.used),
      'tool schemas, MCP, framing (not in rollout)',
      labelWidth,
    ),
  )

  const freeLabel = 'Free'.padEnd(labelWidth)
  lines.push(`  ${freeLabel}${formatTokens(b.window.free).padStart(7)}`)

  return lines.join('\n')
}

function breakdownHeaderLine(b: Breakdown): string {
  const idPrefix = b.session.id.slice(0, 8)
  const cwd = breakdownDisplayCwd(b.session.cwd)
  const when = breakdownFormatStarted(b.session.started)
  return `Codex context · ${idPrefix} · ${b.session.model} · ${cwd} · ${when}`
}

function breakdownSummaryLine(b: Breakdown): string {
  const used = formatTokens(b.window.used)
  const max = formatTokens(b.window.max)
  const pct =
    b.window.max > 0 ? ((b.window.used / b.window.max) * 100).toFixed(1) : '0.0'
  return `${used} / ${max} tokens (${pct}%)`
}

const BREAKDOWN_BAR_WIDTH = 64

const BREAKDOWN_BAR_SEGMENTS: {
  glyph: string
  style: Parameters<typeof styleText>[0]
}[] = [
  { glyph: '█', style: 'blue' },
  { glyph: '▓', style: 'magenta' },
  { glyph: '▒', style: 'cyan' },
  { glyph: '░', style: 'green' },
  { glyph: '▄', style: 'yellow' },
  { glyph: '▀', style: 'red' },
  { glyph: '▐', style: 'white' },
  { glyph: '▌', style: 'gray' },
  { glyph: '▎', style: 'whiteBright' },
]

function breakdownBar(b: Breakdown, color: boolean): string {
  const tokensBySegment = [
    ...b.categories.map((cat) => cat.tokens),
    b.unattributed,
    b.window.free,
  ]
  const counts = breakdownDistributeBarChars(tokensBySegment, b.window.max)
  let bar = ''
  let width = 0
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i]
    if (count <= 0) {
      continue
    }
    const isFree = i === counts.length - 1
    const glyph = isFree ? '·' : (BREAKDOWN_BAR_SEGMENTS[i]?.glyph ?? '·')
    const style = isFree ? 'gray' : (BREAKDOWN_BAR_SEGMENTS[i]?.style ?? 'gray')
    const chunk = glyph.repeat(count)
    bar += color ? styleText(style, chunk) : chunk
    width += count
  }
  if (width < BREAKDOWN_BAR_WIDTH) {
    const pad = '·'.repeat(BREAKDOWN_BAR_WIDTH - width)
    bar += color ? styleText('gray', pad) : pad
  }
  return bar
}

function breakdownDistributeBarChars(tokens: number[], max: number): number[] {
  if (max <= 0) {
    return tokens.map(() => 0)
  }
  const exact = tokens.map((t) => (t / max) * BREAKDOWN_BAR_WIDTH)
  const floors = exact.map((v) => Math.floor(v))
  let remaining = BREAKDOWN_BAR_WIDTH - floors.reduce((a, b) => a + b, 0)
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  const result = [...floors]
  for (let k = 0; k < remaining && k < order.length; k++) {
    result[order[k].i] += 1
  }
  return result
}

function breakdownCategoryRow(
  label: string,
  tokens: number,
  percent: string,
  children: string,
  labelWidth: number,
): string {
  const labelCol = label.padEnd(labelWidth)
  const tokCol = formatTokens(tokens).padStart(7)
  const pctCol = percent.padStart(8)
  const suffix = children ? `   ${children}` : ''
  return `  ${labelCol}${tokCol}${pctCol}${suffix}`
}

function breakdownPercentOfUsed(tokens: number, used: number): string {
  if (used <= 0) {
    return '0.0%'
  }
  return `${((tokens / used) * 100).toFixed(1)}%`
}

function breakdownChildrenLine(
  children: { name: string; tokens: number }[],
): string {
  const top = children.slice(0, 3)
  if (top.length === 0) {
    return ''
  }
  return top.map((c) => `${c.name} ${formatTokens(c.tokens)}`).join(' · ')
}

function breakdownDisplayCwd(cwd: string): string {
  const home = homedir()
  if (cwd === home) {
    return '~'
  }
  const prefix = `${home}/`
  if (cwd.startsWith(prefix)) {
    return `~${cwd.slice(home.length)}`
  }
  return cwd
}

function breakdownFormatStarted(iso: string): string {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const day = date.getDate()
  const month = months[date.getMonth()]
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day} ${month} ${hours}:${minutes}`
}
