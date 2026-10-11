import { expect, test } from 'claude-code/testing'
import { END, START, operated, prPane, prUrl, shortPrPane, view, world } from './world'

const PR_2 = prUrl(2)
const PR_3 = prUrl(3, 'o/other')

test('gh pr create の後、PR を覚えて状態を取り、pane を開く', async ($, on) => {
  const seen = world(on, { bash: operated(2, 'created'), views: { [PR_2]: view('feat: 一覧を出す', 'OPEN') } })

  await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
  expect(seen.store.get('prs:s1')).toEqual([PR_2])
  expect(seen.queried).toEqual([[PR_2]])
  expect(seen.opened).toEqual(['pull-requests'])
  expect(seen.toasts).toEqual([])

  const ui = await $.ui.mount(prPane)
  expect(await ui.find({ type: 'Text', text: /^✓$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^feat: 一覧を出す$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^approved$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^open$/ })).toBeDefined()
  // リポジトリが 1 つなら、名前は出さない
  expect(await ui.find({ type: 'Text', text: /^o\/r$/ })).toBeUndefined()

  // 番号を押すと、ブラウザで開く
  await ui.press({ key: `open-${PR_2}` })
  expect(seen.ran).toEqual([['open', PR_2]])
  await ui.unmount()
})

test('pane を置けなかったら、開き方を toast で知らせる', async ($, on) => {
  const seen = world(on, { bash: operated(2, 'created'), views: { [PR_2]: view('x', 'OPEN') }, isPlaced: false })

  await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
  expect(seen.toasts.length).toBe(1)
})

// 一覧に PR_2 がある状態で Bash を実行する。queried は、gh を呼んだ回ごとに問い合わせた PR
const COMMANDS: { name: string; command: string; bash: unknown; stored: string[]; queried: string[][]; opened: string[] }[] = [
  { name: '関係の無いコマンドでは、GitHub を叩かない', command: 'ls', bash: { stdout: 'ok' }, stored: [PR_2], queried: [], opened: [] },
  {
    name: 'コミットだけでは、GitHub を叩かない',
    command: 'git commit -m x',
    bash: { stdout: '', gitOperation: { commit: { sha: 'abc', kind: 'committed' } } },
    stored: [PR_2],
    queried: [],
    opened: [],
  },
  { name: '別の PR にコメントしただけでは、足さないし叩かない', command: 'gh pr comment 9', bash: operated(9, 'commented'), stored: [PR_2], queried: [], opened: [] },
  { name: 'jj git push の後は、取り直す', command: 'jj git push -b feat/x', bash: { stdout: '' }, stored: [PR_2], queried: [[PR_2]], opened: [] },
  { name: 'git push の後は、取り直す', command: 'git push', bash: { stdout: '', gitOperation: { push: { branch: 'feat/x' } } }, stored: [PR_2], queried: [[PR_2]], opened: [] },
  { name: '一覧の PR にコメントすると、取り直す', command: 'gh pr comment 2', bash: operated(2, 'commented'), stored: [PR_2], queried: [[PR_2]], opened: [] },
  // すでに一覧にあったので、pane は開かない
  { name: '一覧の PR を直すと、取り直す', command: 'gh pr edit 2', bash: operated(2, 'edited'), stored: [PR_2], queried: [[PR_2]], opened: [] },
  // 引き継いだ PR。新しいほうが先頭なので、問い合わせも 4、2 の順になる
  { name: '一覧に無い PR を直すと、一覧に入って pane が開く', command: 'gh pr edit 4', bash: operated(4, 'edited'), stored: [PR_2, prUrl(4)], queried: [[prUrl(4), PR_2]], opened: ['pull-requests'] },
]

for (const one of COMMANDS) {
  test(`Bash の後: ${one.name}`, async ($, on) => {
    const seen = world(on, { bash: one.bash, stored: { 'prs:s1': [PR_2] }, views: { [PR_2]: view('a', 'OPEN'), [prUrl(4)]: view('b', 'OPEN') } })

    await $.tool.call({ tool: 'Bash', command: one.command })
    expect(seen.store.get('prs:s1')).toEqual(one.stored)
    expect(seen.queried).toEqual(one.queried)
    expect(seen.opened).toEqual(one.opened)
  })
}

test('一覧が空なら、push の後も GitHub を叩かない', async ($, on) => {
  const seen = world(on, { bash: { stdout: '' } })

  await $.tool.call({ tool: 'Bash', command: 'jj git push' })
  expect(seen.queried).toEqual([])
})

test('覚えている PR を直すと、その PR が一覧の先頭に上がる', async ($, on) => {
  const seen = world(on, {
    bash: operated(2, 'edited'),
    stored: { 'prs:s1': [PR_2, prUrl(4)] },
    views: { [PR_2]: view('a', 'OPEN'), [prUrl(4)]: view('b', 'OPEN') },
  })

  await $.tool.call({ tool: 'Bash', command: 'gh pr edit 2' })
  // 保存の並びは、末尾がいちばん新しい
  expect(seen.store.get('prs:s1')).toEqual([prUrl(4), PR_2])
})

test('ターンの終わりには、GitHub を叩かない', async ($, on) => {
  const seen = world(on, { stored: { 'prs:s1': [PR_2] }, views: { [PR_2]: view('a', 'OPEN') } })

  await $.turn.complete(END)
  expect(seen.queried).toEqual([])
})

test('開き直したセッションでは、覚えている PR を 1 回の呼び出しで戻す。別のセッションの PR は出さない', async ($, on) => {
  const seen = world(on, {
    stored: { 'prs:s1': [PR_2, PR_3], 'prs:other': [prUrl(8)] },
    views: { [PR_2]: view('feat: a', 'OPEN', 'FAILURE'), [PR_3]: view('fix: b', 'MERGED') },
  })

  await $.session.start(START)
  // リポジトリが 2 つあっても、gh を呼ぶのは 1 回
  expect(seen.queried).toEqual([[PR_3, PR_2]])

  const ui = await $.ui.mount(prPane)
  expect(await ui.find({ type: 'Text', text: /^✗$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#3$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^merged$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#8$/ })).toBeUndefined()
  // リポジトリが 2 つあるので、名前を出す
  expect(await ui.find({ type: 'Text', text: /^o\/other$/ })).toBeDefined()
  await ui.unmount()
})

test('r を押すと取り直す。マージ済みの PR は問い合わせに入れない', async ($, on) => {
  const seen = world(on, {
    stored: { 'prs:s1': [PR_2, PR_3] },
    views: { [PR_2]: view('feat: a', 'OPEN'), [PR_3]: view('fix: b', 'MERGED') },
  })
  await $.session.start(START)
  seen.queried.length = 0

  const ui = await $.ui.mount(prPane)
  await ui.press({ key: 'refresh' })
  expect(seen.queried).toEqual([[PR_2]])
  await ui.unmount()
})

test('開いていた PR がマージされたと分かったら、Claude に 1 回だけ知らせる', async ($, on) => {
  const views = { [PR_2]: view('feat: a', 'OPEN'), [prUrl(4)]: view('fix: b', 'OPEN') }
  const seen = world(on, { stored: { 'prs:s1': [PR_2, prUrl(4)] }, views })
  await $.session.start(START)
  expect(seen.submitted).toEqual([])

  // GitHub の画面でマージされた。次に取り直したときに気づく
  views[PR_2] = view('feat: a', 'MERGED')
  const ui = await $.ui.mount(prPane)
  await ui.press({ key: 'refresh' })
  expect(seen.submitted).toEqual([`PR #2「feat: a」がマージされました（${PR_2}）`])

  // もう一度取り直しても、同じ PR は知らせない
  await ui.press({ key: 'refresh' })
  expect(seen.submitted.length).toBe(1)
  await ui.unmount()
})

test('開き直したセッションで、すでにマージ済みだった PR は知らせない', async ($, on) => {
  const seen = world(on, { stored: { 'prs:s1': [PR_2] }, views: { [PR_2]: view('feat: a', 'MERGED') } })

  await $.session.start(START)
  expect(seen.submitted).toEqual([])
})

test('Claude が gh pr merge でマージした PR は知らせない', async ($, on) => {
  const views = { [PR_2]: view('feat: a', 'OPEN') }
  const seen = world(on, { bash: operated(2, 'merged'), stored: { 'prs:s1': [PR_2] }, views })
  await $.session.start(START)

  views[PR_2] = view('feat: a', 'MERGED')
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 2' })
  await $.turn.complete(END)
  expect(seen.submitted).toEqual([])
})

test('push の後にマージに気づいたら、ターンの終わりに 1 回だけ知らせる', async ($, on) => {
  const views = { [PR_2]: view('feat: a', 'OPEN') }
  const seen = world(on, { bash: { stdout: '' }, stored: { 'prs:s1': [PR_2] }, views })
  await $.session.start(START)

  views[PR_2] = view('feat: a', 'MERGED')
  await $.tool.call({ tool: 'Bash', command: 'jj git push' })
  // WHY すぐには送らない: tool.call の hook から送ると、エンジンに拒まれる。ターンの終わりまで溜める
  expect(seen.submitted).toEqual([])
  expect(seen.toasts).toEqual([])

  await $.turn.complete(END)
  expect(seen.submitted).toEqual([`PR #2「feat: a」がマージされました（${PR_2}）`])

  // 次のターンの終わりには、もう送らない
  await $.turn.complete(END)
  expect(seen.submitted.length).toBe(1)
})

const TRACK = 'mcp__pr__track_pr'

test('track_pr で、Claude が PR を一覧に足す', async ($, on) => {
  const seen = world(on, { stored: { 'prs:s1': [PR_2] }, views: { [PR_2]: view('a', 'OPEN'), [prUrl(7)]: view('b', 'OPEN', 'FAILURE') } })

  const called = await $.tool.call({ tool: TRACK, url: `${prUrl(7)}/files` })
  expect(called.result).toBe('PR #7 (o/r) is on the list: open, checks failing.')
  expect(seen.store.get('prs:s1')).toEqual([PR_2, prUrl(7)])
  expect(seen.queried).toEqual([[prUrl(7), PR_2]])
  expect(seen.opened).toEqual(['pull-requests'])
})

test('track_pr で、すでに一覧にある PR を足しても、pane は開かない', async ($, on) => {
  const seen = world(on, { stored: { 'prs:s1': [PR_2] }, views: { [PR_2]: view('a', 'OPEN') } })

  const called = await $.tool.call({ tool: TRACK, url: PR_2 })
  expect(called.result).toBe('PR #2 (o/r) is on the list: open, checks passing.')
  expect(seen.store.get('prs:s1')).toEqual([PR_2])
  expect(seen.opened).toEqual([])
})

test('track_pr は、状態を読めなかったことを Claude に伝える', async ($, on) => {
  world(on, {})

  const called = await $.tool.call({ tool: TRACK, url: PR_2 })
  expect(called.result).toBe('PR #2 (o/r) is on the list, but its state could not be read. Check the URL and that gh is signed in.')
})

test('track_pr は、PR の url でない入力を拒む', async ($, on) => {
  const seen = world(on, {})

  const called = await $.tool.call({ tool: TRACK, url: 'https://github.com/o/r/issues/2' })
  expect(called.deny).toBe('track_pr failed: url must look like https://github.com/<owner>/<repo>/pull/<number>')
  expect(seen.store.get('prs:s1')).toBeUndefined()
})

// 見張りを始めるか。periods は、タイマーが頼んだ待ち時間
const WATCH_STARTS: { name: string; command: string; bash: unknown; rollup: string; periods: number[] }[] = [
  { name: '実行中の CI がある PR を取り直したら、1 分おきの見張りを始める', command: 'gh pr edit 2', bash: operated(2, 'edited'), rollup: 'PENDING', periods: [60_000] },
  { name: '実行中の CI が無ければ、見張らない', command: 'gh pr edit 2', bash: operated(2, 'edited'), rollup: 'SUCCESS', periods: [] },
  // push の直後は、新しいコミットの CI がまだ現れていないことがある
  { name: 'push の後は、実行中の CI が見えていなくても見張りを始める', command: 'jj git push', bash: { stdout: '' }, rollup: 'SUCCESS', periods: [60_000] },
]

for (const one of WATCH_STARTS) {
  test(`見張り: ${one.name}`, async ($, on) => {
    const seen = world(on, { bash: one.bash, stored: { 'prs:s1': [PR_2] }, views: { [PR_2]: view('a', 'OPEN', one.rollup) } })

    await $.tool.call({ tool: 'Bash', command: one.command })
    expect(seen.periods).toEqual(one.periods)
  })
}

test('見張りは 1 周期ごとに取り直し、CI が終わったらやめる', async ($, on) => {
  const views = { [PR_2]: view('a', 'OPEN', 'PENDING') }
  const seen = world(on, { stored: { 'prs:s1': [PR_2] }, views })
  await $.session.start(START)
  expect(seen.queried.length).toBe(1)

  // 1 周期め。まだ実行中
  seen.tick()
  const running = await $.ui.mount(prPane)
  expect(seen.queried.length).toBe(2)
  expect(await running.find({ type: 'Text', text: /^●$/ })).toBeDefined()
  await running.unmount()

  // 2 周期め。CI が通った。実行中の PR が無くなったので、ここでやめる
  views[PR_2] = view('a', 'OPEN', 'SUCCESS')
  seen.tick()
  const passed = await $.ui.mount(prPane)
  expect(seen.queried.length).toBe(3)
  expect(await passed.find({ type: 'Text', text: /^✓$/ })).toBeDefined()
  await passed.unmount()

  // やめた後は、時間が進んでも取り直さない
  seen.tick()
  const idle = await $.ui.mount(prPane)
  expect(seen.queried.length).toBe(3)
  await idle.unmount()
})

test('見張りのあいだに CI が失敗したら、その場で 1 回だけ知らせる', async ($, on) => {
  const views = { [PR_2]: view('feat: a', 'OPEN', 'PENDING') }
  const seen = world(on, { stored: { 'prs:s1': [PR_2] }, views })
  await $.session.start(START)

  views[PR_2] = view('feat: a', 'OPEN', 'FAILURE')
  seen.tick()
  const failed = await $.ui.mount(prPane)
  expect(seen.submitted).toEqual([`PR #2「feat: a」の CI が失敗しました（${PR_2}）`])
  await failed.unmount()

  // 失敗したままなら、取り直しても知らせない
  const ui = await $.ui.mount(prPane)
  await ui.press({ key: 'refresh' })
  expect(seen.submitted.length).toBe(1)
  await ui.unmount()
})

test('開き直したセッションで、すでに CI が失敗していた PR は知らせない', async ($, on) => {
  const seen = world(on, { stored: { 'prs:s1': [PR_2] }, views: { [PR_2]: view('feat: a', 'OPEN', 'FAILURE') } })

  await $.session.start(START)
  expect(seen.submitted).toEqual([])
})

test('push の後に CI の失敗に気づいたら、ターンの終わりに知らせる', async ($, on) => {
  const views = { [PR_2]: view('feat: a', 'OPEN', 'PENDING') }
  const seen = world(on, { bash: { stdout: '' }, stored: { 'prs:s1': [PR_2] }, views })
  await $.session.start(START)

  views[PR_2] = view('feat: a', 'OPEN', 'FAILURE')
  await $.tool.call({ tool: 'Bash', command: 'jj git push' })
  expect(seen.submitted).toEqual([])

  await $.turn.complete(END)
  expect(seen.submitted).toEqual([`PR #2「feat: a」の CI が失敗しました（${PR_2}）`])
})

test('見張りのあいだにマージに気づいたら、その場で知らせる', async ($, on) => {
  const views = { [PR_2]: view('feat: a', 'OPEN', 'PENDING') }
  const seen = world(on, { stored: { 'prs:s1': [PR_2] }, views })
  await $.session.start(START)

  views[PR_2] = view('feat: a', 'MERGED')
  seen.tick()
  const ui = await $.ui.mount(prPane)
  expect(seen.submitted).toEqual([`PR #2「feat: a」がマージされました（${PR_2}）`])
  await ui.unmount()
})

test('CI が失敗した PR の下に、落ちたチェックの名前を出す', async ($, on) => {
  world(on, {
    stored: { 'prs:s1': [PR_2, prUrl(4)] },
    views: { [PR_2]: view('feat: a', 'OPEN', 'FAILURE', ['Rust lint', 'test']), [prUrl(4)]: view('fix: b', 'OPEN') },
  })
  await $.session.start(START)

  const ui = await $.ui.mount(prPane)
  expect(await ui.find({ type: 'Text', text: /^    Rust lint, test$/ })).toBeDefined()
  // 成功したチェックの名前は出さない
  expect(await ui.find({ type: 'Text', text: /build/ })).toBeUndefined()
  await ui.unmount()
})

test('マージ済みの PR には、落ちたチェックの名前を出さない', async ($, on) => {
  world(on, { stored: { 'prs:s1': [PR_2] }, views: { [PR_2]: view('feat: a', 'MERGED', 'FAILURE', ['Rust lint']) } })
  await $.session.start(START)

  const ui = await $.ui.mount(prPane)
  expect(await ui.find({ type: 'Text', text: /^merged$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Rust lint/ })).toBeUndefined()
  await ui.unmount()
})

test('× を押すと、その PR を一覧からも保存からも外す。GitHub は叩かない', async ($, on) => {
  const seen = world(on, {
    stored: { 'prs:s1': [PR_2, prUrl(4)] },
    views: { [PR_2]: view('feat: a', 'OPEN'), [prUrl(4)]: view('fix: b', 'OPEN') },
  })
  await $.session.start(START)
  seen.queried.length = 0

  const ui = await $.ui.mount(prPane)
  await ui.press({ key: `drop-${PR_2}` })
  expect(seen.store.get('prs:s1')).toEqual([prUrl(4)])
  expect(seen.queried).toEqual([])
  await ui.unmount()

  const after = await $.ui.mount(prPane)
  expect(await after.find({ type: 'Text', text: /^#4$/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /^#2$/ })).toBeUndefined()
  await after.unmount()
})

test('j と k で PR を選び、o で開き、y で URL をコピーし、x で外す', async ($, on) => {
  const seen = world(on, {
    // 一覧には 4、2 の順で出る
    stored: { 'prs:s1': [PR_2, prUrl(4)] },
    views: { [PR_2]: view('feat: a', 'OPEN'), [prUrl(4)]: view('fix: b', 'OPEN') },
  })
  await $.session.start(START)
  const ui = await $.ui.mount(prPane)

  // 最初は先頭（#4）を選んでいる
  await ui.press({ key: 'open' })
  expect(seen.ran).toEqual([['open', prUrl(4)]])

  // j で 1 つ下（#2）へ
  await ui.press({ key: 'down' })
  await ui.press({ key: 'copy' })
  expect(seen.copied).toEqual([PR_2])

  // 末尾では、j を押しても動かない
  await ui.press({ key: 'down' })
  await ui.press({ key: 'copy' })
  expect(seen.copied).toEqual([PR_2, PR_2])

  // k で戻って、x で外す
  await ui.press({ key: 'up' })
  await ui.press({ key: 'drop' })
  expect(seen.store.get('prs:s1')).toEqual([PR_2])
  await ui.unmount()
})

test('一覧が pane より長くても、キーのヒントは流れずに残る。はみ出した分は件数で出す', async ($, on) => {
  // 開いている PR が 12 件。保存の末尾がいちばん新しいので、一覧は #12 から #1 の順
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  world(on, {
    stored: { 'prs:s1': numbers.map(number => prUrl(number)) },
    views: Object.fromEntries(numbers.map(number => [prUrl(number), view(`pr ${number}`, 'OPEN')])),
  })
  await $.session.start(START)
  // 見えている行は 12。一覧の外（凡例、ヒント、空き、あと N 件）を引いた 4 行に、PR を並べる
  const ui = await $.ui.mount(shortPrPane)

  expect(await ui.find({ type: 'Text', text: /^#12$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#9$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#8$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^  ↓ あと 8 件$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↑ あと/ })).toBeUndefined()
  expect(await ui.find({ key: 'down' })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeDefined()

  // 下へ動くと、選んでいる行のまわりに描き直す
  for (const _ of [1, 2, 3, 4, 5]) await ui.press({ key: 'down' })
  expect(await ui.find({ type: 'Text', text: /^#7$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#12$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /↑ あと/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↓ あと/ })).toBeDefined()
  expect(await ui.find({ key: 'down' })).toBeDefined()
  await ui.unmount()
})

test('終わった PR は新しい 3 つだけ残し、古いものは一覧からも保存からも消す', async ($, on) => {
  const seen = world(on, {
    // 末尾がいちばん新しい。1 は開いたまま、2 から 6 は終わっている
    stored: { 'prs:s1': [prUrl(1), prUrl(2), prUrl(3), prUrl(4), prUrl(5), prUrl(6)] },
    views: {
      [prUrl(1)]: view('open', 'OPEN'),
      [prUrl(2)]: view('old', 'MERGED'),
      [prUrl(3)]: view('old', 'CLOSED'),
      [prUrl(4)]: view('done', 'MERGED'),
      [prUrl(5)]: view('done', 'CLOSED'),
      [prUrl(6)]: view('done', 'MERGED'),
    },
  })

  await $.session.start(START)
  expect(seen.store.get('prs:s1')).toEqual([prUrl(1), prUrl(4), prUrl(5), prUrl(6)])

  const ui = await $.ui.mount(prPane)
  expect(await ui.find({ type: 'Text', text: /^#6$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#3$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^#2$/ })).toBeUndefined()
  await ui.unmount()
})

test('状態を取れなかった PR は、取れていないと出す', async ($, on) => {
  world(on, { stored: { 'prs:s1': [PR_2] } })

  await $.session.start(START)
  const ui = await $.ui.mount(prPane)
  expect(await ui.find({ type: 'Text', text: /^#2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^状態を取れていません$/ })).toBeDefined()
  await ui.unmount()
})

test('PR が無ければ、作り方を出す', async ($, on) => {
  world(on)

  const ui = await $.ui.mount(prPane)
  expect(await ui.find({ type: 'Text', text: /まだありません/ })).toBeDefined()
  expect(await ui.find({ key: 'refresh' })).toBeDefined()
  await ui.unmount()
})
