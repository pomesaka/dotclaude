import { expect, test } from 'claude-code/testing'
import { END, line, logPane, world } from './world'

test('未コミットと未 push があれば、件数と 2 つのボタンが出る。下の層の表示は残す', async ($, on) => {
  const seen = world(on, { unpushed: 'x\nx\n', changed: 'M a.ts\n' })
  await $.turn.complete(END)
  const ui = await $.ui.mount(line)

  expect(await ui.find({ type: 'Text', text: /^●$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^↑$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'log' })).toBeDefined()
  // commit はすぐ実行する
  await ui.press({ key: 'commit' })
  expect(seen.commands).toEqual(['jjcommit'])

  await ui.unmount()
})

test('コマンドをすぐ実行できなかったら、入力欄に入れて知らせる', async ($, on) => {
  const seen = world(on, { changed: 'M a.ts\n', runsCommands: false })
  await $.turn.complete(END)
  const ui = await $.ui.mount(line)

  await ui.press({ key: 'commit' })
  expect(seen.filled).toEqual(['/jjcommit'])
  expect(seen.toasts.length).toBe(1)

  await ui.unmount()
})

test('まだ数えていないときは、下の層の表示だけを描く', async ($, on) => {
  world(on)
  const ui = await $.ui.mount(line)

  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'log' })).toBeUndefined()

  await ui.unmount()
})

test('jj のリポジトリの外では、件数もボタンも出ない。下の層の表示は残す', async ($, on) => {
  world(on, { jjExitCode: 1 })
  await $.turn.complete(END)
  const ui = await $.ui.mount(line)

  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  expect(await ui.find({ key: 'commit' })).toBeUndefined()
  expect(await ui.find({ key: 'log' })).toBeUndefined()

  await ui.unmount()
})

test('未コミットが無ければ、コミットのボタンは出ない。log は出る', async ($, on) => {
  world(on, { unpushed: 'x\n' })
  await $.turn.complete(END)
  const ui = await $.ui.mount(line)

  expect(await ui.find({ key: 'log' })).toBeDefined()
  expect(await ui.find({ key: 'commit' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^●$/ })).toBeUndefined()

  await ui.unmount()
})

test('log を押すと、ログを読んでから pane を開く。pane には 3 種類の印が出る', async ($, on) => {
  const seen = world(on, { unpushed: 'x\n' })
  await $.turn.complete(END)
  const hint = await $.ui.mount(line)
  await hint.press({ key: 'log' })
  expect(seen.opened).toEqual(['jj-log'])
  await hint.unmount()

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

test('Bash 以外のツールの後は、jj を実行しない', async ($, on) => {
  const seen = world(on)

  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  expect(seen.jj).toEqual([])
})

const LOG_PANES: { name: string; panes: string[]; reads: number }[] = [
  { name: 'ログの pane を開いているあいだは、番の終わりにログも読み直す', panes: ['jj-log'], reads: 1 },
  { name: 'ログの pane を開いていなければ、番の終わりにログは読まない', panes: [], reads: 0 },
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
  const hint = await $.ui.mount(line)
  await hint.press({ key: 'log' })
  await hint.unmount()

  const pane = await $.ui.mount(logPane)
  expect(await pane.find({ key: 'refresh' })).toBeDefined()
  expect(await pane.find({ key: 'push' })).toBeUndefined()
  await pane.unmount()
})
