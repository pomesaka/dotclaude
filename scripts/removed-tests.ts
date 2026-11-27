// 差分で消えたテストの行（expect、テストの名前、表の行）のうち、変更後のテストに同じものが見つからない行だけを出す。
// test-reviewer が、消したテストの移し先を突き合わせる前に走らせ、出た行だけを読む。
//
//   bun ~/github.com/pomesaka/dotclaude/scripts/removed-tests.ts [-r <revset> | -f <rev> [-t <rev>]]
//
// 差分の取り方は jj diff と同じ引数で決める。何も付けなければ jj diff と同じ -r @。
// 終了コード: 0 すべて一致、1 見つからない行あり、2 引数の誤り、3 jj が失敗
//
// 一致は保守的に決める。迷う行は「見つからない」側に出す。
// - 同じ式: 空白、引用符、末尾の ; と , を揃えた行が、足したテストの行にある（1 行が 1 行だけを打ち消す）。
//   目立つ文字列（DISTINCT 文字以上）を持つ行なら、触っていないテストにあっても一致にする
// - 同じ期待値: toBe などの引数が目立つ文字列 1 つで、その文字列が変更後のテストのどこかにある。not の付いた行は除く
// - 同じ名前: test、it、t.Run の名前が目立つ文字列で、変更後のテストのどこかにある。$name などの置き換えを含む名前は迷う
// - 同じ表の行: { } か [ ] で囲んだ行が、足したテストの行にある
// WHY 足した行で探す: expect(result.ok).toBe(true) のようなありふれた式は、触っていないテストにも並んでいる。
//   そこで見つかっても、消したテストの移し先とは言えない
// WHY 2026-11-27: test-reviewer が消したテストの expect を全部の行で突き合わせ、約 170 分かかった（pomesaka の依頼）
import { jjDiffArgs, maskStrings, newSideOf, type Range, TEST_FILE } from '../skills/mutation-test/mutate'

export const isTestFile = (path: string): boolean => TEST_FILE.test(path)

// 文字列を目立つと見なす長さ。'ok' や 'a' はどのテストにもあり、見つかっても移し先の手がかりにならない
const DISTINCT = 6

export type Line = { file: string; line: number; text: string }
export type Parsed = { removed: Line[]; added: Line[]; deleted: Set<string> }

// jj diff --git の出力から、テストのファイルの消えた行（変更前の行番号）と足した行（変更後の行番号）を取り出す
export const parseDiff = (diff: string): Parsed => {
  const removed: Line[] = []
  const added: Line[] = []
  const deleted = new Set<string>()
  let oldFile: string | null = null
  let newFile: string | null = null
  let oldLine = 0
  let newLine = 0
  for (const row of diff.split('\n')) {
    if (row.startsWith('diff ')) {
      oldFile = null
      newFile = null
      oldLine = 0
      newLine = 0
      continue
    }
    if (row.startsWith('--- ')) {
      const path = row.slice(4)
      oldFile = path === '/dev/null' ? null : path.replace(/^a\//, '')
      continue
    }
    if (row.startsWith('+++ ')) {
      const path = row.slice(4)
      newFile = path === '/dev/null' ? null : path.replace(/^b\//, '')
      if (newFile === null && oldFile !== null && isTestFile(oldFile)) deleted.add(oldFile)
      continue
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row)
    if (hunk !== null) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      continue
    }
    if (oldLine === 0 && newLine === 0) continue
    if (row.startsWith('-')) {
      if (oldFile !== null && isTestFile(oldFile)) removed.push({ file: oldFile, line: oldLine, text: row.slice(1) })
      oldLine += 1
    } else if (row.startsWith('+')) {
      if (newFile !== null && isTestFile(newFile)) added.push({ file: newFile, line: newLine, text: row.slice(1) })
      newLine += 1
    } else if (row.startsWith(' ')) {
      oldLine += 1
      newLine += 1
    }
  }
  return { removed, added, deleted }
}

export const normalize = (text: string): string =>
  text.trim().replace(/\s+/g, ' ').replace(/"/g, "'").replace(/\s*[;,]$/, '')

const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g
const literalsOf = (text: string): string[] => [...text.matchAll(LITERAL)].map(match => match[2] ?? '')
const isDistinct = (literal: string): boolean => literal.trim().length >= DISTINCT && !literal.includes('${')

const balanced = (text: string): boolean => {
  const masked = maskStrings(text)
  const count = (char: string) => masked.split(char).length - 1
  return count('(') === count(')') && count('[') === count(']') && count('{') === count('}')
}

export type Candidate =
  | { kind: 'assertion'; key: string; distinct: boolean; expected: string | null; whole: boolean }
  | { kind: 'name'; name: string }
  | { kind: 'row'; key: string }

const ASSERTION = /\bexpect\(|\.(?:not\.)?(?:to[A-Z]\w*)\(|\bassert\w*[.(]|\bt\.(?:Error|Fatal)f?\(|\brequire\.\w+\(/
const MATCHER = /\.to(?:Be|Equal|StrictEqual|Match|Contain|Throw|ThrowError|HaveProperty)\((.+)\)$/
const NAME = /^\s*(?:(?:test|it)(?:\.\w+)*(?:\([^)]*\))?\(\s*|t\.Run\(\s*)(["'`])((?:\\.|(?!\1)[^\\])*)\1/
const ROW = /^\s*[[{].*[\]}]\s*,?\s*$/

// 消えた行が何の行かを決める。準備のコード、import、括弧だけの行は null（突き合わせない）
export const classify = (text: string): Candidate | null => {
  const key = normalize(text)
  if (ASSERTION.test(text)) {
    const literal = MATCHER.exec(key)?.[1]
    const single = literal === undefined ? null : /^'([^']*)'$/.exec(literal)?.[1]
    const expected = single !== null && single !== undefined && isDistinct(single) && !key.includes('.not.') ? single : null
    return { kind: 'assertion', key, distinct: literalsOf(key).some(isDistinct), expected, whole: balanced(key) }
  }
  const name = NAME.exec(text)
  if (name !== null) return { kind: 'name', name: name[2] ?? '' }
  if (ROW.test(text) && /['"`\d]/.test(text)) return { kind: 'row', key }
  return null
}

export type Pool = { added: Map<string, number>; lines: Set<string>; text: string }

// added: 足したテストの行。newSide: 変更後のテストのファイルの全部の行
export const makePool = (added: readonly string[], newSide: readonly string[]): Pool => {
  const counts = new Map<string, number>()
  for (const text of added) counts.set(normalize(text), (counts.get(normalize(text)) ?? 0) + 1)
  return { added: counts, lines: new Set(newSide.map(normalize)), text: newSide.map(normalize).join('\n') }
}

export type By = 'expression' | 'expected' | 'name' | 'row'
export type Judgement = { found: true; by: By } | { found: false; unsure: string | null }
export type Result = Line & { candidate: Candidate; judgement: Judgement }

const quoted = (pool: Pool, literal: string): boolean => pool.text.includes(`'${literal.replace(/"/g, "'")}'`) || pool.text.includes(`\`${literal}\``)

// 消えた行を上から順に突き合わせる。足した行は 1 行が 1 行だけを打ち消す
export const judgeAll = (removed: readonly Line[], pool: Pool): Result[] => {
  const left = new Map(pool.added)
  const take = (key: string): boolean => {
    const count = left.get(key) ?? 0
    if (count === 0) return false
    left.set(key, count - 1)
    return true
  }
  return removed.flatMap((line): Result[] => {
    const candidate = classify(line.text)
    if (candidate === null) return []
    const judge = (): Judgement => {
      switch (candidate.kind) {
        case 'assertion':
          if (!candidate.whole) return { found: false, unsure: '複数行の式' }
          if (take(candidate.key)) return { found: true, by: 'expression' }
          if (candidate.distinct && pool.lines.has(candidate.key)) return { found: true, by: 'expression' }
          if (candidate.expected !== null && quoted(pool, candidate.expected)) return { found: true, by: 'expected' }
          return { found: false, unsure: null }
        case 'name':
          if (/[$%]/.test(candidate.name)) return { found: false, unsure: '置き換えを含む名前' }
          if (isDistinct(candidate.name) && quoted(pool, candidate.name)) return { found: true, by: 'name' }
          return { found: false, unsure: null }
        case 'row':
          return take(candidate.key) ? { found: true, by: 'row' } : { found: false, unsure: null }
      }
    }
    return [{ ...line, candidate, judgement: judge() }]
  })
}

const LABEL: Record<Candidate['kind'], string> = { assertion: '式', name: '名前', row: '表の行' }
const BY: Record<By, string> = { expression: '同じ式', expected: '同じ期待値', name: '同じ名前', row: '同じ表の行' }

export const report = (results: readonly Result[], parsed: Parsed, skipped: number): string => {
  const missing = results.filter(result => !result.judgement.found)
  const out: string[] = []
  for (const [file, rows] of Map.groupBy(missing, result => result.file)) {
    out.push(`${file}${parsed.deleted.has(file) ? '（ファイルごと消えた）' : ''}`)
    for (const row of rows) {
      const unsure = !row.judgement.found && row.judgement.unsure !== null ? `、迷う: ${row.judgement.unsure}` : ''
      out.push(`  ${row.line} [${LABEL[row.candidate.kind]}${unsure}] ${row.text.trim()}`)
    }
  }
  const found = results.filter(result => result.judgement.found)
  const byCount = Object.entries(BY)
    .map(([by, label]) => ({ label, count: found.filter(result => result.judgement.found && result.judgement.by === by).length }))
    .filter(({ count }) => count > 0)
    .map(({ label, count }) => `${label} ${count}`)
  out.push(
    `見つからない ${missing.length} 行（行番号は変更前）。機械で一致した ${found.length} 行${byCount.length > 0 ? `（${byCount.join('、')}）` : ''}。` +
      `突き合わせていない行 ${skipped} 行（準備のコード、import、括弧、複数行の式の続き）`,
  )
  return out.join('\n')
}

const run = (argv: string[], cwd: string) => {
  const ran = Bun.spawnSync(argv, { cwd, stdout: 'pipe', stderr: 'pipe' })
  return { code: ran.exitCode, out: ran.stdout.toString(), err: ran.stderr.toString() }
}

const USAGE = 'bun removed-tests.ts [-r <revset> | -f <rev> [-t <rev>]]'

export const parseArgs = (args: readonly string[]): Range | string => {
  const range: Range = { revisions: null, from: null, to: null }
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (value === undefined) return `${flag} に値がありません。${USAGE}`
    if (flag === '-r' || flag === '--revisions') range.revisions = value
    else if (flag === '-f' || flag === '--from') range.from = value
    else if (flag === '-t' || flag === '--to') range.to = value
    else return `知らない引数 ${flag}。${USAGE}`
  }
  if (range.revisions !== null && (range.from !== null || range.to !== null)) return `-r と -f/-t は一緒に使えません。${USAGE}`
  return range
}

const describeRange = (args: readonly string[]): string => (args.length === 0 ? '-r @' : args.join(' '))

const main = (args: string[]): number => {
  const range = parseArgs(args)
  if (typeof range === 'string') {
    console.error(range)
    return 2
  }
  const rootRun = run(['jj', 'root'], process.cwd())
  if (rootRun.code !== 0) {
    console.error(`jj のリポジトリの中で走らせる: ${rootRun.err.trim()}`)
    return 3
  }
  const root = rootRun.out.trim()
  const diff = run(['jj', ...jjDiffArgs(range)], root)
  if (diff.code !== 0) {
    console.error(`jj diff が失敗した: ${diff.err.trim()}`)
    return 3
  }
  const parsed = parseDiff(diff.out)
  if (parsed.removed.length === 0) {
    console.log(`消えたテストの行は無い（${describeRange(args)} の差分）。範囲が違うなら -r 'main..@' のように指し直す`)
    return 0
  }
  const newSide = newSideOf(range)
  const listed = run(['jj', 'file', 'list', '-r', newSide], root)
  if (listed.code !== 0) {
    console.error(`jj file list -r ${newSide} が失敗した。-r に範囲を渡したなら、先が 1 つになる範囲か -f/-t で指す: ${listed.err.trim()}`)
    return 3
  }
  const testFiles = listed.out.split('\n').filter(path => path !== '' && isTestFile(path))
  const newLines: string[] = []
  // WHY 束ねる: ファイルごとに jj を呼ぶと、テストの多いリポジトリで遅い。引数の長さの上限に当たらないよう 200 ずつにする
  for (let index = 0; index < testFiles.length; index += 200) {
    const chunk = testFiles.slice(index, index + 200).map(path => `root-file:"${path.replace(/["\\]/g, '\\$&')}"`)
    const shown = run(['jj', 'file', 'show', '-r', newSide, ...chunk], root)
    if (shown.code !== 0) {
      console.error(`jj file show -r ${newSide} が失敗した: ${shown.err.trim()}`)
      return 3
    }
    newLines.push(...shown.out.split('\n'))
  }
  const pool = makePool(
    parsed.added.map(line => line.text),
    newLines,
  )
  const results = judgeAll(parsed.removed, pool)
  const skipped = parsed.removed.filter(line => line.text.trim() !== '').length - results.length
  console.log(report(results, parsed, skipped))
  return results.some(result => !result.judgement.found) ? 1 : 0
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(`removed-tests.ts が失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(3)
  }
}
