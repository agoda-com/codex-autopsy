import { homedir } from 'node:os'
import { styleText } from 'node:util'

import type { Breakdown } from './breakdown.js'
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

export function renderTop(_b: Breakdown, _n: number): string {
  return ''
}

export function renderTurns(_b: Breakdown): string {
  return ''
}

export function renderList(_sessions: SessionSummary[]): string {
  return ''
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
