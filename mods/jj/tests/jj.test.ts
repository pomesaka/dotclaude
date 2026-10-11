import { expect, test } from 'claude-code/testing'
import { CHANGED_ARGV, LOG_ARGV, SNAPSHOT_ARGV, UNPUSHED_ARGV, countsOf, parseLog, shortAge, type RunResult } from '../hooks/jj'
import type { JjCounts } from '../types'

const ran = (stdout: string, exitCode = 0): RunResult => ({ exitCode, stdout })

const COUNTS: { name: string; unpushed: RunResult; changed: RunResult; counts: JjCounts | null }[] = [
  { name: '何も溜まっていない', unpushed: ran(''), changed: ran(''), counts: { unpushed: 0, changed: 0 } },
  { name: '行の数を数える', unpushed: ran('x\nx\nx\n'), changed: ran('M a.ts\nA b.ts\n'), counts: { unpushed: 3, changed: 2 } },
  { name: '末尾に改行が無くても数える', unpushed: ran('x'), changed: ran('M a.ts'), counts: { unpushed: 1, changed: 1 } },
  { name: 'jj のリポジトリの外', unpushed: ran('', 1), changed: ran('', 1), counts: null },
  { name: '片方だけ失敗した', unpushed: ran('x\n'), changed: ran('', 1), counts: null },
]

for (const one of COUNTS) {
  test(`countsOf: ${one.name}`, async () => {
    expect(countsOf(one.unpushed, one.changed)).toEqual(one.counts)
  })
}

const AGES: { ago: string; short: string }[] = [
  { ago: '1 second ago', short: '1s' },
  { ago: '14 minutes ago', short: '14m' },
  { ago: '1 hour ago', short: '1h' },
  { ago: '7 hours ago', short: '7h' },
  { ago: '3 days ago', short: '3d' },
  { ago: '2 weeks ago', short: '2w' },
  { ago: '5 months ago', short: '5mo' },
  { ago: '1 year ago', short: '1y' },
  { ago: 'in the future', short: 'in the future' },
]

for (const one of AGES) {
  test(`shortAge("${one.ago}") は ${one.short}`, async () => {
    expect(shortAge(one.ago)).toBe(one.short)
  })
}

test('parseLog は、タブ区切りの行を項目に分ける', async () => {
  const stdout = [
    'aaaaaaaa\t@\t\tempty\t\t14 minutes ago\t',
    'bbbbbbbb\t\t\t\tfeat/x,wip\t2 hours ago\tfeat: 説明に\tタブがある',
    'cccccccc\t\tpushed\t\tmain\t7 hours ago\tfix: push済み',
    '',
  ].join('\n')

  expect(parseLog(stdout)).toEqual([
    { id: 'aaaaaaaa', isWorkingCopy: true, isPushed: false, isEmpty: true, bookmarks: [], age: '14m', title: '' },
    { id: 'bbbbbbbb', isWorkingCopy: false, isPushed: false, isEmpty: false, bookmarks: ['feat/x', 'wip'], age: '2h', title: 'feat: 説明に\tタブがある' },
    { id: 'cccccccc', isWorkingCopy: false, isPushed: true, isEmpty: false, bookmarks: ['main'], age: '7h', title: 'fix: push済み' },
  ])
})

test('SNAPSHOT_ARGV は作業コピーを記録する（--ignore-working-copy を付けない）', async () => {
  expect(SNAPSHOT_ARGV.includes('--ignore-working-copy')).toBe(false)
  expect(SNAPSHOT_ARGV.slice(0, 2)).toEqual(['jj', 'diff'])
})

// ツールのたびに走る読み取りでは操作ログを増やさない、という約束を固定する
for (const argv of [UNPUSHED_ARGV, CHANGED_ARGV, LOG_ARGV]) {
  test(`${argv.slice(0, 2).join(' ')} は作業コピーを記録しない`, async () => {
    expect(argv.includes('--ignore-working-copy')).toBe(true)
  })
}
