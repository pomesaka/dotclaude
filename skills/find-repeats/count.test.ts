import { expect, test } from 'bun:test'

import { countRepeats, normalizeBash, shellWords, stepsOf } from './count'

test.each<{ name: string; text: string; words: string[] }>([
  { name: '空白で切る', text: 'jj git push', words: ['jj', 'git', 'push'] },
  { name: '引用符の中は 1 語', text: `jj commit -m "a b" 'c d'`, words: ['jj', 'commit', '-m', 'a b', 'c d'] },
  { name: '閉じていない引用符は空白で切るだけ', text: 'echo "a b', words: ['echo', '"a', 'b'] },
])('shellWords: $name', ({ text, words }) => {
  expect(shellWords(text)).toEqual(words)
})

test.each([
  { name: 'サブコマンドまで数える', command: 'jj git push -b main', step: 'jj git' },
  { name: '先頭の環境変数を除く', command: 'FOO=1 gh pr checks 12', step: 'gh pr' },
  { name: '複合コマンドは最初の 1 つ', command: 'jj git fetch && jj new main', step: 'jj git' },
  { name: '調べ物の道具は数えない', command: 'rg -n foo', step: null },
  { name: '使い捨てのコードは数えない', command: 'python3 -c "print(1)"', step: null },
  { name: 'スクリプトは名前で数える', command: 'bun /a/b/sync.ts plan', step: 'bun sync.ts' },
  { name: 'bun のサブコマンド', command: 'bun test skills', step: 'bun test' },
  { name: 'パスで呼んだコマンドは名前にする', command: '/usr/local/bin/xwb ls board', step: 'xwb ls' },
])('normalizeBash: $name', ({ command, step }) => {
  expect(normalizeBash(command)).toBe(step)
})

const line = (uses: { name: string; input: unknown }[], isSidechain = false): string =>
  JSON.stringify({ isSidechain, message: { content: uses.map(use => ({ type: 'tool_use', ...use })) } })

test.each<{ name: string; text: string; steps: string[] }>([
  {
    name: '同じ手が続くのは 1 手にまとめる',
    text: [line([{ name: 'Bash', input: { command: 'gh pr checks' } }]), line([{ name: 'Bash', input: { command: 'gh pr checks' } }]), line([{ name: 'Skill', input: { skill: 're' } }])].join('\n'),
    steps: ['Bash:gh pr', 'Skill:re'],
  },
  { name: 'サブエージェントの呼び出しは数えない', text: line([{ name: 'Bash', input: { command: 'jj st' } }], true), steps: [] },
  { name: 'ファイルの読み書きは数えない', text: line([{ name: 'Read', input: {} }, { name: 'WebFetch', input: {} }]), steps: ['WebFetch'] },
  { name: '壊れた行は読み飛ばす', text: '{"tool_use"', steps: [] },
])('stepsOf: $name', ({ text, steps }) => {
  expect(stepsOf(text)).toEqual(steps)
})

test('countRepeats: 長い並びに含まれ、回数の増えない短い並びは出さない', () => {
  const steps = ['a', 'b', 'c']
  const sessions = [1, 2, 3].map(index => ({ path: `p${index}`, project: 'x', steps }))
  const shown = countRepeats(sessions, { minSessions: 3, top: 10, maxLen: 3 })
  expect(shown.map(one => one.gram.join(' '))).toEqual(['a b c'])
})

test('countRepeats: セッション数が足りない並びは出さない', () => {
  const sessions = [{ path: 'p1', project: 'x', steps: ['a', 'b'] }]
  expect(countRepeats(sessions, { minSessions: 3, top: 10, maxLen: 2 })).toEqual([])
})
