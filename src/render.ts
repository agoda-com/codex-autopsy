import type { Breakdown } from './breakdown.js'
import type { SessionSummary } from './rollout.js'

export function renderBanner(): string {
  return ''
}

export function renderBreakdown(b: Breakdown): string {
  const lines = b.categories.map((cat) => `${cat.label}\t${cat.tokens}`)
  return lines.join('\n')
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
