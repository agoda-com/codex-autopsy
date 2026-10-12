import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Breakdown, CategoryKey } from './breakdown.js'
import type { SessionSummary } from './rollout.js'

// Agoda brand palette: the five logo colours plus the call-to-action blue, with tints
// for categories beyond six. Depth is 1 (no colour), 4, 8 or 24 bits, as reported by
// tty.WriteStream#getColorDepth.
const BRAND = {
  red: '#FF2938',
  yellow: '#FDB812',
  green: '#00B057',
  purple: '#AF38B1',
  blue: '#00AAE0',
  cta: '#478CF7',
  redTint: '#FF7A84',
  purpleTint: '#D98BDA',
  grey: '#B8B8B8',
  dim: '#5C5C5C',
}

const CATEGORY_COLOUR: Record<CategoryKey | 'unattributed' | 'free', string> = {
  system: BRAND.blue,
  developer: BRAND.cta,
  agents_md: BRAND.green,
  environment: BRAND.purple,
  conversation: BRAND.yellow,
  tool_calls: BRAND.redTint,
  tool_output: BRAND.red,
  reasoning: BRAND.purpleTint,
  unattributed: BRAND.grey,
  free: BRAND.dim,
}

const USED_CELL = '⛁'
const FREE_CELL = '⛶'

export function paint(
  text: string,
  hex: string,
  depth: number,
  bold = false,
): string {
  if (depth < 4 || text.length === 0) {
    return text
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const colour =
    depth >= 24
      ? `38;2;${r};${g};${b}`
      : depth >= 8
        ? `38;5;${paintXterm256(r, g, b)}`
        : paintBasic(r, g, b)
  return `\x1b[${bold ? '1;' : ''}${colour}m${text}\x1b[0m`
}

function paintXterm256(r: number, g: number, b: number): number {
  const level = (v: number) =>
    v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40)
  return 16 + 36 * level(r) + 6 * level(g) + level(b)
}

function paintBasic(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b)
  if (max - Math.min(r, g, b) < 40) {
    return max > 150 ? '37' : '90'
  }
  const bit = (v: number) => (v >= max * 0.6 ? 1 : 0)
  return String(90 + bit(r) + 2 * bit(g) + 4 * bit(b))
}

function dim(text: string, depth: number): string {
  return depth < 4 ? text : `\x1b[2m${text}\x1b[0m`
}

function bold(text: string, depth: number): string {
  return depth < 4 ? text : `\x1b[1m${text}\x1b[0m`
}

export function renderBanner(depth = 1): string {
  const dots = [BRAND.red, BRAND.yellow, BRAND.green, BRAND.purple, BRAND.blue]
    .map((hex) => paint('●', hex, depth))
    .join(' ')
  return [
    paint('      ___', BRAND.grey, depth),
    paint('     /   \\', BRAND.grey, depth),
    `${paint('    | x x |', BRAND.grey, depth)}   ${paint('CODEX AUTOPSY', BRAND.red, depth, true)}`,
    `${paint('     \\_^_/', BRAND.grey, depth)}    ${dots}`,
    ` ${paint('What killed my context window?', BRAND.yellow, depth)}`,
  ].join('\n')
}

export function renderBreakdown(b: Breakdown, depth = 1): string {
  const grid = breakdownGrid(b, depth)
  const legend = breakdownLegend(b, depth)
  const rows = Math.max(grid.length, legend.length)
  const gridWidth = BREAKDOWN_GRID_COLUMNS * 2 - 1
  const lines: string[] = []
  for (let i = 0; i < rows; i++) {
    const left = grid[i] ?? ' '.repeat(gridWidth)
    lines.push(`  ${left}   ${legend[i] ?? ''}`.trimEnd())
  }
  return lines.join('\n')
}

const LARGE_ITEM_TOKENS = 5000
const TOP_BAR_WIDTH = 12

function categoryLabel(b: Breakdown, key: CategoryKey): string {
  return b.categories.find((cat) => cat.key === key)?.label ?? key
}

export function renderTop(b: Breakdown, n: number, depth = 1): string {
  const count = Math.max(0, Math.min(n, b.items.length))
  const items = b.items.slice(0, count)
  const largest = items[0]?.tokens ?? 0
  const childWidth = Math.max(0, ...items.map((item) => item.child.length))
  const lines: string[] = []
  let hasLarge = false

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const colour = CATEGORY_COLOUR[item.category]
    const rank = dim(String(index + 1).padStart(2, ' '), depth)
    const tokens = bold(formatTokens(item.tokens).padStart(6, ' '), depth)
    const filled =
      largest > 0
        ? Math.max(1, Math.round((TOP_BAR_WIDTH * item.tokens) / largest))
        : 0
    const bar =
      paint('█'.repeat(filled), colour, depth) +
      dim('·'.repeat(TOP_BAR_WIDTH - filled), depth)
    const label = `${paint(USED_CELL, colour, depth)} ${categoryLabel(b, item.category).padEnd(22, ' ')}`
    const isLarge = item.tokens > LARGE_ITEM_TOKENS
    const marker = isLarge ? ` ${paint('⚠', BRAND.yellow, depth)}` : ''
    if (isLarge) {
      hasLarge = true
    }
    lines.push(
      `${rank}  ${tokens}  ${bar}  ${label}  ${item.child.padEnd(childWidth)}  ${dim(item.preview, depth)}${marker}`,
    )
  }

  if (hasLarge) {
    lines.push('')
    lines.push(
      paint(
        '⚠ Items over 5,000 tokens are unusually large and may dominate the context window.',
        BRAND.yellow,
        depth,
      ),
    )
  }

  return lines.join('\n')
}

function formatDelta(delta: number, depth: number): string {
  const sign = delta >= 0 ? '+' : '-'
  const text = `${sign}${formatTokens(Math.abs(delta))}`
  return paint(text.padStart(8), delta >= 0 ? BRAND.yellow : BRAND.green, depth)
}

const TURN_BAR_WIDTH = 40
const SPARK = '▁▂▃▄▅▆▇█'

function fillColour(ratio: number): string {
  return ratio < 0.5 ? BRAND.green : ratio < 0.8 ? BRAND.yellow : BRAND.red
}

function turnBar(inputTokens: number, max: number, depth: number): string {
  const filled =
    max > 0
      ? Math.min(
          TURN_BAR_WIDTH,
          Math.max(0, Math.round((TURN_BAR_WIDTH * inputTokens) / max)),
        )
      : 0
  const ratio = max > 0 ? inputTokens / max : 0
  return (
    paint('█'.repeat(filled), fillColour(ratio), depth) +
    paint('░'.repeat(TURN_BAR_WIDTH - filled), BRAND.dim, depth)
  )
}

function turnSparkline(b: Breakdown, depth: number): string {
  const peak = Math.max(1, ...b.turns.map((turn) => turn.inputTokens))
  return b.turns
    .map((turn) => {
      const glyph =
        SPARK[
          Math.min(
            SPARK.length - 1,
            Math.floor((turn.inputTokens / peak) * SPARK.length),
          )
        ]
      const colour = turn.compacted
        ? BRAND.purple
        : fillColour(b.window.max > 0 ? turn.inputTokens / b.window.max : 0)
      return paint(glyph, colour, depth)
    })
    .join('')
}

export function renderTurns(b: Breakdown, depth = 1): string {
  const lines: string[] = [
    `${bold('Window max:', depth)} ${formatTokens(b.window.max)}   ${turnSparkline(b, depth)}`,
  ]
  for (let index = 0; index < b.turns.length; index++) {
    const turn = b.turns[index]
    const compactedSuffix = turn.compacted
      ? `  ${paint('compacted', BRAND.purple, depth)}`
      : ''
    lines.push(
      `  ${dim(String(index + 1).padStart(3), depth)}  ${formatTokens(turn.inputTokens).padStart(7)}  ${formatDelta(turn.delta, depth)}  ${turnBar(turn.inputTokens, b.window.max, depth)}${compactedSuffix}`,
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
  const rows = sessions.map((session) => {
    const idShort = session.id.slice(0, 8)
    const window = formatTokens(session.windowMax)
    return `${session.started}  ${idShort}  ${window}  ${breakdownDisplayCwd(session.cwd)}  ${session.firstPrompt}`
  })
  return `${rows.join('\n')}\n`
}

export function formatTokens(n: number): string {
  return `${(n / 1000).toFixed(1)}k`
}

const BREAKDOWN_GRID_COLUMNS = 20
const BREAKDOWN_GRID_ROWS = 10

type BreakdownSegment = { key: CategoryKey | 'unattributed'; tokens: number }

function breakdownSegments(b: Breakdown): BreakdownSegment[] {
  return [
    ...b.categories.map((cat) => ({ key: cat.key, tokens: cat.tokens })),
    { key: 'unattributed' as const, tokens: b.unattributed },
  ]
}

function breakdownGrid(b: Breakdown, depth: number): string[] {
  const cellCount = BREAKDOWN_GRID_COLUMNS * BREAKDOWN_GRID_ROWS
  const segments = breakdownSegments(b)
  const counts = breakdownCellCounts(
    segments.map((s) => s.tokens),
    b.window.max,
    cellCount,
  )
  const cells: string[] = []
  segments.forEach((segment, i) => {
    for (let k = 0; k < counts[i]; k++) {
      cells.push(paint(USED_CELL, CATEGORY_COLOUR[segment.key], depth))
    }
  })
  while (cells.length < cellCount) {
    cells.push(paint(FREE_CELL, CATEGORY_COLOUR.free, depth))
  }
  const rows: string[] = []
  for (let r = 0; r < BREAKDOWN_GRID_ROWS; r++) {
    rows.push(
      cells
        .slice(r * BREAKDOWN_GRID_COLUMNS, (r + 1) * BREAKDOWN_GRID_COLUMNS)
        .join(' '),
    )
  }
  return rows
}

function breakdownCellCounts(
  tokens: number[],
  max: number,
  cells: number,
): number[] {
  if (max <= 0) {
    return tokens.map(() => 0)
  }
  const exact = tokens.map((t) => (t / max) * cells)
  const result = exact.map((v, i) =>
    tokens[i] > 0 ? Math.max(1, Math.floor(v)) : 0,
  )
  const target = Math.min(
    cells,
    Math.max(
      result.reduce((a, c) => a + c, 0),
      Math.round(exact.reduce((a, c) => a + c, 0)),
    ),
  )
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .filter(({ i }) => tokens[i] > 0)
    .sort((a, c) => c.frac - a.frac)
  let total = result.reduce((a, c) => a + c, 0)
  for (let k = 0; total < target && k < order.length; k++, total++) {
    result[order[k].i] += 1
  }
  while (total > cells) {
    const largest = result.indexOf(Math.max(...result))
    result[largest] -= 1
    total -= 1
  }
  return result
}

const LEGEND_LABEL_WIDTH = 24

function breakdownLegend(b: Breakdown, depth: number): string[] {
  const idPrefix = b.session.id.slice(0, 8)
  const pct =
    b.window.max > 0 ? ((b.window.used / b.window.max) * 100).toFixed(1) : '0.0'
  const lines = [
    `${bold('Codex context', depth)} · ${idPrefix}`,
    `${paint(b.session.model, BRAND.green, depth)} · ${breakdownDisplayCwd(b.session.cwd)} · ${breakdownFormatStarted(b.session.started)}`,
    `${paint(`${formatTokens(b.window.used)} / ${formatTokens(b.window.max)} tokens (${pct}%)`, BRAND.cta, depth, true)}`,
    '',
    dim('Usage by category (% of used)', depth),
  ]
  for (const cat of b.categories) {
    lines.push(
      breakdownLegendRow(
        paint(USED_CELL, CATEGORY_COLOUR[cat.key], depth),
        cat.label,
        cat.tokens,
        breakdownPercentOfUsed(cat.tokens, b.window.used),
        dim(breakdownChildrenLine(cat.children), depth),
      ),
    )
  }
  lines.push(
    breakdownLegendRow(
      paint(USED_CELL, CATEGORY_COLOUR.unattributed, depth),
      'Unattributed',
      b.unattributed,
      breakdownPercentOfUsed(b.unattributed, b.window.used),
      dim('tool schemas, MCP, framing (not in rollout)', depth),
    ),
  )
  lines.push(
    breakdownLegendRow(
      paint(FREE_CELL, CATEGORY_COLOUR.free, depth),
      'Free',
      b.window.free,
      '',
      '',
    ),
  )
  return lines
}

function breakdownLegendRow(
  icon: string,
  label: string,
  tokens: number,
  percent: string,
  children: string,
): string {
  const row = `${icon} ${label.padEnd(LEGEND_LABEL_WIDTH)}${formatTokens(tokens).padStart(7)}${percent.padStart(8)}`
  return children ? `${row}   ${children}` : row
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
  return children
    .slice(0, 3)
    .map((c) => `${c.name} ${formatTokens(c.tokens)}`)
    .join(' · ')
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

const MONTHS = [
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

function breakdownFormatStarted(iso: string): string {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) {
    return ''
  }
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${hours}:${minutes}`
}
