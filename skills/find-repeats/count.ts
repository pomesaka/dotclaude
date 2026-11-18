// 会話の記録から、セッションをまたいで繰り返している道具の呼び出しの並びを数える。
//
// スクリプトや hook にできる手順の候補を出すためのもの。どれを仕組みにするかは、
// 振り返り（/re）で人とエージェントが決める。このスクリプトは数えるだけで、判断しない。
//
//   bun count.ts [--days 30] [--min-sessions 3] [--top 30] [--max-len 4]
//
// 出力は、並びの長さが長い順、同じ長さの中ではセッション数の多い順。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const PROJECTS = join(homedir(), '.claude', 'projects')

// サブコマンドまでを 1 手として数える道具。ほかの道具はコマンド名だけで数える
const SUBCOMMAND_TOOLS = new Set(['jj', 'git', 'gh', 'xwb', 'cf', 'npm', 'bun', 'pnpm', 'cargo', 'mise', 'docker', 'podman', 'kubectl', 'aws', 'gcloud', 'claude-deck', 'difit', 'portless', 'uv'])

// 調べ物と読み書きの道具は、判断の途中の手なので数えない。数えると上位がこれで埋まる
const NOISE = new Set(['cd', 'echo', 'true', 'sleep', 'ls', 'cat', 'pwd', 'rg', 'grep', 'sed', 'awk', 'fd', 'find', 'head', 'tail', 'wc', 'jq', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp', 'stat', 'file', 'which', 'command', 'date', 'mkdir', 'cp', 'mv', 'rm', 'touch', 'chmod', 'test'])

const INTERPRETERS = new Set(['python3', 'python', 'node', 'bun', 'sh', 'bash', 'zsh'])
const SUBCOMMAND = /^[a-z][a-z0-9-]*$/
const COMMAND_SEPARATOR = /\s*(?:&&|\|\||;|\|)\s*/

// シェルの語に分ける。引用符は外す。閉じていない引用符があれば、空白で切るだけにする（語の切れ目だけ分かればよい）
export const shellWords = (text: string): string[] => {
  const words: string[] = []
  let word = ''
  let quote: string | null = null
  let isInWord = false
  for (const char of text) {
    if (quote !== null) {
      if (char === quote) quote = null
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      isInWord = true
    } else if (/\s/.test(char)) {
      if (isInWord) words.push(word)
      word = ''
      isInWord = false
    } else {
      word += char
      isInWord = true
    }
  }
  if (quote !== null) return text.split(/\s+/).filter(one => one !== '')
  if (isInWord) words.push(word)
  return words
}

// 複合コマンドの最初の 1 つを語に分け、先頭の環境変数の代入を除く
export const splitWords = (command: string): string[] => {
  const first = command.trim().split(COMMAND_SEPARATOR)[0] ?? ''
  const words = shellWords(first)
  while (words.length > 0 && (words[0] ?? '').includes('=') && !(words[0] ?? '').startsWith('-')) words.shift()
  return words
}

// Bash の 1 呼び出しを、値を落とした 1 語の「手」にする。数えない手は null
export const normalizeBash = (command: string): string | null => {
  const [head, ...args] = splitWords(command)
  if (head === undefined) return null
  const name = basename(head)
  if (NOISE.has(name)) return null
  if (INTERPRETERS.has(name)) {
    // -c、-e やヒアドキュメントの使い捨てのコードは、その場の判断なので数えない
    if (args.includes('-c') || args.includes('-e') || args.some(arg => arg.startsWith('<'))) return null
    const script = args.find(arg => !arg.startsWith('-'))
    if (script === undefined) return null
    // bun のサブコマンド（bun test、bun install）は、スクリプトでなくサブコマンドとして数える
    if (name === 'bun' && SUBCOMMAND.test(script)) return `bun ${script}`
    return `${name} ${basename(script)}`
  }
  if (SUBCOMMAND_TOOLS.has(name)) {
    const sub = args.find(arg => !arg.startsWith('-'))
    if (sub !== undefined && SUBCOMMAND.test(sub)) return `${name} ${sub}`
  }
  return name
}

const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined)

// 道具の呼び出しを 1 手にする。数えない手は null
export const normalize = (tool: string, input: unknown): string | null => {
  if (tool === 'Bash') {
    const command = field(input, 'command')
    const step = normalizeBash(typeof command === 'string' ? command : '')
    return step === null ? null : `Bash:${step}`
  }
  // ファイルを読む・直すのは判断の一部なので数えない
  if (['Read', 'Edit', 'Write', 'Grep', 'Glob'].includes(tool)) return null
  if (tool === 'Skill') {
    const skill = field(input, 'skill')
    return `Skill:${typeof skill === 'string' ? skill : ''}`
  }
  return tool
}

const parse = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

// 記録の 1 行から、メインの会話の道具の呼び出しを取り出す
export const toolUses = (line: string): { name: string; input: unknown }[] => {
  if (!line.includes('"tool_use"')) return []
  const record = parse(line)
  // サブエージェントの呼び出しは、その中の判断なので数えない
  if (field(record, 'isSidechain') === true) return []
  const content = field(field(record, 'message'), 'content')
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown) => {
    if (field(block, 'type') !== 'tool_use') return []
    const name = field(block, 'name')
    return [{ name: typeof name === 'string' ? name : '', input: field(block, 'input') ?? {} }]
  })
}

// 1 つの記録を、手の並びにする。同じ手が続くのは 1 手にまとめる（ポーリングの繰り返しを数えない）
export const stepsOf = (text: string): string[] => {
  const steps: string[] = []
  for (const line of text.split('\n')) {
    for (const use of toolUses(line)) {
      const step = normalize(use.name, use.input)
      if (step !== null && steps.at(-1) !== step) steps.push(step)
    }
  }
  return steps
}

const contains = (longer: readonly string[], shorter: readonly string[]): boolean => {
  for (let start = 0; start + shorter.length <= longer.length; start += 1) {
    if (shorter.every((step, offset) => longer[start + offset] === step)) return true
  }
  return false
}

type Counted = { gram: string[]; occurrences: number; sessions: Set<string>; projects: Set<string> }

// 記録ごとの手の並びから、並び（長さ 2 から maxLen）を数え、出す候補を選ぶ
export const countRepeats = (sessions: readonly { path: string; project: string; steps: string[] }[], options: { minSessions: number; top: number; maxLen: number }): Counted[] => {
  const counted = new Map<string, Counted>()
  for (const session of sessions) {
    for (let length = 2; length <= options.maxLen; length += 1) {
      for (let start = 0; start + length <= session.steps.length; start += 1) {
        const gram = session.steps.slice(start, start + length)
        // 1 種類の手だけの並びは、手順ではない
        if (new Set(gram).size < 2) continue
        const key = gram.join('\u0000')
        const one = counted.get(key) ?? { gram, occurrences: 0, sessions: new Set(), projects: new Set() }
        one.occurrences += 1
        one.sessions.add(session.path)
        one.projects.add(session.project)
        counted.set(key, one)
      }
    }
  }
  const candidates = [...counted.values()]
    .filter(one => one.sessions.size >= options.minSessions)
    .sort((a, b) => b.gram.length - a.gram.length || b.sessions.size - a.sessions.size || b.occurrences - a.occurrences)
  // 長い並びに含まれる短い並びは、回数が増えないなら出さない（長い方が手順をよく表す）
  const shown: Counted[] = []
  for (const one of candidates) {
    if (shown.some(longer => contains(longer.gram, one.gram) && longer.occurrences >= one.occurrences)) continue
    shown.push(one)
    if (shown.length >= options.top) break
  }
  return shown
}

const option = (args: readonly string[], name: string, fallback: number): number => {
  const at = args.indexOf(name)
  const value = at === -1 ? undefined : Number(args[at + 1])
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback
}

const main = (args: readonly string[]): void => {
  const days = option(args, '--days', 30)
  const since = Date.now() - days * 86_400_000
  const sessions = readdirSync(PROJECTS).flatMap(project =>
    readdirSync(join(PROJECTS, project))
      .filter(name => name.endsWith('.jsonl'))
      .map(name => join(PROJECTS, project, name))
      .filter(path => statSync(path).mtimeMs >= since)
      .map(path => ({ path, project, steps: stepsOf(readFileSync(path, 'utf8')) }))
      .filter(session => session.steps.length > 0),
  )
  const shown = countRepeats(sessions, { minSessions: option(args, '--min-sessions', 3), top: option(args, '--top', 30), maxLen: option(args, '--max-len', 4) })
  console.log(`# 繰り返している手順の候補（直近 ${days} 日、${sessions.length} セッション）\n`)
  console.log('| 回数 | セッション数 | プロジェクト数 | 並び |')
  console.log('|---:|---:|---:|---|')
  for (const one of shown) console.log(`| ${one.occurrences} | ${one.sessions.size} | ${one.projects.size} | ${one.gram.join(' → ')} |`)
}

if (import.meta.main) {
  // WHY 失敗しても exit 0: スキルの読み込み時に走る。0 以外で終わるとスキルの呼び出しごと止まり、
  // 何が起きたかがモデルに届かない。失敗は「数えるのに失敗」で始まる行で知らせる
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.log(`数えるのに失敗: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
  }
}
