import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { countTokens, type RolloutRecord } from '../../src/breakdown.js'

type JsonLine = {
  timestamp?: string
  type: string
  payload: Record<string, unknown>
}

function line(
  type: string,
  payload: Record<string, unknown>,
  timestamp = '2026-01-15T10:00:00Z',
): JsonLine {
  return { timestamp, type, payload }
}

export function sessionMeta(
  overrides: Partial<Record<string, unknown>> = {},
): JsonLine {
  return line('session_meta', {
    id: 'sess-demo-001',
    cwd: '/workspace/demo',
    cli_version: '0.144.6',
    timestamp: '2026-01-15T10:00:00Z',
    base_instructions: {
      text: overrides.baseInstructionsText ?? 'You are a helpful coding agent.',
    },
    ...overrides,
  })
}

export function turnContext(model = 'gpt-5-codex'): JsonLine {
  return line('turn_context', {
    model,
    turn_id: 'turn-1',
    cwd: '/workspace/demo',
  })
}

export function worldState(agentsMd: string): JsonLine {
  return line('world_state', {
    state: {
      agents_md: { text: agentsMd },
    },
  })
}

export function developerMessage(tag: string, text: string): JsonLine {
  const body = text.startsWith('<') ? text : `<${tag}>\n${text}`
  return line('response_item', {
    type: 'message',
    role: 'developer',
    content: [{ type: 'input_text', text: body }],
  })
}

export function userMessage(text: string): JsonLine {
  return line('response_item', {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
  })
}

export function assistantMessage(text: string): JsonLine {
  return line('response_item', {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  })
}

export function legacyUserInstructions(text: string): JsonLine {
  const body = text.startsWith('<user_instructions>')
    ? text
    : `<user_instructions>\n${text}`
  return userMessage(body)
}

export function customToolCall(
  name: string,
  input: string,
  callId: string,
): JsonLine {
  return line('response_item', {
    type: 'custom_tool_call',
    name,
    call_id: callId,
    input,
  })
}

export function customToolCallOutput(callId: string, output: string): JsonLine {
  return line('response_item', {
    type: 'custom_tool_call_output',
    call_id: callId,
    output,
  })
}

export function functionCall(
  name: string,
  argumentsJson: string,
  callId: string,
): JsonLine {
  return line('response_item', {
    type: 'function_call',
    name,
    call_id: callId,
    arguments: argumentsJson,
  })
}

export function functionCallOutput(callId: string, output: string): JsonLine {
  return line('response_item', {
    type: 'function_call_output',
    call_id: callId,
    output,
  })
}

export function reasoning(): JsonLine {
  return line('response_item', {
    type: 'reasoning',
    encrypted: true,
  })
}

export function tokenCount(opts: {
  input: number
  max: number
  reasoningOutput?: number
}): JsonLine {
  return line('event_msg', {
    type: 'token_count',
    info: {
      model_context_window: opts.max,
      last_token_usage: {
        input_tokens: opts.input,
        output_tokens: 0,
        reasoning_output_tokens: opts.reasoningOutput ?? 0,
        total_tokens: opts.input,
      },
    },
  })
}

export function compacted(
  message: string,
  replacementHistory: Record<string, unknown>[],
): JsonLine {
  return line('compacted', {
    message,
    replacement_history: replacementHistory,
  })
}

export function malformedLine(): string {
  return '{not valid json'
}

export function filler(targetTokens: number): string {
  const words = ['sit', 'amet', 'lorem', 'ipsum', 'dolor']
  return Array.from(
    { length: Math.max(0, targetTokens) },
    (_, i) => words[i % words.length],
  ).join(' ')
}

export function writeRollout(
  home: string,
  date: string,
  id: string,
  records: (JsonLine | string)[],
): string {
  const [year, month, day] = date.split('-')
  const dir = join(home, 'sessions', year, month, day)
  mkdirSync(dir, { recursive: true })
  const filename = `rollout-${date}T12-00-00-${id}.jsonl`
  const path = join(dir, filename)
  const body = records
    .map((record) =>
      typeof record === 'string' ? record : JSON.stringify(record),
    )
    .join('\n')
  writeFileSync(path, `${body}\n`, 'utf8')
  return path
}

export function standardSession(): JsonLine[] {
  const systemText = filler(40)
  const devText = filler(25)
  const agentsText = filler(30)
  const envText = `<environment_context>\n${filler(20)}`
  const userText = filler(15)
  const assistantText = filler(18)
  const toolInput = filler(12)
  const toolOutput = filler(22)
  const legacyAgents = filler(10)
  const reasoningTokens = 17

  const items = [
    sessionMeta({ baseInstructionsText: systemText }),
    turnContext('demo-model'),
    worldState(agentsText),
    developerMessage(
      'permissions instructions',
      `<permissions instructions>\n${devText}`,
    ),
    userMessage(envText),
    userMessage(userText),
    assistantMessage(assistantText),
    legacyUserInstructions(legacyAgents),
    customToolCall('read_file', toolInput, 'call-read-1'),
    customToolCallOutput('call-read-1', toolOutput),
    functionCall('grep', '{"pattern":"demo"}', 'call-grep-1'),
    functionCallOutput('call-grep-1', filler(8)),
    reasoning(),
    tokenCount({
      input: 200,
      max: 272000,
      reasoningOutput: reasoningTokens,
    }),
  ]

  return items
}

export function standardSessionAsRecords(): RolloutRecord[] {
  return standardSession().map((record, index) => ({
    line: index + 1,
    timestamp: record.timestamp,
    type: record.type,
    payload: record.payload,
  }))
}
