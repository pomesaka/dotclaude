// 変更した行を 1 か所ずつ壊し、テストが落ちるかを確かめる（mutation test）。言語を問わない粗い作りで、
// 文字の置き換えで壊し、渡されたテストのコマンドを走らせる。作業コピーは書き換えず、写しの上で壊す。
//
//   bun mutate.ts --test "<テストのコマンド>" [-r <revset> | -f <rev> [-t <rev>] | --line <ファイル:行[-行]>...]
//                 [--files <正規表現>] [--max 60] [--budget 100] [--timeout 120] [--per-line 1] [--only <鍵>]...
//                 [--json] [--keep]
//
// 壊す行の選び方は jj diff と同じ引数で決める。何も付けなければ jj diff と同じ -r @（作業コピーの変更）。
// --line で行を直に指すと、差分を読まない。差分の行も、内部では同じ「ファイルと行」の並びにしてから壊す
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

// 壊す行。差分から取っても、--line で指しても、この形にそろえてから壊す
export type Target = { file: string; line: number }

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

export const targetsOfDiff = (diff: string): Target[] => [...changedLines(diff)].flatMap(([file, lines]) => lines.map(line => ({ file, line })))

// `src/a.ts:12` か `src/a.ts:12-20`。読めなければ null
export const parseLine = (spec: string): Target[] | null => {
  const match = /^(.+):(\d+)(?:-(\d+))?$/.exec(spec)
  if (match === null) return null
  const from = Number(match[2])
  const to = match[3] === undefined ? from : Number(match[3])
  if (from < 1 || to < from) return null
  return Array.from({ length: to - from + 1 }, (_, index) => ({ file: match[1] ?? '', line: from + index }))
}

// 差分の取り方。jj diff の -r、-f（--from）、-t（--to）と同じ意味
export type Range = { revisions: string | null; from: string | null; to: string | null }

export type Options = {
  test: string
  range: Range
  lines: Target[] | null
  files: RegExp | null
  max: number
  budget: number
  timeout: number
  perLine: number
  only: string[]
  json: boolean
  keep: boolean
}

export const parseArgs = (args: readonly string[]): Options | string => {
  const value = (...names: string[]): string | undefined => {
    const at = args.findIndex(arg => names.includes(arg))
    return at === -1 ? undefined : args[at + 1]
  }
  const all = (name: string): string[] => args.flatMap((arg, index) => (arg === name ? [args[index + 1] ?? ''] : []))
  if (args.includes('--since')) return '--since は無くなった。jj diff と同じく -r <revset>、-f <rev>、-t <rev> で指す（例: -r @、-f @-、-r "trunk()..@"）'
  const number = (name: string, fallback: number): number => {
    const raw = value(name)
    const parsed = raw === undefined ? fallback : Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  const test = value('--test')
  if (test === undefined) return '--test "<テストのコマンド>" が要る。例: --test "bun test test/model.test.ts"'
  const range: Range = { revisions: value('-r', '--revisions') ?? null, from: value('-f', '--from') ?? null, to: value('-t', '--to') ?? null }
  if (range.revisions !== null && (range.from !== null || range.to !== null)) return '-r と -f、-t は一緒に使えない（jj diff と同じ）'
  const specs = all('--line')
  const parsed = specs.map(spec => ({ spec, targets: parseLine(spec) }))
  const bad = parsed.find(one => one.targets === null)
  if (bad !== undefined) return `--line は <ファイル>:<行> か <ファイル>:<行>-<行> で書く: ${bad.spec}`
  if (specs.length > 0 && (range.revisions !== null || range.from !== null || range.to !== null)) return '--line を使うときは差分を読まないので、-r、-f、-t は付けない'
  const files = value('--files')
  return {
    test,
    range,
    lines: specs.length === 0 ? null : parsed.flatMap(one => one.targets ?? []),
    files: files === undefined ? null : new RegExp(files),
    max: number('--max', 60),
    budget: number('--budget', 100),
    timeout: number('--timeout', 120),
    perLine: number('--per-line', 1),
    only: all('--only'),
    json: args.includes('--json'),
    keep: args.includes('--keep'),
  }
}

// 壊す行の並びから、壊した行の並びを作る。ファイルは 1 回だけ読む
export const mutantsOfTargets = (
  targets: readonly Target[],
  read: (file: string) => string,
  options: Pick<Options, 'files' | 'perLine' | 'only'>,
): Mutant[] => {
  const texts = new Map<string, string[]>()
  const textOf = (file: string): string[] => {
    const cached = texts.get(file)
    if (cached !== undefined) return cached
    const lines = read(file).split('\n')
    texts.set(file, lines)
    return lines
  }
  return targets
    .filter(target => isTarget(target.file, options.files))
    .flatMap(target => mutantsOf(target.file, target.line, textOf(target.file)[target.line - 1] ?? '', options.perLine))
    .filter(mutant => options.only.length === 0 || options.only.includes(mutant.key))
}

// jj diff に渡す引数。何も指さなければ jj diff の既定（-r @）に任せる
export const jjDiffArgs = (range: Range): string[] => [
  'diff',
  '--git',
  ...(range.revisions === null ? [] : ['-r', range.revisions]),
  ...(range.from === null ? [] : ['--from', range.from]),
  ...(range.to === null ? [] : ['--to', range.to]),
]

// 差分の新しい側のリビジョン。壊すのは作業コピーのファイルなので、これが @ でなければ行の番号がずれうる
export const newSideOf = (range: Range): string => (range.revisions !== null ? `heads(${range.revisions})` : (range.to ?? '@'))

type Repo = { root: string; vcs: 'jj' | 'git' }

// jj のリポジトリ（claude-deck のワークスペースを含む）なら jj で、そうでなければ git で読む
const repoOf = (cwd: string): Repo => {
  const jj = run(['jj', 'root'], cwd)
  if (jj.code === 0) return { root: jj.out.trim(), vcs: 'jj' }
  return { root: run(['git', 'rev-parse', '--show-toplevel'], cwd).out.trim(), vcs: 'git' }
}

// 差分から壊す行を取る。読めないときは理由を返す
const targetsOfRange = (repo: Repo, range: Range): Target[] | string => {
  if (repo.vcs === 'git') {
    if (range.revisions !== null || range.to !== null) return 'git のリポジトリでは -f（比べる元）だけが使える'
    return targetsOfDiff(run(['git', 'diff', range.from ?? 'HEAD'], repo.root).out)
  }
  const diff = run(['jj', ...jjDiffArgs(range)], repo.root)
  if (diff.code !== 0) return `jj diff が失敗した: ${diff.out.trim()}`
  const targets = targetsOfDiff(diff.out)
  const newSide = newSideOf(range)
  if (newSide === '@') return targets
  // WHY: 差分の行番号は新しい側のもので、壊すのは作業コピー。その間で変わったファイルは、別の行を壊してしまう
  const drifted = run(['jj', 'diff', '--name-only', '--from', newSide, '--to', '@'], repo.root).out.split('\n')
  const misaligned = [...new Set(targets.map(target => target.file))].filter(file => isTarget(file, null) && drifted.includes(file))
  if (misaligned.length > 0) return `差分の新しい側（${newSide}）と作業コピーで中身が違うので、行がずれる: ${misaligned.join(', ')}。@ を含む範囲を指す（例: -r "trunk()..@"）`
  return targets
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

// 壊した後のテストの結果から状態を決める。全体の上限で切られたものは、時間切れでなく未実行にする
export const statusOf = (ran: { code: number | null; timedOut: boolean; cutByBudget: boolean } | null): Status => {
  if (ran === null || ran.cutByBudget) return 'pending'
  if (ran.timedOut) return 'timeout'
  return ran.code === 0 ? 'survived' : 'killed'
}

const describeRange =(range: Range): string => {
  const parts = [range.revisions === null ? null : `-r ${range.revisions}`, range.from === null ? null : `-f ${range.from}`, range.to === null ? null : `-t ${range.to}`].filter(part => part !== null)
  return parts.length === 0 ? '-r @（既定）' : parts.join(' ')
}

// 壊す所が無かったときの知らせ。差分が空なのか、行はあったが壊せる行が無いのかを分けて、次に打つものを書く
export const nothingToMutate = (options: Pick<Options, 'range' | 'lines' | 'files' | 'only'>, targets: number): string => {
  if (targets === 0 && options.lines === null) {
    return `差分が空です（${describeRange(options.range)}）。変更をコミットした後なら、-r "trunk()..@" のように自分の変更を含む範囲を指す`
  }
  const narrowed = [options.files === null ? null : `--files ${options.files.source}`, options.only.length === 0 ? null : `--only ${options.only.join(' ')}`].filter(part => part !== null)
  const by = narrowed.length === 0 ? '' : `。絞り込み（${narrowed.join('、')}）も見直す`
  return `${targets} 行のうち、壊せる行がありません（テストのファイル、コードでないファイル、ログ、import、宣言、括弧だけの行は壊さない）${by}`
}

const main = (args: readonly string[]): number => {
  const options = parseArgs(args)
  if (typeof options === 'string') {
    console.error(options)
    return 2
  }
  const started = Date.now()
  const repo = repoOf(process.cwd())
  const root = repo.root
  // --line のパスは呼んだ場所から読み、鍵はリポジトリの直下からのパスにそろえる
  const here = relative(root, process.cwd())
  const targets = options.lines === null ? targetsOfRange(repo, options.range) : options.lines.map(target => ({ ...target, file: join(here, target.file) }))
  if (typeof targets === 'string') {
    console.error(targets)
    return 2
  }
  const all = mutantsOfTargets(targets, file => readFileSync(join(root, file), 'utf8'), options)
  const mutants = all.slice(0, options.max)
  if (mutants.length === 0) {
    console.error(nothingToMutate(options, targets.length))
    return 0
  }
  const copy = copyRepo(root)
  // テストのコマンドは、呼んだ場所と同じ相対位置で走らせる
  const cwd = join(copy, relative(root, process.cwd()))
  // WHY 残り時間で切る: 1 か所の上限だけで切ると、最後の 1 か所が --budget を越えて走り、
  //   Bash の呼び出しの時間切れ（既定 120 秒）に当たって結果ごと失われる
  const deadline = started + options.budget * 1000
  const runTest = (): (ReturnType<typeof run> & { cutByBudget: boolean }) | null => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    const limit = Math.min(options.timeout * 1000, remaining)
    const ran = run(['sh', '-c', options.test], cwd, limit)
    return { ...ran, cutByBudget: ran.timedOut && limit < options.timeout * 1000 }
  }
  try {
    const baseline = runTest()
    if (baseline === null || baseline.cutByBudget) {
      console.error(`壊す前のテストが --budget（${options.budget} 秒）の内に終わらない。--test を、変更したファイルのテストだけに絞る`)
      return 4
    }
    if (baseline.code !== 0) {
      console.error(`壊す前のテストが落ちています。先に通してから走らせる:\n${baseline.out.slice(-3000)}`)
      return 4
    }
    const results: Result[] = []
    for (const [index, mutant] of mutants.entries()) {
      if (Date.now() >= deadline) {
        results.push(...mutants.slice(index).map((rest): Result => ({ ...rest, status: 'pending' })))
        console.error(`[${index + 1}/${mutants.length}] 以降の ${mutants.length - index} か所は、--budget の上限で未実行`)
        break
      }
      const path = join(copy, mutant.file)
      const original = readFileSync(path, 'utf8')
      const lines = original.split('\n')
      const at = lines[mutant.line - 1] ?? ''
      lines[mutant.line - 1] = at.replace(at.trim(), mutant.mutated)
      writeFileSync(path, lines.join('\n'))
      const ran = runTest()
      writeFileSync(path, original)
      const status = statusOf(ran)
      results.push({ ...mutant, status })
      // 途中で止まっても、どこまで済んだかが残るように 1 か所ごとに出す
      console.error(`[${index + 1}/${mutants.length}] ${status} ${mutant.key}`)
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
  if (count('pending') > 0) {
    console.error('未実行の分は、--budget を上げ、Bash の timeout を同じだけ長くするか run_in_background で走らせ直す')
  }
  const untested = untestedFiles(results)
  if (untested.length > 0) {
    console.error(`次のファイルは、壊した所が 1 つも落ちなかった。テストの無いファイル（画面など）なら、--files で外して走らせ直す: ${untested.join(', ')}`)
  }
}

// 2 か所以上壊して、1 つも落ちなかったファイル。--test のコマンドがそのファイルを守っていない見込みが高い
export const untestedFiles = (results: readonly Pick<Result, 'file' | 'status'>[]): string[] => {
  const byFile = Map.groupBy(
    results.filter(result => result.status === 'killed' || result.status === 'survived'),
    result => result.file,
  )
  return [...byFile].filter(([, ran]) => ran.length >= 2 && ran.every(result => result.status === 'survived')).map(([file]) => file)
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(`mutate.ts が失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
}
