import type { Checks, PrRef, PrRow, PrStatus, Review } from '../types'

// WHY 使える文字を絞る: owner と repo は、状態を取る GraphQL の問い合わせに文字列として埋め込む。
// 引用符や改行を通すと、問い合わせを書き換えられる
const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pull\/([1-9]\d*)(?:[/?#].*)?$/

// /files や ?x=1 が付いていても、同じ PR は同じ url になるように揃える
export const parsePrUrl = (url: string): PrRef | null => {
  const match = PR_URL.exec(url)
  const repo = match?.[1]
  const number = match?.[2]
  if (repo === undefined || number === undefined) return null
  return { url: `https://github.com/${repo}/pull/${number}`, repo, number: Number(number) }
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

// この操作をした PR は、このセッションが受け持っている PR として一覧に入れる。
// WHY edited、ready、draft も: 途中で引き継いだ PR は、このセッションでは作らずに直すところから始まる
// （2026-10-09 に利用者から依頼）。
// WHY NOT commented、merged、closed: ほかの人の PR のレビューや後片付けにも使う。入れると一覧が自分の PR でなくなる
const ADOPTING = ['created', 'edited', 'ready', 'draft']

// Bash の結果から、このコマンドで一覧に入れる PR を取り出す。無ければ null。
// Claude Code は `gh pr <動詞>` の形のコマンドを見て、結果の gitOperation.pr に { number, url?, action } を入れる
// （v2.1.295 で、gh pr create / edit / close を実行して確認）。
// WHY url が無ければ捨てる: number だけでは、どのリポジトリの PR か分からない（gh pr close の結果には url が無い）
export const adoptedPrOf = (result: unknown): PrRef | null => {
  const pr = field(field(result, 'gitOperation'), 'pr')
  const action = field(pr, 'action')
  const url = field(pr, 'url')
  return typeof action === 'string' && ADOPTING.includes(action) && typeof url === 'string' ? parsePrUrl(url) : null
}

// track_pr ツールの入力から、一覧に足す PR を取り出す。url が PR のものでなければ null
export const requestedPrOf = (input: unknown): PrRef | null => {
  const url = field(input, 'url')
  return typeof url === 'string' ? parsePrUrl(url.trim()) : null
}

// Bash の結果が、覚えている PR のどれかへの操作（comment、close など、一覧に入れる操作以外も含む）なら、その PR を返す。
// url があれば url で探す。無ければ番号で探し、同じ番号の PR が 2 つ以上あるときは決められないので null
export const touchedRefOf = (result: unknown, refs: PrRef[]): PrRef | null => {
  const pr = field(field(result, 'gitOperation'), 'pr')
  const url = field(pr, 'url')
  if (typeof url === 'string') {
    const target = parsePrUrl(url)
    return refs.find(known => known.url === target?.url) ?? null
  }
  const sameNumber = refs.filter(known => known.number === field(pr, 'number'))
  return sameNumber.length === 1 ? (sameNumber[0] ?? null) : null
}

// jj と git push のあいだに、-R <path> のような全体の引数が入ることがある。別のコマンドとの区切りはまたがない
// Bash のコマンドが、PR をマージする操作（gh pr merge）か
export const isMerge = (result: unknown): boolean => field(field(field(result, 'gitOperation'), 'pr'), 'action') === 'merged'

const JJ_PUSH = /\bjj\b[^|;&\n]*?\sgit\s+push\b/

// Bash のコマンドが push か。push すると CI が走り直すので、状態を取り直すきっかけに使う。
// WHY コマンドも見る: Claude Code が gitOperation.push を入れるのは `git push` の形だけで、`jj git push` には入らない
// （v2.1.295 のバイナリの正規表現で確認）
export const isPush = (command: string, result: unknown): boolean =>
  field(field(result, 'gitOperation'), 'push') !== undefined || JJ_PUSH.test(command)

// $.store から読んだ値を PR の並びに戻す。保存しているのは url の配列
export const refsOf = (stored: unknown): PrRef[] =>
  Array.isArray(stored)
    ? stored.flatMap((url: unknown) => {
        const ref = typeof url === 'string' ? parsePrUrl(url) : null
        return ref === null ? [] : [ref]
      })
    : []

// 触った PR を末尾に置く。並びは「最後に触った順」で、末尾がいちばん新しい。
// 同じ PR は 1 回だけ持つ。max を超えたら、長く触っていないものから落とす
export const touchRef = (refs: PrRef[], ref: PrRef, max: number): PrRef[] =>
  [...refs.filter(known => known.url !== ref.url), ref].slice(-max)

// 終わった PR（マージ済みか閉じた）を、先頭から max 個だけ残す。開いている PR と、状態をまだ取れていない PR は消さない。
// rows は、最後に触った PR が先頭。
// WHY 時間でなく個数: 1 日に多くの PR を作る日があり、「終わってから 1 日」では溜まりすぎる（2026-10-09 に利用者が決めた）。
// WHY すぐには消さない: マージされた PR の番号が一覧から消えるだけだと、マージされたのか落ちたのかが分からない
export const pruneDone = (rows: PrRow[], max: number): PrRow[] => {
  let done = 0
  return rows.filter(row => {
    if (row.status === null || row.status.state === 'open') return true
    done += 1
    return done <= max
  })
}

// 今回の取り直しで、開いていた PR がマージ済みに変わったものを返す。
// WHY 前の状態が open のものだけ: 前の状態が分からない PR（セッションを開き直した直後など）は、
// いつマージされたのかが分からない。知らせると、とうに済んだ話を蒸し返すことになる
export const newlyMerged = (before: PrRow[], after: PrRow[]): PrRow[] =>
  after.filter(row => row.status?.state === 'merged' && before.find(known => known.url === row.url)?.status?.state === 'open')

// 今回の取り直しで、開いている PR の CI が失敗に変わったものを返す。
// 実行中から失敗になった場合のほか、成功していた PR が新しい push で失敗した場合も入る。
// WHY 前の状態が分かるものだけ: 一覧に入れた時点や、開き直した時点ですでに失敗していた PR は、
// いつ失敗したのかが分からない。失敗したままの PR を、取り直すたびに知らせることもしない
export const newlyFailed = (before: PrRow[], after: PrRow[]): PrRow[] =>
  after.filter(row => {
    const known = before.find(candidate => candidate.url === row.url)?.status
    return row.status?.state === 'open' && row.status.checks === 'failing' && known !== undefined && known !== null && known.checks !== 'failing'
  })

// Claude に知らせる文。マージされた PR と、CI が失敗した PR を、1 行ずつ並べる。知らせるものが無ければ null。
// WHY 何をするかを書かない: 知らせるだけにする。聞くか、自分で進めるかは、届いた Claude がその場で判断する
// （2026-10-09 に利用者が決めた）
export const noticeOf = (merged: PrRow[], failed: PrRow[]): string | null => {
  const lines = [
    ...merged.map(row => `PR #${row.number}「${row.status?.title ?? ''}」がマージされました（${row.url}）`),
    ...failed.map(row => `PR #${row.number}「${row.status?.title ?? ''}」の CI が失敗しました（${row.url}）`),
  ]
  return lines.length === 0 ? null : lines.join('\n')
}

// CI の結果を待っている PR があるか。開いていて、チェックが実行中のもの
export const hasPendingChecks = (rows: PrRow[]): boolean => rows.some(row => row.status?.state === 'open' && row.status.checks === 'pending')

// CI の見張り（一定の間隔での取り直し）を、まだ続けるか。ticks は、見張りを始めてから取り直した回数。
// max 回で必ずやめる。実行中の PR が無くなったら、その時点でやめる。
// WHY grace: push の直後は、新しいコミットの CI がまだ GitHub に現れていないことがある。
// 始めてから grace 回までは、実行中の PR が無くても続ける
export const keepsWatching = (rows: PrRow[], ticks: number, limits: { max: number; grace: number }): boolean =>
  ticks < limits.max && (hasPendingChecks(rows) || ticks < limits.grace)

// 問い合わせの中で PR を指す名前。リポジトリは r0、r1、…、PR は p<番号>。
// 問い合わせを作る側と、答えを読む側で、同じ名前を使う
const aliased = (refs: PrRef[]): { alias: string; repo: string; refs: PrRef[] }[] =>
  [...new Set(refs.map(ref => ref.repo))].map((repo, index) => ({
    alias: `r${index}`,
    repo,
    refs: refs.filter(ref => ref.repo === repo),
  }))

// contexts は、個々のチェック。Actions のチェック（CheckRun）は name と conclusion、
// コミットのステータス（StatusContext）は context と state を持つ。100 は 1 回に取れる上限
const FRAGMENT =
  'fragment f on PullRequest { title state isDraft reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes { __typename ... on CheckRun { name conclusion } ... on StatusContext { context state } } } } } } } }'

// PR の状態を、何個でも 1 回の呼び出しで取る問い合わせ。
// WHY gh pr view でなく GraphQL: gh pr view は 1 個ずつしか見られず、PR の数だけ gh を呼ぶことになる。
// WHY NOT gh pr list: リポジトリごとに 1 回要り、--limit から外れた古い PR は取れない。一覧に無い PR も混ざる。
// 実験用の PR 2 つを 1 回で取れることを確かめた（2026-10-09、gh 経由）
export const statusArgv = (refs: PrRef[]): string[] => {
  const repos = aliased(refs).map(group => {
    const [owner, name] = group.repo.split('/')
    const prs = group.refs.map(ref => `p${ref.number}: pullRequest(number: ${ref.number}) { ...f }`).join(' ')
    return `${group.alias}: repository(owner: "${owner}", name: "${name}") { ${prs} }`
  })
  return ['gh', 'api', 'graphql', '-f', `query=query { ${repos.join(' ')} } ${FRAGMENT}`]
}

const STATES: { [state: string]: PrStatus['state'] } = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' }

const REVIEWS: { [decision: string]: Review } = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REVIEW_REQUIRED: 'review_required',
}

// GitHub が最後のコミットのチェックをまとめた値（StatusState）。
// チェックが 1 つも無い PR では statusCheckRollup が null になる（実験用の PR で確認）。
// CI が失敗した PR では FAILURE が返る（kkyosuke/usagi の PR で確認・2026-10-09）。
// ほかの値は実物を見ていない。知らない値は pending として出す
const CHECKS: { [state: string]: Checks } = {
  SUCCESS: 'passing',
  FAILURE: 'failing',
  ERROR: 'failing',
  PENDING: 'pending',
  EXPECTED: 'pending',
}

// 失敗として名前を出すチェックの結果。実行中（conclusion が null）と、成功、スキップは入れない
const FAILED_CHECK = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']

// 失敗したチェックの名前を取り出す。kkyosuke/usagi の CI が失敗した PR で、返る形を確かめた（2026-10-09）
const failedChecksOf = (rollup: unknown): string[] => {
  const nodes = field(field(rollup, 'contexts'), 'nodes')
  if (!Array.isArray(nodes)) return []
  return nodes.flatMap((check: unknown) => {
    const name = field(check, 'name') ?? field(check, 'context')
    const outcome = field(check, 'conclusion') ?? field(check, 'state')
    return typeof name === 'string' && typeof outcome === 'string' && FAILED_CHECK.includes(outcome) ? [name] : []
  })
}

const statusOf = (pr: unknown): PrStatus | null => {
  const title = field(pr, 'title')
  const rawState = field(pr, 'state')
  const state = typeof rawState === 'string' ? STATES[rawState] : undefined
  if (typeof title !== 'string' || state === undefined) return null
  const decision = field(pr, 'reviewDecision')
  const nodes = field(field(pr, 'commits'), 'nodes')
  const rollup = field(field(Array.isArray(nodes) ? nodes[0] : undefined, 'commit'), 'statusCheckRollup')
  const rollupState = field(rollup, 'state')
  return {
    title,
    state,
    isDraft: field(pr, 'isDraft') === true,
    checks: typeof rollupState === 'string' ? (CHECKS[rollupState] ?? 'pending') : null,
    failedChecks: failedChecksOf(rollup),
    review: typeof decision === 'string' ? (REVIEWS[decision] ?? null) : null,
  }
}

// statusArgv の出力を読み、url ごとの状態にする。読めなかった PR は入れない
export const parseStatuses = (stdout: string, refs: PrRef[]): { [url: string]: PrStatus } => {
  let answer: unknown
  try {
    answer = JSON.parse(stdout)
  } catch {
    return {}
  }
  const data = field(answer, 'data')
  const statuses: { [url: string]: PrStatus } = {}
  for (const group of aliased(refs)) {
    for (const ref of group.refs) {
      const status = statusOf(field(field(data, group.alias), `p${ref.number}`))
      if (status !== null) statuses[ref.url] = status
    }
  }
  return statuses
}
