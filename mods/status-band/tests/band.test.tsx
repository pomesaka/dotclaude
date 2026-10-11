import { expect, test } from 'claude-code/testing'
import { END, line, world } from './world'

test('広い行には、モデル、コンテキスト、場所が出る。元の表示も残る', async ($, on) => {
  world(on)
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

test('ツールの後に、コンテキストを読み直す', async ($, on) => {
  const seen = world(on)

  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  expect(seen.usageReads).toBe(1)
})
