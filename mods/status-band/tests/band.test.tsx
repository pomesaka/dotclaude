import { expect, test } from 'claude-code/testing'
import { END, START, line, logPane, prUrl, view, world } from './world'

test('広い行には、すべての項目とボタンが出る。元の表示も残る', async ($, on) => {
  const seen = world(on, { unpushed: 'x\nx\n', changed: 'M a.ts\n' })
  await $.turn.complete(END)
  const ui = await $.ui.mount(line(140))

  expect(await ui.find({ type: 'Text', text: /^opus$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^━{5}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^47%$/ })).toBeDefined()
  // 費用と 5 時間の枠は、$.session.usage() が返していても出さない
  expect(await ui.find({ type: 'Text', text: /^\$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^~\/github\.com\/pomesaka\/dotclaude$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'log' })).toBeDefined()
  // commit と diff はすぐ実行する
  await ui.press({ key: 'commit' })
  await ui.press({ key: 'difit' })
  expect(seen.commands).toEqual(['jjcommit', 'difit'])

  await ui.unmount()
})

test('コマンドをすぐ実行できなかったら、入力欄に入れて知らせる', async ($, on) => {
  const seen = world(on, { changed: 'M a.ts\n', runsCommands: false })
  await $.turn.complete(END)
  const ui = await $.ui.mount(line(140))

  await ui.press({ key: 'commit' })
  expect(seen.filled).toEqual(['/jjcommit'])
  expect(seen.toasts.length).toBe(1)

  await ui.unmount()
})

// 保存の並びは、末尾がいちばん新しい。帯には 14、13、12、11 の順で出る
const PRS = {
  stored: { 'prs:s1': [prUrl(11), prUrl(12), prUrl(13), prUrl(14)] },
  views: {
    [prUrl(14)]: view('d', 'OPEN', 'FAILURE'),
    [prUrl(13)]: view('c', 'OPEN', 'PENDING'),
    [prUrl(12)]: view('b', 'MERGED'),
    [prUrl(11)]: view('a', 'OPEN'),
  },
}

const PR_WIDTHS: { width: number; shown: number[]; hidden: number[] }[] = [
  { width: 140, shown: [14, 13, 12], hidden: [11] },
  { width: 100, shown: [14, 13], hidden: [12, 11] },
  { width: 80, shown: [14], hidden: [13, 12, 11] },
]

for (const one of PR_WIDTHS) {
  test(`幅 ${one.width} の帯には、最後に触った PR を ${one.shown.length} つ出す`, async ($, on) => {
    world(on, PRS)
    await $.session.start(START)
    const ui = await $.ui.mount(line(one.width))

    for (const number of one.shown) expect(await ui.find({ type: 'Text', text: new RegExp(`^#${number}$`) })).toBeDefined()
    for (const number of one.hidden) expect(await ui.find({ type: 'Text', text: new RegExp(`^#${number}$`) })).toBeUndefined()
    await ui.unmount()
  })
}

test('PR の番号を押すとブラウザで開く', async ($, on) => {
  const seen = world(on, PRS)
  await $.session.start(START)
  const ui = await $.ui.mount(line(140))

  await ui.press({ key: `pr-${prUrl(14)}` })
  expect(seen.ran).toEqual([['open', prUrl(14)]])
  await ui.unmount()
})

test('pr を押すと、コマンドを通さずに一覧の pane を開き、状態を取り直す', async ($, on) => {
  const seen = world(on, PRS)
  await $.session.start(START)
  seen.queried.length = 0
  const ui = await $.ui.mount(line(140))

  await ui.press({ key: 'pr' })
  expect(seen.opened).toEqual(['pull-requests'])
  // WHY コマンドを通さない: 通すと、ターンの途中に押したときに、ターンが終わるまで開かない
  expect(seen.commands).toEqual([])
  // マージ済みの 12 は問い合わせに入れない
  expect(seen.queried).toEqual([[prUrl(14), prUrl(13), prUrl(11)]])
  await ui.unmount()
})

test('PR が無ければ、番号も pr のボタンも出ない', async ($, on) => {
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(line(140))

  expect(await ui.find({ key: 'pr' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^#\d+$/ })).toBeUndefined()
  await ui.unmount()
})

test('まだ値を集めていないときは、元の表示だけを描く', async ($, on) => {
  world(on)
  const ui = await $.ui.mount(line(140))

  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^opus$/ })).toBeUndefined()

  await ui.unmount()
})

test('狭い行では、場所を落とす', async ($, on) => {
  world(on)
  await $.turn.complete(END)
  const ui = await $.ui.mount(line(80))

  expect(await ui.find({ type: 'Text', text: /^47%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dotclaude/ })).toBeUndefined()

  await ui.unmount()
})

test('jj のリポジトリの外でも出る。jj の項目とボタンだけが無い', async ($, on) => {
  world(on, { jjExitCode: 1 })
  await $.turn.complete(END)
  const ui = await $.ui.mount(line(140))

  expect(await ui.find({ type: 'Text', text: /^opus$/ })).toBeDefined()
  expect(await ui.find({ key: 'commit' })).toBeUndefined()
  expect(await ui.find({ key: 'log' })).toBeUndefined()

  await ui.unmount()
})

test('未コミットが無ければ、コミットと差分のボタンは出ない。log は出る', async ($, on) => {
  world(on, { unpushed: 'x\n' })
  await $.turn.complete(END)
  const ui = await $.ui.mount(line(140))

  expect(await ui.find({ key: 'log' })).toBeDefined()
  expect(await ui.find({ key: 'commit' })).toBeUndefined()
  expect(await ui.find({ key: 'difit' })).toBeUndefined()

  await ui.unmount()
})

test('log を押すと、ログを読んでから pane を開く。pane には 3 種類の印が出る', async ($, on) => {
  const seen = world(on, { unpushed: 'x\n' })
  await $.turn.complete(END)
  const band = await $.ui.mount(line(140))
  await band.press({ key: 'log' })
  expect(seen.opened).toEqual(['jj-log'])
  await band.unmount()

  const pane = await $.ui.mount(logPane)
  expect(await pane.find({ type: 'Text', text: /^@$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^↑$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^◆$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^feat\/x$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^feat: まだpushしていない変更$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^\(empty\)$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^2h$/ })).toBeDefined()

  // push は入力欄に入れるだけ。更新は jj log をもう一度実行する
  await pane.press({ key: 'push' })
  expect(seen.filled).toEqual(['pushしといて'])
  const before = seen.jj.filter(kind => kind === 'log').length
  await pane.press({ key: 'refresh' })
  expect(seen.jj.filter(kind => kind === 'log').length).toBe(before + 1)

  await pane.unmount()
})

test('番の終わりは作業コピーを記録してから数える。Bash の後は記録せずに数える', async ($, on) => {
  const seen = world(on, { changed: 'M a.ts\n' })

  await $.tool.call({ tool: 'Bash', command: 'jj st' })
  expect(seen.jj.slice().sort()).toEqual(['changed', 'unpushed'])

  seen.jj.length = 0
  await $.turn.complete(END)
  // 記録する実行が先。その後に、記録後の状態で未 push を数える
  expect(seen.jj).toEqual(['changed!', 'unpushed'])
})

test('Bash 以外のツールの後は、jj も gh も実行しない', async ($, on) => {
  const seen = world(on, PRS)

  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  expect(seen.jj).toEqual([])
  expect(seen.queried).toEqual([])
})

const LOG_PANES: { name: string; panes: string[]; reads: number }[] = [
  { name: 'ログの pane を開いているあいだは、番の終わりにログも読み直す', panes: ['jj-log'], reads: 1 },
  { name: 'ログの pane を開いていなければ、番の終わりにログは読まない', panes: [], reads: 0 },
  { name: 'PR の pane だけを開いていても、番の終わりにログは読まない', panes: ['pull-requests'], reads: 0 },
]

for (const one of LOG_PANES) {
  test(one.name, async ($, on) => {
    const seen = world(on, { panes: one.panes })
    await $.turn.complete(END)

    expect(seen.jj.filter(kind => kind === 'log').length).toBe(one.reads)
  })
}

test('すべて push 済みなら、pane に push のボタンは出ない', async ($, on) => {
  world(on, { log: 'cccccccc\t\tpushed\t\tmain\t7 hours ago\tfix: push済みの変更' })
  await $.turn.complete(END)
  const band = await $.ui.mount(line(140))
  await band.press({ key: 'log' })
  await band.unmount()

  const pane = await $.ui.mount(logPane)
  expect(await pane.find({ key: 'refresh' })).toBeDefined()
  expect(await pane.find({ key: 'push' })).toBeUndefined()
  await pane.unmount()
})
