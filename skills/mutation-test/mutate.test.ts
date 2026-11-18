import { expect, test } from 'bun:test'

import { changedLines, isArid, isTarget, jjDiffArgs, mutantsOf, mutantsOfTargets, newSideOf, nothingToMutate, type Options, parseArgs, parseLine, type Status, statusOf, targetsOfDiff, untestedFiles } from './mutate'

test('targetsOfDiff: 差分の行を、ファイルと行の並びにする', () => {
  const diff = ['+++ b/a.ts', '@@ -1,1 +1,2 @@', ' keep', '+added', '+++ b/b.ts', '@@ -0,0 +5,1 @@', '+x'].join('\n')
  expect(targetsOfDiff(diff)).toEqual([
    { file: 'a.ts', line: 2 },
    { file: 'b.ts', line: 5 },
  ])
})

test.each<{ spec: string; lines: number[] | null }>([
  { spec: 'src/a.ts:12', lines: [12] },
  { spec: 'src/a.ts:3-5', lines: [3, 4, 5] },
  { spec: 'src/a.ts', lines: null },
  { spec: 'src/a.ts:0', lines: null },
  { spec: 'src/a.ts:5-3', lines: null },
])('parseLine: $spec', ({ spec, lines }) => {
  expect(parseLine(spec)?.map(target => target.line) ?? null).toEqual(lines)
})

const parsed = (args: string[]): Options => {
  const options = parseArgs(['--test', 'bun test', ...args])
  if (typeof options === 'string') throw new Error(options)
  return options
}

test.each<{ name: string; args: string[]; jj: string[]; newSide: string }>([
  { name: '何も指さなければ jj diff の既定（-r @）', args: [], jj: ['diff', '--git'], newSide: '@' },
  { name: '-r は jj diff の -r', args: ['-r', 'trunk()..@'], jj: ['diff', '--git', '-r', 'trunk()..@'], newSide: 'heads(trunk()..@)' },
  { name: '--revisions も -r と同じ', args: ['--revisions', '@-'], jj: ['diff', '--git', '-r', '@-'], newSide: 'heads(@-)' },
  { name: '-f だけなら新しい側は作業コピー', args: ['-f', '@-'], jj: ['diff', '--git', '--from', '@-'], newSide: '@' },
  { name: '-f と -t', args: ['--from', 'main', '-t', '@-'], jj: ['diff', '--git', '--from', 'main', '--to', '@-'], newSide: '@-' },
])('parseArgs と範囲: $name', ({ args, jj, newSide }) => {
  const options = parsed(args)
  expect(jjDiffArgs(options.range)).toEqual(jj)
  expect(newSideOf(options.range)).toBe(newSide)
  expect(options.lines).toBeNull()
})

test('mutantsOfTargets: 対象のファイルの、指した行だけを壊す。ファイルは 1 回だけ読む', () => {
  const reads: string[] = []
  const files: Record<string, string> = { 'src/a.ts': 'const x = 1\nif (a < b) {\nreturn a && b', 'src/a.test.ts': 'if (a < b) {', 'src/b.ts': 'if (c > d) {' }
  const read = (file: string): string => {
    reads.push(file)
    return files[file] ?? ''
  }
  const targets = [
    { file: 'src/a.ts', line: 2 },
    { file: 'src/a.ts', line: 3 },
    { file: 'src/a.test.ts', line: 1 },
    { file: 'src/b.ts', line: 1 },
  ]
  const mutants = mutantsOfTargets(targets, read, { files: /a\./, perLine: 1, only: [] })
  expect(mutants.map(mutant => mutant.mutated)).toEqual(['if (a <= b) {', 'return a || b'])
  expect(reads).toEqual(['src/a.ts'])
  expect(mutantsOfTargets(targets, read, { files: null, perLine: 1, only: ['src/b.ts:1:relational'] }).map(mutant => mutant.key)).toEqual(['src/b.ts:1:relational'])
})

test.each<{ name: string; args: string[]; error: RegExp }>([
  { name: '--test が無い', args: [], error: /--test/ },
  { name: '--since は案内して止める', args: ['--test', 'x', '--since', 'main'], error: /-r <revset>/ },
  { name: '-r と -f は一緒に使えない', args: ['--test', 'x', '-r', '@', '-f', '@-'], error: /一緒に使えない/ },
  { name: '--line の形が違う', args: ['--test', 'x', '--line', 'a.ts'], error: /<ファイル>:<行>/ },
  { name: '--line と -r は一緒に使えない', args: ['--test', 'x', '--line', 'a.ts:1', '-r', '@'], error: /差分を読まない/ },
])('parseArgs の誤り: $name', ({ args, error }) => {
  const options = parseArgs(args)
  expect(typeof options === 'string' ? options : '').toMatch(error)
})

test.each<{ name: string; args: string[]; targets: number; message: RegExp }>([
  { name: '既定の範囲で差分が空', args: [], targets: 0, message: /差分が空です（-r @（既定））.*-r "trunk\(\)\.\.@"/ },
  { name: '指した範囲で差分が空', args: ['-r', '@-'], targets: 0, message: /差分が空です（-r @-）/ },
  { name: '行はあったが壊せない', args: [], targets: 3, message: /^3 行のうち、壊せる行がありません/ },
  { name: '絞り込みがあれば見直しを促す', args: ['--files', 'model'], targets: 3, message: /絞り込み（--files model）も見直す/ },
  { name: '--line で指した行が壊せない', args: ['--line', 'a.ts:1'], targets: 1, message: /^1 行のうち/ },
])('nothingToMutate: $name', ({ args, targets, message }) => {
  expect(nothingToMutate(parsed(args), targets)).toMatch(message)
})

test.each<{ name: string; ran: { code: number | null; timedOut: boolean; cutByBudget: boolean } | null; status: Status }>([
  { name: '走らせる時間が残っていない', ran: null, status: 'pending' },
  { name: '全体の上限で切られた', ran: { code: null, timedOut: true, cutByBudget: true }, status: 'pending' },
  { name: '1 か所の上限で切られた', ran: { code: null, timedOut: true, cutByBudget: false }, status: 'timeout' },
  { name: 'テストが通った', ran: { code: 0, timedOut: false, cutByBudget: false }, status: 'survived' },
  { name: 'テストが落ちた', ran: { code: 1, timedOut: false, cutByBudget: false }, status: 'killed' },
])('statusOf: $name', ({ ran, status }) => {
  expect(statusOf(ran)).toBe(status)
})

test('parseArgs: 全体の上限の既定は、Bash の既定の時間切れ（120 秒）より短い', () => {
  expect(parsed([]).budget).toBeLessThan(120)
})

test('parseArgs: --line は何回でも書け、並べた順に行を持つ', () => {
  expect(parsed(['--line', 'a.ts:2-3', '--line', 'b.ts:9']).lines).toEqual([
    { file: 'a.ts', line: 2 },
    { file: 'a.ts', line: 3 },
    { file: 'b.ts', line: 9 },
  ])
})

test.each<{ name: string; results: { file: string; status: 'killed' | 'survived' | 'timeout' | 'pending' }[]; files: string[] }>([
  { name: '2 か所以上壊して全部生き残ったファイル', results: [{ file: 'view.tsx', status: 'survived' }, { file: 'view.tsx', status: 'survived' }], files: ['view.tsx'] },
  { name: '1 つでも落ちたファイルは挙げない', results: [{ file: 'model.ts', status: 'survived' }, { file: 'model.ts', status: 'survived' }, { file: 'model.ts', status: 'killed' }], files: [] },
  { name: '1 か所しか壊していないファイルは挙げない', results: [{ file: 'a.ts', status: 'survived' }], files: [] },
  { name: '未実行と時間切れは数えない', results: [{ file: 'a.ts', status: 'survived' }, { file: 'a.ts', status: 'pending' }, { file: 'a.ts', status: 'timeout' }], files: [] },
])('untestedFiles: $name', ({ results, files }) => {
  expect(untestedFiles(results)).toEqual(files)
})

test('changedLines: 足した行と変えた行の、新しい側の番号を取る', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,4 @@',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
    '+const c = 4',
    ' const d = 5',
    '@@ -10,0 +11,1 @@',
    '+export const e = 6',
    'diff --git a/old.ts b/old.ts',
    '--- a/old.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
  ].join('\n')
  expect([...changedLines(diff)]).toEqual([['src/a.ts', [2, 3, 11]]])
})

test('changedLines: 消した行は数えず、前後の行は数える', () => {
  // 前後の行と消した行の数をそろえない。そろうと、両方を取り違えても番号が合ってしまう
  const diff = ['+++ b/a.ts', '@@ -1,3 +1,2 @@', ' keep', '-gone', '-gone', '+added'].join('\n')
  expect([...changedLines(diff)]).toEqual([['a.ts', [2]]])
})

test.each<{ name: string; text: string; mutated: string[] }>([
  { name: '文字列の中の演算子は壊さない', text: "  '==': '!=',", mutated: [] },
  { name: '文字列の外は壊す', text: "if (a === 'x') {", mutated: ["if (a !== 'x') {"] },
  { name: '文字列の後ろの演算子も、位置をずらさずに壊す', text: "if ('<=' === a) {", mutated: ["if ('<=' !== a) {"] },
])('mutantsOf と文字列: $name', ({ text, mutated }) => {
  expect(mutantsOf('a.ts', 1, text, 1).map(mutant => mutant.mutated)).toEqual(mutated)
})

test.each<{ name: string; text: string; arid: boolean }>([
  { name: 'ログ', text: '  console.log(x)', arid: true },
  { name: 'Go のログ', text: '\tslog.Info("x", "k", v)', arid: true },
  { name: 'import', text: "import { a } from './a'", arid: true },
  { name: '型の宣言', text: 'export type A = { a: number }', arid: true },
  { name: 'コメント', text: '  // a < b', arid: true },
  { name: '括弧だけ', text: '  });', arid: true },
  { name: '条件', text: '  if (a < b) {', arid: false },
])('isArid: $name', ({ text, arid }) => {
  expect(isArid(text)).toBe(arid)
})

test.each<{ name: string; file: string; text: string; mutated: string[] }>([
  { name: '関係演算子を先に壊す', file: 'a.ts', text: '  if (a < b && c) {', mutated: ['if (a <= b && c) {'] },
  { name: '等しいを逆にする', file: 'a.ts', text: 'return a === b', mutated: ['return a !== b'] },
  { name: '矢印は関係演算子と読まない', file: 'a.ts', text: 'const f = (x) => x && y', mutated: ['const f = (x) => x || y'] },
  { name: 'Go の if を逆にする', file: 'a.go', text: '\tif ok {', mutated: ['if !(ok) {'] },
  { name: 'Python の論理演算子', file: 'a.py', text: 'return a and b', mutated: ['return a or b'] },
  { name: '呼び出しの文を消す', file: 'a.ts', text: '    detach(id);', mutated: ['/* mutation: removed */'] },
  { name: 'Python の文は pass にする', file: 'a.py', text: '    detach(id)', mutated: ['pass'] },
  { name: '宣言は消さない。数値を変える', file: 'a.ts', text: 'const n = 1', mutated: ['const n = 0'] },
  { name: 'ログの行は壊さない', file: 'a.ts', text: 'logger.info(a < b)', mutated: [] },
])('mutantsOf: $name', ({ file, text, mutated }) => {
  expect(mutantsOf(file, 1, text, 1).map(mutant => mutant.mutated)).toEqual(mutated)
})

test('mutantsOf: 1 行に perLine 個まで、鍵はファイルと行と壊し方', () => {
  const mutants = mutantsOf('src/a.ts', 7, '  if (a < b && c) {', 2)
  expect(mutants.map(mutant => mutant.key)).toEqual(['src/a.ts:7:relational', 'src/a.ts:7:logical'])
})

test.each<{ name: string; file: string; only: RegExp | null; is: boolean }>([
  { name: '本体のコード', file: 'src/model.ts', only: null, is: true },
  { name: 'テストのファイル', file: 'test/model.test.ts', only: null, is: false },
  { name: 'Go のテスト', file: 'pkg/a_test.go', only: null, is: false },
  { name: 'コードでないファイル', file: 'docs/a.md', only: null, is: false },
  { name: '絞り込みに合わない', file: 'src/view.tsx', only: /model/, is: false },
])('isTarget: $name', ({ file, only, is }) => {
  expect(isTarget(file, only)).toBe(is)
})
