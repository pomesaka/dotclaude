import { describe, expect, test } from 'bun:test'
import { classify, judgeAll, makePool, parseDiff } from './removed-tests'

describe('classify', () => {
  test.each([
    { name: 'expect の行', text: "  expect(parse('a')).toBe('xyz-value');", want: 'assertion' },
    { name: 'test の名前', text: "test('日付を読む', () => {", want: 'name' },
    { name: 'Go の t.Run の名前', text: '\tt.Run("parses dates", func(t *testing.T) {', want: 'name' },
    { name: '表の行', text: "  { input: 'a', want: 'xyz-value' },", want: 'row' },
    { name: '準備のコード', text: '  const result = parse(input)', want: null },
    { name: '括弧だけ', text: '  })', want: null },
    { name: 'import', text: "import { parse } from './parse'", want: null },
  ])('$name', ({ text, want }) => {
    expect(classify(text)?.kind ?? null).toBe(want)
  })
})

const diffOf = (removed: readonly string[], added: readonly string[]): string =>
  [
    'diff --git a/src/a.test.ts b/src/a.test.ts',
    '--- a/src/a.test.ts',
    '+++ b/src/a.test.ts',
    `@@ -10,${removed.length} +10,${added.length} @@`,
    ...removed.map(text => `-${text}`),
    ...added.map(text => `+${text}`),
  ].join('\n')

describe('judgeAll', () => {
  test.each([
    {
      name: '同じ式が足した行にあれば、同じ式で一致する',
      removed: ["  expect(parse('a')).toBe(1)"],
      added: ['expect(parse("a")).toBe(1);'],
      rest: [],
      want: ['expression'],
    },
    {
      name: 'ありふれた式が、触っていないテストにあるだけなら見つからない',
      removed: ['  expect(result.ok).toBe(true)'],
      added: [],
      rest: ['  expect(result.ok).toBe(true)'],
      want: ['missing'],
    },
    {
      name: '目立つ文字列を持つ式は、触っていないテストにあれば一致する',
      removed: ["  expect(parse('2026-01-01')).toBe(1)"],
      added: [],
      rest: ["expect(parse('2026-01-01')).toBe(1)"],
      want: ['expression'],
    },
    {
      name: '期待値の文字列が表の行に移っていれば、同じ期待値で一致する',
      removed: ["  expect(parse('a')).toBe('parsed-value')"],
      added: ["  { input: 'a', want: 'parsed-value' },"],
      rest: [],
      want: ['expected'],
    },
    {
      name: '短い期待値の文字列は、ほかにあっても一致にしない',
      removed: ["  expect(parse('a')).toBe('ok')"],
      added: ["  { input: 'b', want: 'ok' },"],
      rest: [],
      want: ['missing'],
    },
    {
      name: 'not の付いた期待値は、文字列があっても一致にしない',
      removed: ["  expect(parse('a')).not.toBe('parsed-value')"],
      added: ["  expect(parse('b')).toBe('parsed-value')"],
      rest: [],
      want: ['missing'],
    },
    {
      name: '複数行にまたがる式は迷うので、見つからない側に出す',
      removed: ['  expect(parse(', "    'a',", "  )).toBe('parsed-value')"],
      added: ['  expect(parse(', "    'a',", "  )).toBe('parsed-value')"],
      rest: [],
      want: ['unsure', 'unsure'],
    },
    {
      name: 'テストの名前が足した行にあれば、同じ名前で一致する',
      removed: ["test('日付を読む日付を読む', () => {"],
      added: ["  { name: '日付を読む日付を読む', input: 'a' },"],
      rest: [],
      want: ['name'],
    },
    {
      name: '短いテストの名前は、ほかにあっても一致にしない',
      removed: ["test('works', () => {"],
      added: ["test('works', () => {"],
      rest: [],
      want: ['missing'],
    },
    {
      name: 'テストの名前がどこにも無ければ見つからない',
      removed: ["test('日付を読む日付を読む', () => {"],
      added: [],
      rest: ["test('別の振る舞いを確かめる', () => {"],
      want: ['missing'],
    },
    {
      name: '置き換えを含む名前は迷う',
      removed: ["test.each(cases)('$name', ({ input }) => {"],
      added: ["test.each(cases)('$name', ({ input }) => {"],
      rest: [],
      want: ['unsure'],
    },
    {
      name: '同じ表の行が足した行にあれば一致する',
      removed: ["  { input: 'a', want: 1 },"],
      added: ["    { input: 'a', want: 1 }"],
      rest: [],
      want: ['row'],
    },
    {
      name: '書き換えた表の行は見つからない',
      removed: ["  { input: 'a', want: 1 },"],
      added: ["  ['a', 1],"],
      rest: [],
      want: ['missing'],
    },
    {
      name: '同じ式が 2 つ消えて 1 つ足されたら、1 つだけ一致する',
      removed: ['  expect(result.ok).toBe(true)', '  expect(result.ok).toBe(true)'],
      added: ['  expect(result.ok).toBe(true)'],
      rest: [],
      want: ['expression', 'missing'],
    },
  ])('$name', ({ removed, added, rest, want }) => {
    const parsed = parseDiff(diffOf(removed, added))
    const pool = makePool(
      parsed.added.map(line => line.text),
      [...added, ...rest],
    )
    const verdicts = judgeAll(parsed.removed, pool).map(result => result.judgement.found ? result.judgement.by : result.judgement.unsure === null ? 'missing' : 'unsure')
    expect(verdicts).toEqual([...want])
  })
})

describe('parseDiff', () => {
  test('消えた行に、変更前の行番号とファイルを付け、消えたファイルを数える', () => {
    const diff = [
      'diff --git a/tests/old.test.ts b/tests/old.test.ts',
      'deleted file mode 100644',
      '--- a/tests/old.test.ts',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      "-test('x', () => {",
      "-  expect(1).toBe(1)",
      '-})',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -4,2 +4,2 @@',
      ' keep',
      "-expect(gone).toBe('x')",
      "+expect(kept).toBe('x')",
    ].join('\n')
    const parsed = parseDiff(diff)
    expect(parsed.removed).toEqual([
      { file: 'tests/old.test.ts', line: 1, text: "test('x', () => {" },
      { file: 'tests/old.test.ts', line: 2, text: '  expect(1).toBe(1)' },
      { file: 'tests/old.test.ts', line: 3, text: '})' },
    ])
    expect(parsed.added).toEqual([])
    expect([...parsed.deleted]).toEqual(['tests/old.test.ts'])
  })
})
