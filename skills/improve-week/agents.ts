// 会話の記録から、Agent の呼び出しを subagent_type ごとに数え、general-purpose（型の指定なしを含む）への依頼を書き出す。
// スキルやエージェントに切り出せる仕事を探す材料にする。どれを切り出すかは、読んだエージェントが決める。
//
//   bun agents.ts [--days 14] <書き出し先.tsv>
//
// 標準出力は、型ごとの件数（多い順）。TSV は、日付、プロジェクト、description、prompt の頭 160 文字
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECTS = join(homedir(), '.claude', 'projects')
// 型の指定が無い呼び出しは general-purpose で動く
export type AgentCall = { date: string; type: string | undefined; description: string; prompt: string }

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const oneLine = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

// 記録の 1 行から、Agent の呼び出しを取り出す。JSON でない行と、Agent の無い行は空
export const callsOf = (line: string): AgentCall[] => {
  if (!line.includes('"Agent"')) return []
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return []
  }
  const content = field(field(record, 'message'), 'content')
  if (!Array.isArray(content)) return []
  const date = oneLine(field(record, 'timestamp')).slice(0, 10)
  return content.flatMap(part => {
    if (field(part, 'type') !== 'tool_use' || field(part, 'name') !== 'Agent') return []
    const input = field(part, 'input')
    const type = oneLine(field(input, 'subagent_type'))
    return [{ date, type: type === '' ? undefined : type, description: oneLine(field(input, 'description')), prompt: oneLine(field(input, 'prompt')).slice(0, 160) }]
  })
}

// 型ごとの件数。指定の無い呼び出しは「(なし)」として数える
export const countByType = (calls: AgentCall[]): [string, number][] => {
  const counts = new Map<string, number>()
  for (const call of calls) {
    const type = call.type ?? '(なし)'
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export const isGeneral = (call: AgentCall): boolean => call.type === undefined || call.type === 'general-purpose'

// 記録のファイルは、更新された時刻で選ぶ。長く続いたセッションのファイルには古い呼び出しも入るので、呼び出しの日付でもう一度絞る
export const isSince = (call: AgentCall, since: string): boolean => call.date >= since

const transcripts = (dir: string, since: number): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) return transcripts(path, since)
    return name.endsWith('.jsonl') && stat.mtimeMs >= since ? [path] : []
  })

const main = (args: string[]): void => {
  const daysAt = args.indexOf('--days')
  const days = daysAt === -1 ? 14 : Number(args[daysAt + 1])
  const out = args.filter((_, i) => i !== daysAt && i !== daysAt + 1)[0]
  if (out === undefined || !Number.isFinite(days)) {
    console.error('使い方: bun agents.ts [--days 14] <書き出し先.tsv>')
    process.exit(2)
  }
  const sinceMs = Date.now() - days * 86_400_000
  const since = new Date(sinceMs).toISOString().slice(0, 10)
  const files = transcripts(PROJECTS, sinceMs)
  const rows: string[] = []
  const calls: AgentCall[] = []
  for (const file of files) {
    const project = file.slice(PROJECTS.length + 1).split('/')[0] ?? ''
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      for (const call of callsOf(line).filter(one => isSince(one, since))) {
        calls.push(call)
        if (isGeneral(call)) rows.push([call.date, project.slice(-40), call.description, call.prompt].join('\t'))
      }
    }
  }
  writeFileSync(out, `${rows.join('\n')}\n`)
  console.log(`記録 ${files.length} 件、general-purpose への依頼 ${rows.length} 件 → ${out}`)
  for (const [type, count] of countByType(calls)) console.log(`${count}\t${type}`)
}

if (import.meta.main) main(process.argv.slice(2))
