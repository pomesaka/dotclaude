// 会話の記録から、スキル、コマンド、エージェント、ルール、docs の文書が、いくつのセッションで使われたかを数える。
// 使っていないものを消す候補を出すためのもの。消すかは curate-docs で利用者が決める。
//
//   bun usage.ts [--days 60] [--exclude-session <いまのセッションのID>]
//
// 数えるもの（1 セッションで何度使っても 1 と数える）:
//   スキル      Skill の道具の呼び出しと、利用者が打った /<名前>
//   コマンド    利用者が打った /<名前>
//   エージェント Agent の道具の subagent_type
//   ルール      記録に rules/<名前>.md が読み込まれた跡（paths に合うファイルを触ると読まれる）
//   docs       Read の道具で docs/<名前>.md を読んだ呼び出しと、その文書を埋め込んでいるスキルを使ったこと。
//              CLAUDE.md が @ で読む文書は毎回読まれ、codex.md は Codex が読むので、0 でも使われている
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export type Kind = 'skill' | 'command' | 'agent' | 'rule' | 'doc'
export type Signal = { kind: Kind; name: string }

const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined)

const parse = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

const toolUses = (record: unknown): { name: string; input: unknown }[] => {
  const content = field(field(record, 'message'), 'content')
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown) => {
    const name = field(block, 'name')
    return field(block, 'type') === 'tool_use' && typeof name === 'string' ? [{ name, input: field(block, 'input') }] : []
  })
}

// 記録の 1 行から、使った跡を取り出す。スキルとコマンドは同じ /<名前> の形なので、どちらかは呼び出し側で決める
export const signalsOf = (line: string): Signal[] => {
  const signals: Signal[] = []
  for (const match of line.matchAll(/<command-name>\/([A-Za-z0-9:_-]+)<\/command-name>/g)) signals.push({ kind: 'command', name: match[1] ?? '' })
  for (const match of line.matchAll(/\/rules\/([A-Za-z0-9_-]+)\.md/g)) signals.push({ kind: 'rule', name: match[1] ?? '' })
  if (!line.includes('"tool_use"')) return signals
  for (const use of toolUses(parse(line))) {
    const skill = field(use.input, 'skill')
    if (use.name === 'Skill' && typeof skill === 'string') signals.push({ kind: 'skill', name: skill })
    const agent = field(use.input, 'subagent_type')
    if (use.name === 'Agent' && typeof agent === 'string') signals.push({ kind: 'agent', name: agent })
    const path = field(use.input, 'file_path')
    const doc = typeof path === 'string' ? /\/docs\/([A-Za-z0-9_-]+)\.md$/.exec(path)?.[1] : undefined
    if (use.name === 'Read' && doc !== undefined) signals.push({ kind: 'doc', name: doc })
    // WHY SKILL.md を読んだのも数える: ほかのスキル（meeting から xwb など）とサブエージェントは、スキルを Read で読んで従う
    const skillFile = typeof path === 'string' ? /\/skills\/([A-Za-z0-9_-]+)\/SKILL\.md$/.exec(path)?.[1] : undefined
    if (use.name === 'Read' && skillFile !== undefined) signals.push({ kind: 'skill', name: skillFile })
  }
  return signals
}

const jsonlFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.name.endsWith('.jsonl') ? [path] : []
  })

const names = (dir: string, isDirectory: boolean): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter(entry => (isDirectory ? entry.isDirectory() : entry.name.endsWith('.md')))
    .map(entry => entry.name.replace(/\.md$/, ''))

const main = (args: readonly string[]): void => {
  const at = args.indexOf('--days')
  const days = at === -1 ? 60 : Number(args[at + 1]) || 60
  // WHY 外せるようにする: 棚卸しをしているセッション自身が、スキルや文書を読んで回るので、使ったように数えられる
  const excludeAt = args.indexOf('--exclude-session')
  const excluded = excludeAt === -1 ? undefined : args[excludeAt + 1]
  const since = Date.now() - days * 86_400_000
  // リポジトリの直下。このファイルは skills/curate-docs/ にある
  const root = dirname(dirname(dirname(realpathSync(import.meta.path))))
  const owned: Record<Kind, string[]> = {
    skill: names(join(root, 'skills'), true),
    command: names(join(root, 'commands'), false),
    agent: names(join(root, 'agents'), false),
    rule: names(join(root, 'rules'), false),
    doc: names(join(root, 'docs'), false),
  }
  // スキルが本文に !`cat ~/.claude/docs/<名前>.md` で埋め込んでいる文書。スキルを使えば、Read を通らずに読まれる
  const embedded = new Map(
    owned.skill.map(skill => {
      const path = join(root, 'skills', skill, 'SKILL.md')
      const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
      return [skill, [...text.matchAll(/!`cat ~\/\.claude\/docs\/([A-Za-z0-9_-]+)\.md/g)].map(match => match[1] ?? '')]
    }),
  )
  // 種類と名前ごとに、使ったセッションと、最後に使った日
  const used = new Map<string, { sessions: Set<string>; last: number }>()
  const files = jsonlFiles(join(homedir(), '.claude', 'projects')).filter(path => statSync(path).mtimeMs >= since)
  for (const path of files) {
    const mtime = statSync(path).mtimeMs
    // サブエージェントの記録は、親のセッションの中の 1 つとして数える
    const session = path.includes('/subagents/') ? basename(dirname(dirname(path))) : basename(path, '.jsonl')
    if (session === excluded) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      for (const signal of signalsOf(line)) {
        // 利用者が打った /<名前> は、スキルにあればスキルとして数える
        const kind: Kind = signal.kind === 'command' && owned.skill.includes(signal.name) ? 'skill' : signal.kind
        const docs = kind === 'skill' ? (embedded.get(signal.name) ?? []).map(name => ({ kind: 'doc' as const, name })) : []
        for (const one of [{ kind, name: signal.name }, ...docs]) {
          const key = `${one.kind}\u0000${one.name}`
          const counted = used.get(key) ?? { sessions: new Set(), last: 0 }
          counted.sessions.add(session)
          counted.last = Math.max(counted.last, mtime)
          used.set(key, counted)
        }
      }
    }
  }
  console.log(`# 使われた回数（直近 ${days} 日、${files.length} 個の記録。数はセッションの数）\n`)
  for (const kind of ['skill', 'command', 'agent', 'rule', 'doc'] satisfies Kind[]) {
    const rows = owned[kind]
      .map(name => ({ name, use: used.get(`${kind}\u0000${name}`) }))
      .sort((a, b) => (a.use?.sessions.size ?? 0) - (b.use?.sessions.size ?? 0) || a.name.localeCompare(b.name))
    console.log(`## ${kind}`)
    for (const row of rows) {
      const last = row.use === undefined ? '-' : new Date(row.use.last).toISOString().slice(0, 10)
      console.log(`- ${row.name}: ${row.use?.sessions.size ?? 0}（最後 ${last}）`)
    }
    console.log('')
  }
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`数えるのに失敗: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
