import { expect, test } from 'claude-code/testing'
import {
  adoptedPrOf,
  hasPendingChecks,
  isMerge,
  isPush,
  keepsWatching,
  newlyFailed,
  newlyMerged,
  noticeOf,
  parsePrUrl,
  parseStatuses,
  pruneDone,
  refsOf,
  requestedPrOf,
  statusArgv,
  touchRef,
  touchedRefOf,
} from '../hooks/pr'
import type { PrRef, PrRow, PrStatus } from '../types'

const PR_2: PrRef = { url: 'https://github.com/o/r/pull/2', repo: 'o/r', number: 2 }
const PR_3: PrRef = { url: 'https://github.com/o/r/pull/3', repo: 'o/r', number: 3 }
const PR_4: PrRef = { url: 'https://github.com/o/r/pull/4', repo: 'o/r', number: 4 }
const OTHER_2: PrRef = { url: 'https://github.com/o/other/pull/2', repo: 'o/other', number: 2 }

const URLS: { url: string; ref: PrRef | null }[] = [
  { url: 'https://github.com/o/r/pull/2', ref: PR_2 },
  { url: 'https://github.com/o/r/pull/2/files', ref: PR_2 },
  { url: 'https://github.com/o/r/pull/2?x=1#y', ref: PR_2 },
  { url: 'https://github.com/o/r/pull/0', ref: null },
  { url: 'https://github.com/o/r/pull/2x', ref: null },
  { url: 'https://github.com/o/r/issues/2', ref: null },
  { url: 'https://example.com/o/r/pull/2', ref: null },
  { url: 'http://github.com/o/r/pull/2', ref: null },
  { url: 'see https://github.com/o/r/pull/2', ref: null },
  // 問い合わせに埋め込む文字列なので、引用符を含む名前は通さない
  { url: 'https://github.com/o"x/r/pull/2', ref: null },
  { url: 'https://github.com/o/r"){/pull/2', ref: null },
]

for (const one of URLS) {
  test(`parsePrUrl("${one.url}")`, async () => {
    expect(parsePrUrl(one.url)).toEqual(one.ref)
  })
}

const pr = (operation: unknown) => ({ stdout: '', gitOperation: { pr: operation } })

const at2 = (action: string) => pr({ number: 2, url: 'https://github.com/o/r/pull/2', action })

const RESULTS: { name: string; result: unknown; adopted: PrRef | null; merges: boolean }[] = [
  { name: '作った', result: at2('created'), adopted: PR_2, merges: false },
  { name: '直した', result: at2('edited'), adopted: PR_2, merges: false },
  { name: 'レビュー可能にした', result: at2('ready'), adopted: PR_2, merges: false },
  { name: 'ドラフトに戻した', result: at2('draft'), adopted: PR_2, merges: false },
  { name: 'コメントした', result: at2('commented'), adopted: null, merges: false },
  { name: 'マージした', result: at2('merged'), adopted: null, merges: true },
  { name: '自動マージを有効にした（まだマージされていない）', result: at2('auto-merge-enabled'), adopted: null, merges: false },
  { name: '閉じた', result: at2('closed'), adopted: null, merges: false },
  { name: '作ったが url が無い', result: pr({ number: 2, action: 'created' }), adopted: null, merges: false },
  { name: '作ったが url が PR のものでない', result: pr({ number: 2, url: 'https://example.com/x', action: 'created' }), adopted: null, merges: false },
  { name: 'コミットだけ', result: { stdout: '', gitOperation: { commit: { sha: 'abc', kind: 'committed' } } }, adopted: null, merges: false },
  { name: 'git の操作が無い', result: { stdout: '', gitOperation: undefined }, adopted: null, merges: false },
  { name: '結果が文字列', result: 'done', adopted: null, merges: false },
  { name: '結果が null', result: null, adopted: null, merges: false },
]

for (const one of RESULTS) {
  test(`Bash の結果: ${one.name}`, async () => {
    expect(adoptedPrOf(one.result)).toEqual(one.adopted)
    expect(isMerge(one.result)).toBe(one.merges)
  })
}

const TOUCHED: { name: string; result: unknown; refs: PrRef[]; ref: PrRef | null }[] = [
  { name: 'url で見つける', result: pr({ number: 3, url: 'https://github.com/o/r/pull/3', action: 'edited' }), refs: [PR_2, PR_3], ref: PR_3 },
  { name: 'url が無ければ番号で見つける', result: pr({ number: 2, action: 'closed' }), refs: [PR_2, PR_3], ref: PR_2 },
  { name: '覚えていない PR', result: pr({ number: 4, url: 'https://github.com/o/r/pull/4', action: 'edited' }), refs: [PR_2, PR_3], ref: null },
  { name: '番号が同じでも、url が違えば別の PR', result: pr({ number: 2, url: 'https://github.com/o/other/pull/2', action: 'edited' }), refs: [PR_2], ref: null },
  { name: '同じ番号が 2 つあると、番号だけでは決めない', result: pr({ number: 2, action: 'closed' }), refs: [PR_2, OTHER_2], ref: null },
  { name: 'PR への操作でない', result: { stdout: '' }, refs: [PR_2], ref: null },
]

for (const one of TOUCHED) {
  test(`touchedRefOf: ${one.name}`, async () => {
    expect(touchedRefOf(one.result, one.refs)).toEqual(one.ref)
  })
}

const PUSHES: { name: string; command: string; result: unknown; pushed: boolean }[] = [
  { name: 'jj git push', command: 'jj git push --bookmark feat/x', result: { stdout: '' }, pushed: true },
  { name: 'jj と git push のあいだに引数がある', command: 'jj -R /repo git push', result: { stdout: '' }, pushed: true },
  { name: 'git push は gitOperation.push で分かる', command: 'git push', result: { stdout: '', gitOperation: { push: { branch: 'feat/x' } } }, pushed: true },
  { name: 'jj git fetch', command: 'jj git fetch', result: { stdout: '' }, pushed: false },
  { name: '別のコマンドの git push とはつなげない', command: 'jj st; echo git push', result: { stdout: '' }, pushed: false },
  { name: 'コミットだけ', command: 'git commit -m x', result: { stdout: '', gitOperation: { commit: { sha: 'abc', kind: 'committed' } } }, pushed: false },
  { name: '関係の無いコマンド', command: 'ls', result: { stdout: '' }, pushed: false },
]

for (const one of PUSHES) {
  test(`isPush: ${one.name}`, async () => {
    expect(isPush(one.command, one.result)).toBe(one.pushed)
  })
}

const STORED: { name: string; stored: unknown; refs: PrRef[] }[] = [
  { name: 'url の配列', stored: ['https://github.com/o/r/pull/2', 'https://github.com/o/r/pull/3'], refs: [PR_2, PR_3] },
  { name: '読めない値は飛ばす', stored: ['https://github.com/o/r/pull/2', 7, 'x'], refs: [PR_2] },
  { name: 'まだ無い', stored: undefined, refs: [] },
  { name: '配列でない', stored: 'https://github.com/o/r/pull/2', refs: [] },
]

for (const one of STORED) {
  test(`refsOf: ${one.name}`, async () => {
    expect(refsOf(one.stored)).toEqual(one.refs)
  })
}

const TOUCHES: { name: string; refs: PrRef[]; ref: PrRef; max: number; touched: PrRef[] }[] = [
  { name: '新しい PR は末尾に足す', refs: [PR_2], ref: PR_3, max: 5, touched: [PR_2, PR_3] },
  { name: '覚えている PR は末尾に移す', refs: [PR_2, PR_3], ref: PR_2, max: 5, touched: [PR_3, PR_2] },
  { name: 'すでに末尾なら変わらない', refs: [PR_2, PR_3], ref: PR_3, max: 5, touched: [PR_2, PR_3] },
  { name: '上限を超えたら、長く触っていないものを落とす', refs: [PR_2, PR_3], ref: PR_4, max: 2, touched: [PR_3, PR_4] },
]

for (const one of TOUCHES) {
  test(`touchRef: ${one.name}`, async () => {
    expect(touchRef(one.refs, one.ref, one.max)).toEqual(one.touched)
  })
}

const row = (number: number, state: 'open' | 'closed' | 'merged' | null): PrRow => ({
  url: `https://github.com/o/r/pull/${number}`,
  repo: 'o/r',
  number,
  status: state === null ? null : { title: 'x', state, isDraft: false, checks: null, failedChecks: [], review: null },
})

// 並びは、最後に触った PR が先頭
const PRUNES: { name: string; rows: PrRow[]; max: number; kept: number[] }[] = [
  { name: '終わった PR が上限以下なら消さない', rows: [row(5, 'merged'), row(4, 'open'), row(3, 'closed')], max: 2, kept: [5, 4, 3] },
  { name: '上限を超えた、古い終わった PR を消す', rows: [row(5, 'merged'), row(4, 'merged'), row(3, 'merged'), row(2, 'merged')], max: 2, kept: [5, 4] },
  { name: '閉じた PR も、終わった PR に数える', rows: [row(5, 'closed'), row(4, 'merged'), row(3, 'closed')], max: 2, kept: [5, 4] },
  { name: '開いている PR は、古くても消さない', rows: [row(5, 'merged'), row(4, 'merged'), row(3, 'open'), row(2, 'merged'), row(1, 'open')], max: 2, kept: [5, 4, 3, 1] },
  { name: '状態を取れていない PR は消さない', rows: [row(5, 'merged'), row(4, null), row(3, 'merged'), row(2, null)], max: 1, kept: [5, 4, 2] },
  { name: '空', rows: [], max: 2, kept: [] },
]

for (const one of PRUNES) {
  test(`pruneDone: ${one.name}`, async () => {
    expect(pruneDone(one.rows, one.max).map(kept => kept.number)).toEqual(one.kept)
  })
}

// before と after は、PR の番号と状態の組。番号が同じものが同じ PR
const MERGES: { name: string; before: PrRow[]; after: PrRow[]; merged: number[] }[] = [
  { name: '開いていた PR がマージされた', before: [row(5, 'open'), row(4, 'open')], after: [row(5, 'merged'), row(4, 'open')], merged: [5] },
  { name: '2 つ同時にマージされた', before: [row(5, 'open'), row(4, 'open')], after: [row(5, 'merged'), row(4, 'merged')], merged: [5, 4] },
  { name: '前からマージ済みだった', before: [row(5, 'merged')], after: [row(5, 'merged')], merged: [] },
  { name: '前の状態を取れていなかった', before: [row(5, null)], after: [row(5, 'merged')], merged: [] },
  { name: '前の一覧に無かった（開き直した直後）', before: [], after: [row(5, 'merged')], merged: [] },
  { name: '閉じただけ', before: [row(5, 'open')], after: [row(5, 'closed')], merged: [] },
  { name: '閉じていた PR がマージ済みになった', before: [row(5, 'closed')], after: [row(5, 'merged')], merged: [] },
]

for (const one of MERGES) {
  test(`newlyMerged: ${one.name}`, async () => {
    expect(newlyMerged(one.before, one.after).map(merged => merged.number)).toEqual(one.merged)
  })
}

const ci = (number: number, state: 'open' | 'closed' | 'merged', checks: 'passing' | 'failing' | 'pending' | null): PrRow => ({
  url: `https://github.com/o/r/pull/${number}`,
  repo: 'o/r',
  number,
  status: { title: 'x', state, isDraft: false, checks, failedChecks: [], review: null },
})

const FAILS: { name: string; before: PrRow[]; after: PrRow[]; failed: number[] }[] = [
  { name: '実行中だった CI が失敗した', before: [ci(5, 'open', 'pending')], after: [ci(5, 'open', 'failing')], failed: [5] },
  { name: '成功していた PR が、新しい push で失敗した', before: [ci(5, 'open', 'passing')], after: [ci(5, 'open', 'failing')], failed: [5] },
  { name: 'チェックが無かった PR に、失敗が付いた', before: [ci(5, 'open', null)], after: [ci(5, 'open', 'failing')], failed: [5] },
  { name: '失敗したままの PR は、もう知らせない', before: [ci(5, 'open', 'failing')], after: [ci(5, 'open', 'failing')], failed: [] },
  { name: '成功した', before: [ci(5, 'open', 'pending')], after: [ci(5, 'open', 'passing')], failed: [] },
  { name: '前の状態を取れていなかった', before: [row(5, null)], after: [ci(5, 'open', 'failing')], failed: [] },
  { name: '前の一覧に無かった（足した直後、開き直した直後）', before: [], after: [ci(5, 'open', 'failing')], failed: [] },
  { name: 'マージ済みの PR の CI が失敗しても知らせない', before: [ci(5, 'open', 'pending')], after: [ci(5, 'merged', 'failing')], failed: [] },
  { name: '閉じた PR の CI が失敗しても知らせない', before: [ci(5, 'open', 'pending')], after: [ci(5, 'closed', 'failing')], failed: [] },
]

for (const one of FAILS) {
  test(`newlyFailed: ${one.name}`, async () => {
    expect(newlyFailed(one.before, one.after).map(failed => failed.number)).toEqual(one.failed)
  })
}

const NOTICES: { name: string; merged: PrRow[]; failed: PrRow[]; text: string | null }[] = [
  { name: '知らせるものが無い', merged: [], failed: [], text: null },
  { name: 'マージ', merged: [row(5, 'merged')], failed: [], text: 'PR #5「x」がマージされました（https://github.com/o/r/pull/5）' },
  { name: 'CI の失敗', merged: [], failed: [ci(4, 'open', 'failing')], text: 'PR #4「x」の CI が失敗しました（https://github.com/o/r/pull/4）' },
  {
    name: '両方あれば、1 行ずつ並べる',
    merged: [row(5, 'merged')],
    failed: [ci(4, 'open', 'failing')],
    text: 'PR #5「x」がマージされました（https://github.com/o/r/pull/5）\nPR #4「x」の CI が失敗しました（https://github.com/o/r/pull/4）',
  },
]

for (const one of NOTICES) {
  test(`noticeOf: ${one.name}`, async () => {
    expect(noticeOf(one.merged, one.failed)).toBe(one.text)
  })
}

const REQUESTS: { name: string; input: unknown; ref: PrRef | null }[] = [
  { name: 'PR の url', input: { url: 'https://github.com/o/r/pull/2' }, ref: PR_2 },
  { name: '前後の空白と /files は落とす', input: { url: ' https://github.com/o/r/pull/2/files ' }, ref: PR_2 },
  { name: 'PR の url でない', input: { url: 'https://github.com/o/r/issues/2' }, ref: null },
  { name: '番号だけ', input: { url: '2' }, ref: null },
  { name: 'url が文字列でない', input: { url: 2 }, ref: null },
  { name: 'url が無い', input: {}, ref: null },
]

for (const one of REQUESTS) {
  test(`requestedPrOf: ${one.name}`, async () => {
    expect(requestedPrOf(one.input)).toEqual(one.ref)
  })
}

const checked = (number: number, state: 'open' | 'closed' | 'merged', checks: 'passing' | 'failing' | 'pending' | null): PrRow => ({
  url: `https://github.com/o/r/pull/${number}`,
  repo: 'o/r',
  number,
  status: { title: 'x', state, isDraft: false, checks, failedChecks: [], review: null },
})

const RUNNING = [checked(5, 'open', 'pending'), checked(4, 'open', 'passing')]
const SETTLED = [checked(5, 'open', 'passing'), checked(4, 'open', 'failing')]
const LIMITS = { max: 10, grace: 2 }

// ticks は、見張りを始めてから取り直した回数
const WATCHES: { name: string; rows: PrRow[]; ticks: number; pending: boolean; keeps: boolean }[] = [
  { name: '実行中の CI がある', rows: RUNNING, ticks: 3, pending: true, keeps: true },
  { name: '実行中の CI があっても、上限の回数でやめる', rows: RUNNING, ticks: 10, pending: true, keeps: false },
  { name: '上限の 1 回手前までは続ける', rows: RUNNING, ticks: 9, pending: true, keeps: true },
  { name: '実行中の CI が無くなったら、やめる', rows: SETTLED, ticks: 3, pending: false, keeps: false },
  { name: '始めた直後は、実行中の CI が無くても続ける（push の直後）', rows: SETTLED, ticks: 1, pending: false, keeps: true },
  { name: '猶予の回数に達したら、実行中の CI が無ければやめる', rows: SETTLED, ticks: 2, pending: false, keeps: false },
  { name: 'マージ済みの PR の CI は待たない', rows: [checked(5, 'merged', 'pending')], ticks: 3, pending: false, keeps: false },
  { name: '閉じた PR の CI は待たない', rows: [checked(5, 'closed', 'pending')], ticks: 3, pending: false, keeps: false },
  { name: '状態を取れていない PR は待たない', rows: [row(5, null)], ticks: 3, pending: false, keeps: false },
]

for (const one of WATCHES) {
  test(`見張り: ${one.name}`, async () => {
    expect(hasPendingChecks(one.rows)).toBe(one.pending)
    expect(keepsWatching(one.rows, one.ticks, LIMITS)).toBe(one.keeps)
  })
}

test('statusArgv は、リポジトリごとにまとめた 1 つの問い合わせを作る', async () => {
  const argv = statusArgv([PR_3, OTHER_2, PR_2])
  expect(argv.slice(0, 4)).toEqual(['gh', 'api', 'graphql', '-f'])
  expect(argv[4]).toBe(
    'query=query { r0: repository(owner: "o", name: "r") { p3: pullRequest(number: 3) { ...f } p2: pullRequest(number: 2) { ...f } } r1: repository(owner: "o", name: "other") { p2: pullRequest(number: 2) { ...f } } } fragment f on PullRequest { title state isDraft reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes { __typename ... on CheckRun { name conclusion } ... on StatusContext { context state } } } } } } } }',
  )
})

const answered = (pr: { state: string; isDraft?: boolean; reviewDecision?: string; rollup?: string; contexts?: unknown[] }) => ({
  title: 't',
  state: pr.state,
  isDraft: pr.isDraft ?? false,
  reviewDecision: pr.reviewDecision ?? null,
  commits: {
    nodes: [{ commit: { statusCheckRollup: pr.rollup === undefined ? null : { state: pr.rollup, contexts: { nodes: pr.contexts ?? [] } } } }],
  },
})

const status = (fields: Partial<PrStatus>): PrStatus => ({ title: 't', state: 'open', isDraft: false, checks: null, failedChecks: [], review: null, ...fields })

const ANSWERS: { name: string; pr: unknown; status: PrStatus | undefined }[] = [
  { name: '開いている、チェック無し、判定無し', pr: answered({ state: 'OPEN' }), status: status({}) },
  { name: 'CI 成功、承認済み', pr: answered({ state: 'OPEN', rollup: 'SUCCESS', reviewDecision: 'APPROVED' }), status: status({ checks: 'passing', review: 'approved' }) },
  { name: 'CI 失敗、直しの依頼あり', pr: answered({ state: 'OPEN', rollup: 'FAILURE', reviewDecision: 'CHANGES_REQUESTED' }), status: status({ checks: 'failing', review: 'changes_requested' }) },
  { name: 'CI エラー', pr: answered({ state: 'OPEN', rollup: 'ERROR' }), status: status({ checks: 'failing' }) },
  { name: 'CI 実行中、レビュー待ち', pr: answered({ state: 'OPEN', rollup: 'PENDING', reviewDecision: 'REVIEW_REQUIRED' }), status: status({ checks: 'pending', review: 'review_required' }) },
  { name: 'CI 待ち（EXPECTED）', pr: answered({ state: 'OPEN', rollup: 'EXPECTED' }), status: status({ checks: 'pending' }) },
  { name: '知らない CI の値は、実行中として出す', pr: answered({ state: 'OPEN', rollup: 'SOMETHING_NEW' }), status: status({ checks: 'pending' }) },
  { name: 'ドラフト', pr: answered({ state: 'OPEN', isDraft: true }), status: status({ isDraft: true }) },
  { name: 'マージ済み', pr: answered({ state: 'MERGED', rollup: 'SUCCESS' }), status: status({ state: 'merged', checks: 'passing' }) },
  { name: '閉じた', pr: answered({ state: 'CLOSED' }), status: status({ state: 'closed' }) },
  {
    // 形は kkyosuke/usagi の CI が失敗した PR で確かめた。Actions のチェックは name と conclusion を持つ
    name: '失敗したチェックの名前を拾う。成功、スキップ、実行中は拾わない',
    pr: answered({
      state: 'OPEN',
      rollup: 'FAILURE',
      contexts: [
        { __typename: 'CheckRun', name: 'gate', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', name: 'tui-e2e', conclusion: 'SKIPPED' },
        { __typename: 'CheckRun', name: 'Rust lint', conclusion: 'FAILURE' },
        { __typename: 'CheckRun', name: 'deploy', conclusion: null },
        { __typename: 'CheckRun', name: 'test', conclusion: 'TIMED_OUT' },
      ],
    }),
    status: status({ checks: 'failing', failedChecks: ['Rust lint', 'test'] }),
  },
  {
    name: 'コミットのステータスは context と state で拾う',
    pr: answered({
      state: 'OPEN',
      rollup: 'FAILURE',
      contexts: [
        { __typename: 'StatusContext', context: 'ci/deploy', state: 'ERROR' },
        { __typename: 'StatusContext', context: 'ci/lint', state: 'SUCCESS' },
        { __typename: 'StatusContext', context: 'ci/build', state: 'PENDING' },
      ],
    }),
    status: status({ checks: 'failing', failedChecks: ['ci/deploy'] }),
  },
  { name: '知らない state', pr: answered({ state: 'LOCKED' }), status: undefined },
  { name: 'PR が見つからない（null）', pr: null, status: undefined },
]

for (const one of ANSWERS) {
  test(`parseStatuses: ${one.name}`, async () => {
    const stdout = JSON.stringify({ data: { r0: { p2: one.pr } } })
    expect(parseStatuses(stdout, [PR_2])[PR_2.url]).toEqual(one.status)
  })
}

test('parseStatuses は、リポジトリをまたいだ答えを url ごとに分ける', async () => {
  const stdout = JSON.stringify({
    data: {
      r0: { p3: answered({ state: 'OPEN', rollup: 'FAILURE' }), p2: answered({ state: 'MERGED' }) },
      r1: { p2: answered({ state: 'OPEN', rollup: 'SUCCESS' }) },
    },
  })
  expect(parseStatuses(stdout, [PR_3, OTHER_2, PR_2])).toEqual({
    [PR_3.url]: status({ checks: 'failing' }),
    [PR_2.url]: status({ state: 'merged' }),
    [OTHER_2.url]: status({ checks: 'passing' }),
  })
})

test('parseStatuses は、JSON でない出力を空として読む', async () => {
  expect(parseStatuses('gh: not logged in', [PR_2])).toEqual({})
})
