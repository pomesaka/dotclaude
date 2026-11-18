// 変更した行を 1 か所ずつ壊し、テストが落ちるかを確かめる（mutation test）。言語を問わない粗い作りで、
// 文字の置き換えで壊し、渡されたテストのコマンドを走らせる。作業コピーは書き換えず、写しの上で壊す。
//
//   bun mutate.ts --test "<テストのコマンド>" [--since <リビジョン>] [--files <正規表現>] [--max 60] [--budget 600]
//                 [--timeout 120] [--per-line 1] [--only <鍵>]... [--json] [--keep]
//
// 終了コード: 0 生き残りなし、1 生き残りあり、2 引数の誤り、4 壊す前のテストが落ちる
//
// WHY 文字の置き換え: 使う側のプロジェクトは TypeScript、Go、Scala にまたがる。2026-11-18 に xwb のレビューで手作りした
//   同じ作りのスクリプトが、テストの件数では見えない守られていない分岐と要らないコードを見つけた。
//   Vitest のプロジェクトでは mizchi/mutator のように AST で壊す道具のほうが速く正確なので、そちらを先に使う（SKILL.md）
// WHY 差分の行だけ: レビューの対象は変更で、ファイル全体を壊すと数が増えて読まれない。Google の実践も変更した行だけを壊し、
//   1 行に 1 つまでにしている（Petrović ほか「Practical Mutation Testing at Scale」2021）
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, relative } from 'node:path'

export type Mutant = { key: string; file: string; line: number; operator: string; original: string; mutated: string }
export type Status = 'killed' | 'survived' | 'timeout' | 'pending'
export type Result = Mutant & { status: Status }

const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.go', '.scala', '.java', '.kt', '.rs', '.py'])
// テストのファイルは壊さない。壊す対象は本体のコード
const TEST_FILE = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[a-z]+$|_test\.go$|Spec\.scala$|Test\.(java|kt|scala)$/

// 壊しても実りの無い行（Google の arid に当たるもの）。ログ、import、宣言だけの行、括弧だけの行、コメント
const ARID = [
  /^\s*$/,
  /^\s*(\/\/|\/\*|\*|#)/,
  /^\s*[{}()[\];,]*\s*$/,
  /^\s*(import|export\s+(type\s+)?\{|export\s+\*|package|from\s)/,
  /^\s*(export\s+)?(type|interface)\s/,
  /\b(console|logger|log|slog)\.\w+\(|\bfmt\.Print|\bprintln?\(|\bdebug\(/,
]

export const isArid = (text: string): boolean => ARID.some(pattern => pattern.test(text))

// unified diff から、ファイルごとに、足したか変えた行の番号（新しい側の 1 から数えた番号）を取り出す
export const changedLines = (diff: string): Map<string, number[]> => {
  const lines = new Map<string, number[]>()
  let file: string | null = null
  let next = 0
  for (const row of diff.split('\n')) {
    if (row.startsWith('+++ ')) {
      const path = row.slice(4).replace(/^b\//, '')
      file = path === '/dev/null' ? null : path
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row)
    if (hunk !== null) {
      next = Number(hunk[1])
      continue
    }
    if (file === null || next === 0 || row.startsWith('--- ') || row.startsWith('diff ')) continue
    if (row.startsWith('+')) {
      lines.set(file, [...(lines.get(file) ?? []), next])
      next += 1
    } else if (row.startsWith(' ')) {
      next += 1
    }
  }
  return lines
}

type Operator = { name: string; apply: (text: string, lang: string) => string | null }

// 文字列の中身を空白で伏せる。位置は変えない。
// WHY: 文字列の中の演算子（'==' という表のキーなど）を壊しても、コードの振る舞いを壊したことにならない
export const maskStrings = (text: string): string => text.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, quoted => `${quoted[0]}${' '.repeat(quoted.length - 2)}${quoted[0]}`)

const swapFirst = (text: string, pattern: RegExp, swap: Record<string, string>): string | null => {
  const match = pattern.exec(maskStrings(text))
  if (match === null) return null
  const to = swap[match[0].trim()]
  if (to === undefined) return null
  return `${text.slice(0, match.index)}${text.slice(match.index, match.index + match[0].length).replace(match[0].trim(), to)}${text.slice(match.index + match[0].length)}`
}

// 壊し方。並びは、実りの多い順（Google の報告では、関係演算子、論理演算子、文の削除が多く、算術と単項は少ない）
export const OPERATORS: Operator[] = [
  {
    name: 'relational',
    apply: text =>
      swapFirst(text, /(===|!==|==|!=|<=|>=)(?!=)|(?<=\s)[<>](?=\s)/, {
        '===': '!==',
        '!==': '===',
        '==': '!=',
        '!=': '==',
        '<=': '<',
        '>=': '>',
        '<': '<=',
        '>': '>=',
      }),
  },
  {
    name: 'logical',
    apply: (text, lang) => (lang === 'py' ? swapFirst(text, /\b(and|or)\b/, { and: 'or', or: 'and' }) : swapFirst(text, /&&|\|\|/, { '&&': '||', '||': '&&' })),
  },
  {
    name: 'negate-condition',
    apply: (text, lang) => {
      if (lang === 'go') {
        const go = /^(\s*(?:\}\s*else\s+)?if\s+)(.+?)(\s*\{\s*)$/.exec(text)
        return go === null ? null : `${go[1]}!(${go[2]})${go[3]}`
      }
      const c = /^(\s*(?:\}\s*else\s+)?(?:if|while)\s*\()(.*)(\)\s*\{?\s*)$/.exec(text)
      return c === null ? null : `${c[1]}!(${c[2]})${c[3]}`
    },
  },
  {
    name: 'remove-statement',
    apply: (text, lang) => {
      const body = text.trim()
      if (/^(const|let|var|val|def|func|fn|return|throw|case|default|else|class|if|for|while|switch|try|catch|finally)\b/.test(body)) return null
      if (/:=/.test(body)) return null
      // 呼び出しか代入の 1 文だけを消す
      if (!/^[\w$.[\]?!]+(\([^]*\)|\s*[-+*/]?=\s*[^=].*)\s*;?$/.test(body)) return null
      // WHY 空にせず印を置く: 行を消すと行番号がずれる。Python は /* */ が書けないので pass にする
      return `${text.slice(0, text.length - text.trimStart().length)}${lang === 'py' ? 'pass' : '/* mutation: removed */'}`
    },
  },
  { name: 'boolean', apply: text => swapFirst(text, /\b(true|false)\b/, { true: 'false', false: 'true' }) },
  { name: 'arithmetic', apply: text => swapFirst(text, /\s[-+*/]\s/, { '+': '-', '-': '+', '*': '/', '/': '*' }) },
  { name: 'number', apply: text => swapFirst(text, /(?<![\w.])[01](?![\w.])/, { '0': '1', '1': '0' }) },
]

const languageOf = (file: string): string => extname(file).slice(1)

// 1 行から、壊した行を作る。perLine 個まで、実りの多い壊し方から選ぶ
export const mutantsOf = (file: string, line: number, text: string, perLine: number): Mutant[] => {
  if (isArid(text)) return []
  const lang = languageOf(file)
  const mutants: Mutant[] = []
  for (const operator of OPERATORS) {
    if (mutants.length >= perLine) break
    const mutated = operator.apply(text, lang)
    if (mutated === null || mutated === text) continue
    mutants.push({ key: `${file}:${line}:${operator.name}`, file, line, operator: operator.name, original: text.trim(), mutated: mutated.trim() })
  }
  return mutants
}

export const isTarget = (file: string, only: RegExp | null): boolean => CODE.has(extname(file)) && !TEST_FILE.test(file) && (only === null || only.test(file))

const run = (argv: string[], cwd: string, timeoutMs?: number) => {
  const ran = Bun.spawnSync(argv, { cwd, timeout: timeoutMs, stdout: 'pipe', stderr: 'pipe' })
  return { code: ran.exitCode, out: `${ran.stdout.toString()}${ran.stderr.toString()}`, timedOut: ran.signalCode === 'SIGTERM' }
}

type Options = { test: string; since: string | null; files: RegExp | null; max: number; budget: number; timeout: number; perLine: number; only: string[]; json: boolean; keep: boolean }

const parseArgs = (args: readonly string[]): Options | string => {
  const value = (name: string): string | undefined => {
    const at = args.indexOf(name)
    return at === -1 ? undefined : args[at + 1]
  }
  const number = (name: string, fallback: number): number => {
    const raw = value(name)
    const parsed = raw === undefined ? fallback : Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  const test = value('--test')
  if (test === undefined) return '--test "<テストのコマンド>" が要る。例: --test "bun test test/model.test.ts"'
  const files = value('--files')
  return {
    test,
    since: value('--since') ?? null,
    files: files === undefined ? null : new RegExp(files),
    max: number('--max', 60),
    budget: number('--budget', 600),
    timeout: number('--timeout', 120),
    perLine: number('--per-line', 1),
    only: args.flatMap((arg, index) => (arg === '--only' ? [args[index + 1] ?? ''] : [])),
    json: args.includes('--json'),
    keep: args.includes('--keep'),
  }
}

// リポジトリの直下と、差分。jj のリポジトリ（claude-deck のワークスペースを含む）なら jj で、そうでなければ git で取る
const diffOf = (cwd: string, since: string | null): { root: string; diff: string } => {
  const jj = run(['jj', 'root'], cwd)
  if (jj.code === 0) {
    const root = jj.out.trim()
    return { root, diff: run(['jj', 'diff', '--git', '--from', since ?? 'trunk()', '--to', '@'], root).out }
  }
  const root = run(['git', 'rev-parse', '--show-toplevel'], cwd).out.trim()
  return { root, diff: run(['git', 'diff', since ?? 'HEAD'], root).out }
}

// リポジトリを写す。依存（node_modules）は写さずにリンクする。.git と .jj は写さない
const copyRepo = (root: string): string => {
  const copy = mkdtempSync(join(tmpdir(), 'mutate-'))
  const synced = run(['rsync', '-a', '--exclude', '.git', '--exclude', '.jj', '--exclude', 'node_modules', `${root}/`, `${copy}/`], root)
  if (synced.code !== 0) throw new Error(`rsync failed: ${synced.out}`)
  const found = run(['fd', '--hidden', '--no-ignore', '--type', 'd', '--max-depth', '4', '--prune', '^node_modules$', '.'], root)
  for (const dir of found.out.split('\n').filter(line => line !== '')) symlinkSync(join(root, dir), join(copy, dir.replace(/\/$/, '')))
  return copy
}

const main = (args: readonly string[]): number => {
  const options = parseArgs(args)
  if (typeof options === 'string') {
    console.error(options)
    return 2
  }
  const started = Date.now()
  const { root, diff } = diffOf(process.cwd(), options.since)
  const all = [...changedLines(diff)]
    .filter(([file]) => isTarget(file, options.files))
    .flatMap(([file, lines]) => {
      const text = readFileSync(join(root, file), 'utf8').split('\n')
      return lines.flatMap(line => mutantsOf(file, line, text[line - 1] ?? '', options.perLine))
    })
    .filter(mutant => options.only.length === 0 || options.only.includes(mutant.key))
  const mutants = all.slice(0, options.max)
  if (mutants.length === 0) {
    console.error('壊す行がありません（差分にコードの行が無いか、全部がログや宣言の行）')
    return 0
  }
  const copy = copyRepo(root)
  // テストのコマンドは、呼んだ場所と同じ相対位置で走らせる
  const cwd = join(copy, relative(root, process.cwd()))
  const runTest = () => run(['sh', '-c', options.test], cwd, options.timeout * 1000)
  try {
    const baseline = runTest()
    if (baseline.code !== 0) {
      console.error(`壊す前のテストが落ちています。先に通してから走らせる:\n${baseline.out.slice(-3000)}`)
      return 4
    }
    const results: Result[] = []
    for (const mutant of mutants) {
      if (Date.now() - started > options.budget * 1000) {
        results.push({ ...mutant, status: 'pending' })
        continue
      }
      const path = join(copy, mutant.file)
      const original = readFileSync(path, 'utf8')
      const lines = original.split('\n')
      const at = lines[mutant.line - 1] ?? ''
      lines[mutant.line - 1] = at.replace(at.trim(), mutant.mutated)
      writeFileSync(path, lines.join('\n'))
      const ran = runTest()
      writeFileSync(path, original)
      results.push({ ...mutant, status: ran.timedOut ? 'timeout' : ran.code === 0 ? 'survived' : 'killed' })
    }
    report(results, all.length, options.json)
    return results.some(result => result.status === 'survived') ? 1 : 0
  } finally {
    if (options.keep) console.error(`写し: ${copy}`)
    else rmSync(copy, { recursive: true, force: true })
  }
}

const report = (results: readonly Result[], total: number, json: boolean): void => {
  const count = (status: Status) => results.filter(result => result.status === status).length
  if (json) {
    console.log(JSON.stringify(results.filter(result => result.status === 'survived' || result.status === 'pending'), null, 2))
  } else {
    for (const result of results.filter(one => one.status === 'survived')) {
      console.log(`- ${result.key}\n    ${result.original}\n  → ${result.mutated}`)
    }
  }
  const capped = total > results.length ? `（候補 ${total} のうち上限の ${results.length} まで）` : ''
  console.error(`壊した ${results.length}${capped}: 落ちた ${count('killed')}、生き残った ${count('survived')}、時間切れ ${count('timeout')}、未実行 ${count('pending')}`)
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(`mutate.ts が失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
}
