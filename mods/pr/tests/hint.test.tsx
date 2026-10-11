import { expect, test } from 'claude-code/testing'
import { START, line, prUrl, view, world } from './world'

// 保存の並びは、末尾がいちばん新しい。プロンプトの下の行には 14、13、12、11 の順で出る
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
  test(`幅 ${one.width} の行には、最後に触った PR を ${one.shown.length} つ出す。下の層の表示は残す`, async ($, on) => {
    world(on, PRS)
    await $.session.start(START)
    const ui = await $.ui.mount(line(one.width))

    for (const number of one.shown) expect(await ui.find({ type: 'Text', text: new RegExp(`^#${number}$`) })).toBeDefined()
    for (const number of one.hidden) expect(await ui.find({ type: 'Text', text: new RegExp(`^#${number}$`) })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
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

test('pr を押すと、一覧の pane を開き、状態を取り直す', async ($, on) => {
  const seen = world(on, PRS)
  await $.session.start(START)
  seen.queried.length = 0
  const ui = await $.ui.mount(line(140))

  await ui.press({ key: 'pr' })
  expect(seen.opened).toEqual(['pull-requests'])
  // マージ済みの 12 は問い合わせに入れない
  expect(seen.queried).toEqual([[prUrl(14), prUrl(13), prUrl(11)]])
  await ui.unmount()
})

test('PR が無ければ、番号も pr のボタンも出ない。下の層の表示は残す', async ($, on) => {
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(line(140))

  expect(await ui.find({ key: 'pr' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^#\d+$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ENGINE$/ })).toBeDefined()
  await ui.unmount()
})

test('Bash 以外のツールの後は、gh を実行しない', async ($, on) => {
  const seen = world(on, PRS)

  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  expect(seen.queried).toEqual([])
})
