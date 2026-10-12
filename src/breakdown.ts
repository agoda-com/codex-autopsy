import { encode } from 'gpt-tokenizer'

export type CategoryKey =
  | 'system'
  | 'developer'
  | 'agents_md'
  | 'environment'
  | 'conversation'
  | 'tool_calls'
  | 'tool_output'
  | 'reasoning'

export type RolloutRecord = {
  line: number
  timestamp?: string
  type: string
  payload: Record<string, unknown>
}

export type Item = {
  category: CategoryKey
  child: string
  preview: string
  tokens: number
  line: number
  estimated: boolean
}

export type Turn = {
  turnId: string
  inputTokens: number
  delta: number
  compacted: boolean
}

export type Breakdown = {
  schemaVersion: 1
  session: {
    id: string
    path: string
    cwd: string
    model: string
    cliVersion: string
    started: string
  }
  window: { used: number; max: number; free: number }
  categories: {
    key: CategoryKey
    label: string
    tokens: number
    estimated: boolean
    children: { name: string; tokens: number }[]
  }[]
  unattributed: number
  items: Item[]
  turns: Turn[]
  skippedLines: number
}

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

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  system: 'System instructions',
  developer: 'Developer instructions',
  agents_md: 'AGENTS.md',
  environment: 'Environment & plugins',
  conversation: 'Conversation',
  tool_calls: 'Tool calls',
  tool_output: 'Tool output',
  reasoning: 'Reasoning (est.)',
}

export function countTokens(text: string): number {
  return encode(text).length
}

function messageText(payload: Record<string, unknown>): string {
  const content = payload.content
  if (!Array.isArray(content)) {
    return ''
  }
  const parts: string[] = []
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      'text' in block &&
      typeof block.text === 'string'
    ) {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

function leadingTag(text: string): string | undefined {
  const match = /^<([^\s>]+)/.exec(text.trimStart())
  return match?.[1]
}

function developerChild(text: string): string {
  const match = /^<([^>]+)>/.exec(text.trimStart())
  if (!match) {
    return 'other'
  }
  const inner = match[1].trim()
  const first = inner.split(/\s+/)[0]
  return first || 'other'
}

function stringField(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === undefined || value === null) {
    return ''
  }
  return JSON.stringify(value)
}

function callIdToName(records: RolloutRecord[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const record of records) {
    if (record.type !== 'response_item') {
      continue
    }
    const itemType = record.payload.type
    const callId = record.payload.call_id
    if (typeof callId !== 'string') {
      continue
    }
    const name =
      typeof record.payload.name === 'string'
        ? record.payload.name
        : typeof itemType === 'string'
          ? itemType
          : 'tool'
    if (
      itemType === 'custom_tool_call' ||
      itemType === 'function_call' ||
      itemType === 'local_shell_call' ||
      itemType === 'web_search_call'
    ) {
      map.set(callId, name)
    }
  }
  return map
}

function nextTokenCountReasoning(
  records: RolloutRecord[],
  fromIndex: number,
): number {
  for (let i = fromIndex + 1; i < records.length; i++) {
    const record = records[i]
    if (record.type !== 'event_msg' || record.payload.type !== 'token_count') {
      continue
    }
    const info = record.payload.info
    if (!info || typeof info !== 'object') {
      return 0
    }
    const usage = (info as Record<string, unknown>).last_token_usage
    if (!usage || typeof usage !== 'object') {
      return 0
    }
    const reasoning = (usage as Record<string, unknown>).reasoning_output_tokens
    return typeof reasoning === 'number' ? reasoning : 0
  }
  return 0
}

export function previewOf(record: RolloutRecord): string {
  let text = ''
  if (record.type === 'session_meta') {
    const base = record.payload.base_instructions
    if (
      base &&
      typeof base === 'object' &&
      'text' in base &&
      typeof base.text === 'string'
    ) {
      text = base.text
    }
  } else if (record.type === 'world_state') {
    const state = record.payload.state
    if (
      state &&
      typeof state === 'object' &&
      'agents_md' in state &&
      state.agents_md &&
      typeof state.agents_md === 'object' &&
      'text' in state.agents_md &&
      typeof state.agents_md.text === 'string'
    ) {
      text = state.agents_md.text
    }
  } else if (record.type === 'response_item') {
    const itemType = record.payload.type
    if (itemType === 'message') {
      text = messageText(record.payload)
    } else if (itemType === 'custom_tool_call') {
      text = stringField(record.payload.input)
    } else if (itemType === 'function_call') {
      text = stringField(record.payload.arguments)
    } else if (
      itemType === 'custom_tool_call_output' ||
      itemType === 'function_call_output'
    ) {
      text = stringField(record.payload.output)
    } else if (itemType === 'reasoning') {
      text = '(encrypted reasoning)'
    } else {
      text = stringField(record.payload.input ?? record.payload.arguments)
    }
  }
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= 80) {
    return oneLine
  }
  return oneLine.slice(0, 77) + '...'
}

export function readItems(records: RolloutRecord[]): Item[] {
  const items: Item[] = []
  const callNames = callIdToName(records)

  for (let index = 0; index < records.length; index++) {
    const record = records[index]

    if (record.type === 'session_meta') {
      const base = record.payload.base_instructions
      if (
        base &&
        typeof base === 'object' &&
        'text' in base &&
        typeof base.text === 'string'
      ) {
        const text = base.text
        items.push({
          category: 'system',
          child: 'base_instructions',
          preview: previewOf(record),
          tokens: countTokens(text),
          line: record.line,
          estimated: false,
        })
      }
      continue
    }

    if (record.type === 'world_state') {
      const state = record.payload.state
      if (
        state &&
        typeof state === 'object' &&
        'agents_md' in state &&
        state.agents_md &&
        typeof state.agents_md === 'object' &&
        'text' in state.agents_md &&
        typeof state.agents_md.text === 'string'
      ) {
        const text = state.agents_md.text
        items.push({
          category: 'agents_md',
          child: 'agents_md',
          preview: previewOf(record),
          tokens: countTokens(text),
          line: record.line,
          estimated: false,
        })
      }
      continue
    }

    if (record.type !== 'response_item') {
      continue
    }

    const itemType = record.payload.type

    if (itemType === 'message') {
      const role = record.payload.role
      const text = messageText(record.payload)
      if (!text) {
        continue
      }
      if (role === 'developer') {
        items.push({
          category: 'developer',
          child: developerChild(text),
          preview: previewOf(record),
          tokens: countTokens(text),
          line: record.line,
          estimated: false,
        })
        continue
      }
      if (role === 'user') {
        if (text.trimStart().startsWith('<user_instructions>')) {
          items.push({
            category: 'agents_md',
            child: 'user_instructions',
            preview: previewOf(record),
            tokens: countTokens(text),
            line: record.line,
            estimated: false,
          })
          continue
        }
        const tag = leadingTag(text)
        if (tag) {
          items.push({
            category: 'environment',
            child: tag,
            preview: previewOf(record),
            tokens: countTokens(text),
            line: record.line,
            estimated: false,
          })
          continue
        }
        items.push({
          category: 'conversation',
          child: 'user',
          preview: previewOf(record),
          tokens: countTokens(text),
          line: record.line,
          estimated: false,
        })
        continue
      }
      if (role === 'assistant') {
        const tag = leadingTag(text)
        if (tag) {
          continue
        }
        items.push({
          category: 'conversation',
          child: 'assistant',
          preview: previewOf(record),
          tokens: countTokens(text),
          line: record.line,
          estimated: false,
        })
      }
      continue
    }

    if (itemType === 'custom_tool_call') {
      const name =
        typeof record.payload.name === 'string' ? record.payload.name : 'tool'
      const input = stringField(record.payload.input)
      items.push({
        category: 'tool_calls',
        child: name,
        preview: previewOf(record),
        tokens: countTokens(input),
        line: record.line,
        estimated: false,
      })
      continue
    }

    if (itemType === 'function_call') {
      const name =
        typeof record.payload.name === 'string'
          ? record.payload.name
          : 'function'
      const args = stringField(record.payload.arguments)
      items.push({
        category: 'tool_calls',
        child: name,
        preview: previewOf(record),
        tokens: countTokens(args),
        line: record.line,
        estimated: false,
      })
      continue
    }

    if (itemType === 'local_shell_call' || itemType === 'web_search_call') {
      const name =
        typeof record.payload.name === 'string' ? record.payload.name : itemType
      const body = stringField(
        record.payload.input ?? record.payload.arguments ?? record.payload,
      )
      items.push({
        category: 'tool_calls',
        child: name,
        preview: previewOf(record),
        tokens: countTokens(body),
        line: record.line,
        estimated: false,
      })
      continue
    }

    if (
      itemType === 'custom_tool_call_output' ||
      itemType === 'function_call_output'
    ) {
      const callId = record.payload.call_id
      const child =
        typeof callId === 'string' && callNames.has(callId)
          ? callNames.get(callId)!
          : typeof callId === 'string'
            ? callId
            : 'output'
      const output = stringField(record.payload.output)
      items.push({
        category: 'tool_output',
        child,
        preview: previewOf(record),
        tokens: countTokens(output),
        line: record.line,
        estimated: false,
      })
      continue
    }

    if (itemType === 'reasoning') {
      const tokens = nextTokenCountReasoning(records, index)
      items.push({
        category: 'reasoning',
        child: 'reasoning',
        preview: previewOf(record),
        tokens,
        line: record.line,
        estimated: true,
      })
    }
  }

  return items
}

export function collectTurns(_records: RolloutRecord[]): Turn[] {
  return []
}

export function afterLastCompaction(records: RolloutRecord[]): RolloutRecord[] {
  let lastCompactedIndex = -1
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].type === 'compacted') {
      lastCompactedIndex = i
      break
    }
  }
  if (lastCompactedIndex === -1) {
    return records
  }

  const compactedRecord = records[lastCompactedIndex]
  const replacement = replacementHistoryRecords(compactedRecord)
  const result: RolloutRecord[] = []

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record.type === 'response_item' && i <= lastCompactedIndex) {
      continue
    }
    result.push(record)
    if (i === lastCompactedIndex) {
      result.push(...replacement)
    }
  }

  return result
}

function replacementHistoryRecords(
  compactedRecord: RolloutRecord,
): RolloutRecord[] {
  const payload = compactedRecord.payload
  const replacement = payload.replacement_history
  if (Array.isArray(replacement)) {
    const items: RolloutRecord[] = []
    for (const item of replacement) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue
      }
      items.push({
        line: compactedRecord.line,
        timestamp: compactedRecord.timestamp,
        type: 'response_item',
        payload: item as Record<string, unknown>,
      })
    }
    return items
  }

  const message = payload.message
  if (typeof message !== 'string') {
    return []
  }
  return [
    {
      line: compactedRecord.line,
      timestamp: compactedRecord.timestamp,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: message }],
      },
    },
  ]
}

function lastWindow(records: RolloutRecord[]): { used: number; max: number } {
  let used = 0
  let max = 0
  for (const record of records) {
    if (record.type !== 'event_msg' || record.payload.type !== 'token_count') {
      continue
    }
    const info = record.payload.info
    if (!info || typeof info !== 'object') {
      continue
    }
    const infoObj = info as Record<string, unknown>
    const usage = infoObj.last_token_usage
    if (usage && typeof usage === 'object') {
      const input = (usage as Record<string, unknown>).input_tokens
      if (typeof input === 'number') {
        used = input
      }
    }
    const modelWindow = infoObj.model_context_window
    if (typeof modelWindow === 'number') {
      max = modelWindow
    }
  }
  return { used, max }
}

function sessionFields(records: RolloutRecord[]): {
  id: string
  cwd: string
  cliVersion: string
  started: string
  model: string
} {
  let id = ''
  let cwd = ''
  let cliVersion = ''
  let started = ''
  let model = ''

  for (const record of records) {
    if (record.type === 'session_meta') {
      if (typeof record.payload.id === 'string') {
        id = record.payload.id
      }
      if (typeof record.payload.cwd === 'string') {
        cwd = record.payload.cwd
      }
      if (typeof record.payload.cli_version === 'string') {
        cliVersion = record.payload.cli_version
      }
      if (typeof record.payload.timestamp === 'string') {
        started = record.payload.timestamp
      }
      if (typeof record.payload.model === 'string') {
        model = record.payload.model
      }
    }
    if (
      record.type === 'turn_context' &&
      typeof record.payload.model === 'string'
    ) {
      model = record.payload.model
    }
  }

  return { id, cwd, cliVersion, started, model }
}

function aggregateCategories(items: Item[]): Breakdown['categories'] {
  const buckets = new Map<CategoryKey, Map<string, number>>()
  const estimated = new Map<CategoryKey, boolean>()
  for (const key of CATEGORY_ORDER) {
    buckets.set(key, new Map())
    estimated.set(key, false)
  }

  for (const item of items) {
    const bucket = buckets.get(item.category)!
    bucket.set(item.child, (bucket.get(item.child) ?? 0) + item.tokens)
    if (item.estimated) {
      estimated.set(item.category, true)
    }
  }

  return CATEGORY_ORDER.map((key) => {
    const bucket = buckets.get(key)!
    const children = [...bucket.entries()]
      .map(([name, tokens]) => ({ name, tokens }))
      .sort((a, b) => b.tokens - a.tokens)
    const tokens = children.reduce((sum, child) => sum + child.tokens, 0)
    return {
      key,
      label: CATEGORY_LABELS[key],
      tokens,
      estimated: estimated.get(key) ?? false,
      children,
    }
  })
}

export function buildBreakdown(
  records: RolloutRecord[],
  path: string,
  skippedLines: number,
): Breakdown {
  const compacted = afterLastCompaction(records)
  const items = readItems(compacted).sort((a, b) => b.tokens - a.tokens)
  const categories = aggregateCategories(items)
  const categoryTotal = categories.reduce((sum, cat) => sum + cat.tokens, 0)
  const window = lastWindow(records)
  const session = sessionFields(records)
  const free = Math.max(0, window.max - window.used)

  return {
    schemaVersion: 1,
    session: {
      id: session.id,
      path,
      cwd: session.cwd,
      model: session.model,
      cliVersion: session.cliVersion,
      started: session.started,
    },
    window: { used: window.used, max: window.max, free },
    categories,
    unattributed: Math.max(0, window.used - categoryTotal),
    items,
    turns: collectTurns(records),
    skippedLines,
  }
}
