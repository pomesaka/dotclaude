import { expect, test } from 'bun:test'

import { changedLines, isArid, isTarget, mutantsOf } from './mutate'

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
