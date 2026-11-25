// 1 つのセッションの会話の記録から、何をどの順にして、それぞれに時間とトークンをどれだけ使ったかを出す。
//
// 工程（設計、test-designer、実装、verifier、review-code）を余分に呼んでいないか、飛ばしていないかを
// 確かめる材料にする。判断はしない。並べて数えるだけ。
//
//   bun timeline.ts <セッションID>
//
// 区切りは、利用者の発言（通知とスラッシュコマンドを含む）、Skill の呼び出し、Agent の呼び出し。
// 区切りの間のほかのツールは、名前ごとの回数にまとめる。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECTS = join(homedir(), '.claude', 'projects')

export type Usage = { newIn: number; cacheRead: number; out: number }
const zero = (): Usage => ({ newIn: 0, cacheRead: 0, out: 0 })
const add = (a: Usage, b: Usage): Usage => ({ newIn: a.newIn + b.newIn, cacheRead: a.cacheRead + b.cacheRead, out: a.out + b.out })

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const num = (value: unknown): number => (typeof value === 'number' ? value : 0)

export const readUsage = (usage: unknown): Usage =>
  isObject(usage)
    ? { newIn: num(usage.input_tokens) + num(usage.cache_creation_input_tokens), cacheRead: num(usage.cache_read_input_tokens), out: num(usage.output_tokens) }
    : zero()

const readLines = (path: string): Json[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .flatMap(line => {
      if (line === '') return []
      try {
        const value: unknown = JSON.parse(line)
        return isObject(value) ? [value] : []
      } catch {
        return []
      }
    })

const contentOf = (entry: Json): unknown => (isObject(entry.message) ? entry.message.content : undefined)
const blocksOf = (entry: Json): Json[] => {
  const content = contentOf(entry)
  return Array.isArray(content) ? content.filter(isObject) : []
}

// 会話に届いた文を、誰から届いたかで分ける。届いた文はどれもターンを始める。ツールの結果だけの行と、
// スキルの本文のような付け足しの行は null
export type Arrival = { kind: string; text: string }
const HAND_BACK = '[Subagent hand-back]'
export const classifyArrival = (entry: Json): Arrival | null => {
  if (entry.type !== 'user') return null
  const content = contentOf(entry)
  const text = typeof content === 'string' ? content : blocksOf(entry).filter(block => block.type === 'text').map(block => str(block.text) ?? '').join('\n')
  if (text.trim() === '') return null
  const origin = isObject(entry.origin) ? entry.origin : {}
  const from = str(origin.name) ?? '?'
  const body = str(origin.body) ?? text
  switch (origin.kind) {
    case 'human':
      break
    case 'peer':
      // サブエージェントの報告と、別のセッションからの依頼は、どちらも peer で届く
      return body.startsWith(HAND_BACK) ? { kind: `報告 ${from}`, text: '' } : { kind: `依頼 ${from}`, text: oneLine(body) }
    case 'plugin':
      return { kind: `Mod ${from}`, text: oneLine(body) }
    case 'task-notification':
      return { kind: '完了の知らせ', text: oneLine(text.replace(/<[^>]+>/g, ' ')) }
    default:
      if (entry.isMeta === true) return null
  }
  const command = /<command-name>([^<]+)<\/command-name>/.exec(text)
  if (command?.[1] !== undefined) return { kind: 'コマンド', text: command[1] }
  if (text.trimStart().startsWith('<')) return null
  return { kind: '利用者', text: oneLine(text) }
}

const oneLine = (text: string, width = 50): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > width ? `${flat.slice(0, width)}…` : flat
}

const time = (ms: number): number => ms
const parseTs = (entry: Json): number | undefined => {
  const ts = str(entry.timestamp)
  return ts === undefined ? undefined : time(Date.parse(ts))
}

export const duration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}
export const tokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const clock = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const usageText = (u: Usage): string => `out ${tokens(u.out)} / in ${tokens(u.newIn)} / cache ${tokens(u.cacheRead)}`

// 1 回の応答は内容のブロックごとに別の行に記録され、同じ usage が重なって入っている。message.id で 1 回だけ数える
export const sumUsage = (entries: Json[]): Usage => {
  const seen = new Set<string>()
  let total = zero()
  for (const entry of entries) {
    if (entry.type !== 'assistant' || !isObject(entry.message)) continue
    const id = str(entry.message.id)
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    total = add(total, readUsage(entry.message.usage))
  }
  return total
}

// skill は context: fork のスキルが立てたときのスキルの名前。parentAgentId はサブエージェントの中で立ったときの親の id
export type Subagent = {
  id: string
  parentAgentId?: string
  skill?: string
  label: string
  type: string
  description: string
  toolUseId?: string
  background: boolean
  start: number
  end: number
  usage: Usage
}

// サブエージェントの中で立ったサブエージェント（general-purpose の中で context: fork のスキルを呼んだ、など）を、
// 親の子として持つ。別の呼び出しとして並べると、同じ作業を 2 回したように見えるため
export const childrenOf = (agents: Subagent[]): Map<string, Subagent[]> => {
  const ids = new Set(agents.map(agent => agent.id))
  const children = new Map<string, Subagent[]>()
  for (const agent of agents) {
    if (agent.parentAgentId === undefined || !ids.has(agent.parentAgentId)) continue
    children.set(agent.parentAgentId, [...(children.get(agent.parentAgentId) ?? []), agent])
  }
  return children
}

const readSubagents = (dir: string): Subagent[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.jsonl'))
    .flatMap(name => {
      const entries = readLines(join(dir, name))
      const stamps = entries.map(parseTs).filter((ms): ms is number => ms !== undefined)
      if (stamps.length === 0) return []
      const metaPath = join(dir, name.replace(/\.jsonl$/, '.meta.json'))
      const meta: unknown = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {}
      const type = isObject(meta) ? (str(meta.agentType) ?? '?') : '?'
      const description = isObject(meta) ? (str(meta.description) ?? '') : ''
      const skill = isObject(meta) ? str(meta.name) : undefined
      return [
        {
          id: name.replace(/^agent-/, '').replace(/\.jsonl$/, ''),
          parentAgentId: isObject(meta) ? str(meta.parentAgentId) : undefined,
          skill,
          label: `${skill === undefined ? type : `${type}（スキル ${skill}）`} "${oneLine(description, 40)}"`,
          type,
          description,
          toolUseId: isObject(meta) ? str(meta.toolUseId) : undefined,
          background: isObject(meta) && meta.requestShape === 'background',
          start: Math.min(...stamps),
          end: Math.max(...stamps),
          usage: sumUsage(entries),
        },
      ]
    })
}

// 区切りの間の作業。ツールは名前ごとの回数
type Block = { start: number; end: number; tools: Map<string, number>; usage: Usage }
type Mark = { at: number; text: string; turnStart: boolean }

// Bash のコマンドを、先頭の環境変数の代入と cd を除いた最初の 2 語にならす（`bun test`、`jj git`）
export const commandKey = (command: string): string => {
  const words = command
    .trim()
    .split(/\s*(?:&&|;)\s*/)
    .map(part =>
      part
        .trim()
        .replace(/^\(+/, '')
        .split(/\s+/)
        .filter(word => word !== '' && !/^[A-Z_][A-Z0-9_]*=/.test(word)),
    )
    .find(part => part.length > 0 && part[0] !== 'cd')
  if (words === undefined) return '?'
  const [head = '?', second] = words
  const name = head.split('/').pop() ?? head
  return second !== undefined && /^[a-z][a-z0-9:_-]*$/.test(second) ? `${name} ${second}` : name
}

const findTranscript = (sessionId: string): string | undefined => {
  for (const project of readdirSync(PROJECTS)) {
    const path = join(PROJECTS, project, `${sessionId}.jsonl`)
    if (existsSync(path)) return path
  }
  return undefined
}

const main = (): void => {
  const sessionId = process.argv[2]
  if (sessionId === undefined) {
    console.error('使い方: bun timeline.ts <セッションID> [--json]')
    process.exit(2)
  }
  const path = findTranscript(sessionId)
  if (path === undefined) {
    console.error(`記録が見つかりません: ${sessionId}`)
    process.exit(1)
  }
  const entries = readLines(path)
  const subagents = readSubagents(join(path.replace(/\.jsonl$/, ''), 'subagents'))
  const byToolUse = new Map(subagents.flatMap(agent => (agent.toolUseId === undefined ? [] : [[agent.toolUseId, agent] as const])))
  const children = childrenOf(subagents)
  const nested = new Set([...children.values()].flat().map(agent => agent.id))
  // 子のサブエージェントを、親の行の下に字下げして並べる
  const childLines = (agent: Subagent, depth: number): string[] =>
    (children.get(agent.id) ?? [])
      .sort((a, b) => a.start - b.start)
      .flatMap(child => [
        `${' '.repeat(10 + depth * 4)}└ 中で ${child.label}  ${duration(child.end - child.start)}  ${usageText(child.usage)}`,
        ...childLines(child, depth + 1),
      ])

  const lines: string[] = []
  const skillCount = new Map<string, number>()
  const toolTotals = new Map<string, { count: number; ms: number }>()
  const toolStart = new Map<string, { name: string; at: number; command: string | undefined }>()
  const bashTotals = new Map<string, { count: number; ms: number }>()
  const seenMessages = new Set<string>()
  // 閉じた関数の中で書き換えるので、変数でなく入れ物に持つ（変数だと、外の分岐で型が null に絞られる）
  const state: { block: Block | null; turn: { start: number; last: number; line: number; kind: string; text: string; usage: Usage } | null } = { block: null, turn: null }
  // --json で出す、図を描くための値
  const turns: { start: number; end: number; kind: string; text: string; usage: Usage }[] = []
  const skills: { at: number; name: string }[] = []
  let activeMs = 0
  let mainUsage = zero()

  const flush = () => {
    const block = state.block
    if (block === null) return
    const tools = [...block.tools].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name}×${n}`).join(' ')
    if (tools !== '' || block.usage.out > 0) lines.push(`        └ 作業 ${duration(block.end - block.start).padStart(7)}  ${usageText(block.usage)}  ${tools}`)
    state.block = null
  }
  const closeTurn = () => {
    const turn = state.turn
    if (turn !== null) {
      activeMs += turn.last - turn.start
      turns.push({ start: turn.start, end: turn.last, kind: turn.kind, text: turn.text, usage: turn.usage })
      lines[turn.line] += `  （ターン ${duration(turn.last - turn.start)}）`
    }
    state.turn = null
  }
  const mark = (m: Mark, arrival?: Arrival) => {
    flush()
    if (m.turnStart) closeTurn()
    lines.push(`${clock(m.at)}  ${m.text}`)
    if (arrival !== undefined) state.turn = { start: m.at, last: m.at, line: lines.length - 1, kind: arrival.kind, text: arrival.text, usage: zero() }
  }

  for (const entry of entries) {
    const at = parseTs(entry)
    if (at === undefined) continue
    const arrival = classifyArrival(entry)
    if (arrival !== null) {
      mark({ at, text: `[${arrival.kind}] ${arrival.text}`.trimEnd(), turnStart: true }, arrival)
      continue
    }
    for (const result of blocksOf(entry).filter(b => b.type === 'tool_result')) {
      const started = toolStart.get(str(result.tool_use_id) ?? '')
      if (started === undefined) continue
      const total = toolTotals.get(started.name) ?? { count: 0, ms: 0 }
      toolTotals.set(started.name, { count: total.count, ms: total.ms + (at - started.at) })
      if (started.command !== undefined) {
        const key = commandKey(started.command)
        const bash = bashTotals.get(key) ?? { count: 0, ms: 0 }
        bashTotals.set(key, { count: bash.count + 1, ms: bash.ms + (at - started.at) })
      }
    }
    if (entry.type !== 'assistant' || !isObject(entry.message)) continue
    if (state.turn !== null) state.turn.last = at
    for (const use of blocksOf(entry).filter(b => b.type === 'tool_use')) {
      const name = str(use.name) ?? '?'
      const id = str(use.id) ?? ''
      const input = isObject(use.input) ? use.input : {}
      toolStart.set(id, { name, at, command: name === 'Bash' ? str(input.command) : undefined })
      const total = toolTotals.get(name) ?? { count: 0, ms: 0 }
      toolTotals.set(name, { count: total.count + 1, ms: total.ms })
      if (name === 'Skill') {
        const skill = str(input.skill) ?? '?'
        skillCount.set(skill, (skillCount.get(skill) ?? 0) + 1)
        skills.push({ at, name: skill })
        mark({ at, text: `  Skill ${skill}`, turnStart: false })
      } else if (name === 'Agent') {
        const agent = byToolUse.get(id)
        const type = str(input.subagent_type) ?? 'general-purpose'
        const detail = agent === undefined ? '' : `  ${agent.background ? '裏' : '前'} ${duration(agent.end - agent.start)}  ${usageText(agent.usage)}`
        mark({ at, text: `  Agent ${type} "${oneLine(str(input.description) ?? '', 40)}"${detail}`, turnStart: false })
        if (agent !== undefined) lines.push(...childLines(agent, 0))
      } else {
        state.block ??= { start: at, end: at, tools: new Map(), usage: zero() }
        state.block.tools.set(name, (state.block.tools.get(name) ?? 0) + 1)
      }
    }
    const messageId = str(entry.message.id)
    if (messageId !== undefined && !seenMessages.has(messageId)) {
      seenMessages.add(messageId)
      const usage = readUsage(entry.message.usage)
      mainUsage = add(mainUsage, usage)
      if (state.turn !== null) state.turn.usage = add(state.turn.usage, usage)
      state.block ??= { start: at, end: at, tools: new Map(), usage: zero() }
      state.block.usage = add(state.block.usage, usage)
    }
    if (state.block !== null) state.block.end = at
  }
  flush()
  closeTurn()

  // Agent の呼び出しに結び付かないサブエージェント（context: fork のスキル、Mod が立てたもの）は、始まった時刻で別に並べる
  const unlinked = subagents.filter(agent => !nested.has(agent.id) && (agent.toolUseId === undefined || !toolStart.has(agent.toolUseId)))

  if (process.argv.includes('--json')) {
    const counts = (map: Map<string, { count: number; ms: number }>) => [...map].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.ms - a.ms)
    const json = {
      sessionId,
      activeMs,
      mainUsage,
      turns,
      skills,
      subagents: subagents.map(({ label: _, ...agent }) => ({ ...agent, nested: nested.has(agent.id) })),
      tools: counts(toolTotals),
      bash: counts(bashTotals),
    }
    console.log(JSON.stringify(json, null, 2))
    return
  }

  console.log(`# ${sessionId}\n`)
  console.log('## 時系列（「作業」は区切りの間のツールの回数。裏はバックグラウンドのサブエージェントで、本体の時間と重なる）\n')
  for (const line of lines) console.log(line)
  if (unlinked.length > 0) {
    console.log('\n## Agent の呼び出しに結び付かないサブエージェント（forkのスキル、Modが立てたもの）\n')
    for (const agent of unlinked.sort((a, b) => a.start - b.start)) {
      console.log(`${clock(agent.start)}  ${agent.label}  ${duration(agent.end - agent.start)}  ${usageText(agent.usage)}`)
      for (const line of childLines(agent, 0)) console.log(line)
    }
  }

  console.log('\n## まとめ\n')
  console.log(`本体: 動いていた時間 ${duration(activeMs)}（ターンの始まりから最後の応答まで、の合計）  ${usageText(mainUsage)}`)
  const byType = new Map<string, { count: number; ms: number; usage: Usage }>()
  for (const agent of subagents) {
    const type = agent.skill === undefined ? agent.type : `${agent.type}（スキル ${agent.skill}）`
    const key = nested.has(agent.id) ? `${type}（入れ子）` : type
    const total = byType.get(key) ?? { count: 0, ms: 0, usage: zero() }
    byType.set(key, { count: total.count + 1, ms: total.ms + (agent.end - agent.start), usage: add(total.usage, agent.usage) })
  }
  console.log('\nサブエージェント（種類ごと。時間は各自の始まりから終わりまでの合計）')
  for (const [type, t] of [...byType].sort((a, b) => b[1].ms - a[1].ms)) console.log(`  ${type.padEnd(28)} ${String(t.count).padStart(3)}回  ${duration(t.ms).padStart(7)}  ${usageText(t.usage)}`)
  console.log('\nスキル')
  for (const [skill, n] of [...skillCount].sort((a, b) => b[1] - a[1])) console.log(`  ${skill.padEnd(28)} ${String(n).padStart(3)}回`)
  console.log('\n本体のツール（時間は呼び出しから結果までの合計）')
  for (const [name, t] of [...toolTotals].sort((a, b) => b[1].ms - a[1].ms).slice(0, 15)) console.log(`  ${name.padEnd(28)} ${String(t.count).padStart(4)}回  ${duration(t.ms).padStart(7)}`)
  console.log('\n本体の Bash（最初の 2 語ごと。時間の長い順）')
  for (const [key, t] of [...bashTotals].sort((a, b) => b[1].ms - a[1].ms).slice(0, 15)) console.log(`  ${key.padEnd(28)} ${String(t.count).padStart(4)}回  ${duration(t.ms).padStart(7)}`)
}

if (import.meta.main) main()
