import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, Timer } from 'claude-code'

import type { Checks, JjCounts, PrRef, PrRow, PrStatus, Review, Status } from '../types'
import { SESSION_CONTEXT } from './context'
import { clampCursor, moveCursor, windowOf } from './cursor'
import { BAR_CELLS, cellWidth, clip, filledCells, isSameStatus, levelOf, shortPath, type Level } from './format'
import { CHANGED_ARGV, LOG_ARGV, SNAPSHOT_ARGV, UNPUSHED_ARGV, countsOf, parseLog } from './jj'
import {
  adoptedPrOf,
  hasPendingChecks,
  isMerge,
  isPush,
  keepsWatching,
  newlyFailed,
  newlyMerged,
  noticeOf,
  parseStatuses,
  pruneDone,
  refsOf,
  requestedPrOf,
  statusArgv,
  touchRef,
  touchedRefOf,
} from './pr'

const status = atom({ plugin: 'status-band', key: 'status' } as const, null)
const log = atom({ plugin: 'status-band', key: 'log' } as const, null)
const pullRequests = atom({ plugin: 'status-band', key: 'prs' } as const, [])
const pendingNotice = atom({ plugin: 'status-band', key: 'pendingNotice' } as const, null)
const cursors = atom({ plugin: 'status-band', key: 'cursors' } as const, {})
const LOG_PANE = 'jj-log'
const PR_PANE = 'pull-requests'
const PR_PANE_TITLE = 'pull requests'

// $.store には、セッションごとに PR の url の配列を持つ。キーは prs:<セッションID>
const PR_PREFIX = 'prs:'
// 1 つのセッションで覚える PR の数。古いものから落とす
const PRS_MAX = 50
// $.store に覚えておくセッションの数。古いセッションから落とす
const SESSIONS_MAX = 30
// 一覧に残す、終わった PR（マージ済みか閉じた）の数
const PRS_DONE_MAX = 3

// CI の結果を待つあいだだけ、PR の状態を定期的に取り直す。間隔と、やめるまでの回数。
// 1 分おきに 10 回で、およそ 10 分（2026-10-09 に利用者が決めた）。
// grace は、実行中の PR が無くても続ける回数。push の直後は、CI がまだ GitHub に現れていないことがある
const WATCH_INTERVAL_MS = 60_000
const WATCH_LIMITS = { max: 10, grace: 2 }

// pane の一覧で、選んでいる行を delta だけ動かす。length は一覧の行数。
// 一覧は、選んでいる行のまわりの収まる分だけを描くので、pane を送る必要は無い（windowOf）。
// WHY Button の hotkey で作る: 書けるのは数字 1 つか小文字 1 つで、Shift を押しても小文字と同じ扱いになる
// （型定義に「Shift+w is "w"」）。y と Y は区別できないので、全部のコピーは別の小文字（a）にしている。
// WHY NOT Client: キーを自分で受けられて Y も区別できるが、キーが届くのは、その部分をクリックした後だけ。
// キーボードで使う一覧には向かない
const moveSelection = async ($: EngineInterface, pane: string, delta: number, length: number): Promise<void> => {
  await update($, cursors, current => ({ ...current, [pane]: moveCursor(current[pane] ?? 0, delta, length) }))
}

// pane の高さから、一覧に使える行数を出す。overhead は、一覧の外に描くもの（凡例、ヒントの行、あいだの空き）の行数。
// WHY +3: 上と下の「あと N 件」の 2 行と、折り返しの見積もりが 1 行ずれたときの余り
const listRoom = (bodyRows: number, overhead: number): number => Math.max(1, bodyRows - overhead - 3)

// クリップボードへコピーして、結果を toast で知らせる。done は、できたときに出す文
const copyText = async ($: EngineInterface, text: string, surface: RenderSurface, done: string): Promise<void> => {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? done : `コピーできませんでした: ${copied.reason}`)
}

const openInBrowser = ($: EngineInterface, url: string): void => {
  // WHY open: macOS の既定のブラウザで開く。ほかの OS では動かない
  void $.process.run(['open', url], { timeoutMs: 5_000 }).catch(() => undefined)
}

// Claude が PR を一覧に足すためのツール。gh pr create / edit を通らない PR（ほかの人が作った PR など）に使う
const TRACK_TOOL_NAME = 'track_pr'
const TRACK_TOOL = 'mcp__status-band__track_pr'
const TRACK_TOOL_DESCRIPTION = `Add a pull request to this session's pull request list, so the status band and the pull requests pane show its CI and review state, and a merge is announced.
Use it when the user asks to watch or track a PR. PRs this session creates or edits with \`gh pr create\` / \`gh pr edit\` are added automatically; do not call this for them.`
const TRACK_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'The pull request URL: https://github.com/<owner>/<repo>/pull/<number>' },
  },
  required: ['url'],
}

// 帯の色。暗い背景の上で、目立たせる 1 つ（ACCENT）と、控えめな面（SURFACE）を分ける
const ACCENT = '#6cb6ff'
const AMBER = '#e8a35c'
const RED = '#ff7b72'
const GREEN = '#7ee0a1'
const PURPLE = '#c9a0ff'
const INK = '#0d1117'
const SURFACE = '#30363d'
const SOFT = '#c9d1d9'
const LEVEL_COLOR: { [level in Level]: string } = { calm: ACCENT, watch: AMBER, full: RED }

const CHECK_MARK: { [checks in Checks]: { mark: string; color: string } } = {
  passing: { mark: '✓', color: GREEN },
  failing: { mark: '✗', color: RED },
  pending: { mark: '●', color: AMBER },
}

const REVIEW_LABEL: { [review in Review]: { label: string; color: string | undefined } } = {
  approved: { label: 'approved', color: GREEN },
  changes_requested: { label: 'changes', color: RED },
  review_required: { label: 'review', color: undefined },
}

const PR_STATE_COLOR: { [state in PrStatus['state']]: string | undefined } = { open: GREEN, merged: PURPLE, closed: RED }

// 帯に出す PR の番号の色。開いている PR は CI の結果、それ以外は PR の状態で決める。
// undefined は「色を付けず、薄く出す」（状態をまだ取れていない、閉じた）
const prColor = (row: PrRow): string | undefined => {
  if (row.status === null || row.status.state === 'closed') return undefined
  if (row.status.state === 'merged') return PURPLE
  switch (row.status.checks) {
    case 'passing':
      return GREEN
    case 'failing':
      return RED
    case 'pending':
      return AMBER
    case null:
      return SOFT
  }
}

// 幅が足りないときに、右から順に項目を落とす境目（桁）
const WIDE = 120
const MEDIUM = 96
// 場所の表示に使う桁の上限。超えたら途中を省いて、末尾のディレクトリを収まるだけ残す
// WHY 40: ~/github.com/<owner>/<repo> の形（30 桁前後）は省かずに出したい
const DIRECTORY_MAX = 40

// read は記録せずに読む。snapshot は作業コピーを記録してから読む（番の終わりだけ）
type JjMode = 'read' | 'snapshot'

const jjCounts = async ($: EngineInterface, mode: JjMode): Promise<JjCounts | null> => {
  try {
    if (mode === 'read') {
      const [unpushed, changed] = await Promise.all([
        $.process.run(UNPUSHED_ARGV, { timeoutMs: 5_000 }),
        $.process.run(CHANGED_ARGV, { timeoutMs: 5_000 }),
      ])
      return countsOf(unpushed, changed)
    }
    // WHY 順番に実行する: 先に記録を済ませてから、記録後の状態で未 push を数える
    const changed = await $.process.run(SNAPSHOT_ARGV, { timeoutMs: 10_000 })
    const unpushed = await $.process.run(UNPUSHED_ARGV, { timeoutMs: 5_000 })
    return countsOf(unpushed, changed)
  } catch {
    // jj が入っていない、時間切れ、など。jj の項目を出さないだけで、hook は失敗させない
    return null
  }
}

// ログの pane に出す行を読み直す
const refreshLog = async ($: EngineInterface): Promise<void> => {
  const entries = await $.process.run(LOG_ARGV, { timeoutMs: 5_000 }).then(
    ran => (ran.exitCode === 0 ? parseLog(ran.stdout) : null),
    () => null,
  )
  // WHY 同じなら書かない: 書くたびに pane が描き直される
  await update($, log, current => (JSON.stringify(current) === JSON.stringify(entries) ? current : entries))
}

const isLogOpen = async ($: EngineInterface): Promise<boolean> => (await $.ui.panes()).some(pane => pane.id === LOG_PANE)

// 帯に出す値を集め直す。
// jj が 'skip' のときは jj を実行せず、前の件数を使う。Bash 以外のツールの後は、コンテキストだけ直す
// WHY ファイルの先頭の階層: $ を渡す先の関数は、ここに宣言したものしか読み込みを通らない（v2.1.295 で確認）
const refresh = async ($: EngineInterface, jj: JjMode | 'skip'): Promise<void> => {
  const withJj = jj !== 'skip'
  const [model, usage, cwd, home, counted] = await Promise.all([
    $.session.model(),
    $.session.usage(),
    $.session.cwd(),
    $.env.get('HOME'),
    jj === 'skip' ? undefined : jjCounts($, jj),
  ])
  // WHY 同じなら書かない: 書くたびに帯が描き直される
  await update($, status, current => {
    const next: Status = {
      model,
      contextPercent: usage.context.percent,
      directory: shortPath(cwd, home, DIRECTORY_MAX),
      jj: counted === undefined ? (current?.jj ?? null) : counted,
    }
    return isSameStatus(current, next) ? current : next
  })
  // ログの pane を開いているあいだは、jj を数え直すのと同じ時点（Bash の後、番の終わり）でログも読み直す
  if (withJj && (await isLogOpen($))) await refreshLog($)
}

// このセッションの値を $.store に書く。キーは <prefix><セッションID>。覚えておくセッションの数を超えたら、古いものから消す。
// WHY 消してから書く: $.store.keys() の並びを「最後に書いた順」に保ち、古いセッションから落とせるようにする
const saveForSession = async ($: EngineInterface, prefix: string, value: string[]): Promise<void> => {
  const key = `${prefix}${await $.session.id()}`
  await $.store.delete(key)
  await $.store.set(key, value)
  const keys = (await $.store.keys()).filter(stored => stored.startsWith(prefix))
  for (const stale of keys.slice(0, Math.max(0, keys.length - SESSIONS_MAX))) await $.store.delete(stale)
}

const loadPrRefs = async ($: EngineInterface): Promise<PrRef[]> => refsOf(await $.store.get(`${PR_PREFIX}${await $.session.id()}`))

// このセッションの PR の一覧を書き直す。urls は、末尾がいちばん新しい
const savePrRefs = async ($: EngineInterface, urls: string[]): Promise<void> => saveForSession($, PR_PREFIX, urls)

// このセッションの一覧で、触った PR をいちばん新しい位置に置く。無ければ足す
const rememberPr = async ($: EngineInterface, ref: PrRef): Promise<void> => {
  const refs = touchRef(await loadPrRefs($), ref, PRS_MAX)
  await savePrRefs(
    $,
    refs.map(known => known.url),
  )
}

// 渡した PR の状態を、1 回の呼び出しでまとめて取る。取れなかった PR は、返す値に入らない
const fetchPrStatuses = async ($: EngineInterface, refs: PrRef[]): Promise<{ [url: string]: PrStatus }> => {
  if (refs.length === 0) return {}
  return $.process.run(statusArgv(refs), { timeoutMs: 8_000 }).then(
    ran => (ran.exitCode === 0 ? parseStatuses(ran.stdout, refs) : {}),
    // gh が入っていない、時間切れ、など
    () => ({}),
  )
}

// Claude に文で知らせる。送った文は、ターンの途中ならターンが終わってから届く。
// WHY asUser を付けない: 利用者が打った文ではない。プラグインが送ったという枠を付けて届ける。
// WHY 待たない: 送信は、いまのターンが終わるまで返らない。待つと、呼んだ側も終われなくなる。
// WHY tool.call の hook から呼ばない: エンジンが拒む（called from a tool.call hook, it would wait on the turn
// this hook is holding。v2.1.295 のテストで確認）。ツールの後に気づいた分は pendingNotice に溜め、turn.complete で送る
const submitNotice = ($: EngineInterface, text: string): void => {
  // 送れなかったときは、利用者にだけ toast で知らせる
  const tellUser = () => $.ui.toast(text, { timeoutMs: 15_000 })
  void $.prompt.submit({ text }).then(result => {
    if (result.drop !== undefined) tellUser()
  }, tellUser)
}

// PR の一覧を $.store から作り直し、状態を取り直す。PR が何個あっても、gh を呼ぶのは 1 回。
// 返すのは、取り直した後の一覧（rows）と、今回、開いていたのがマージ済みに変わった PR（merged）、
// CI が失敗に変わった PR（failed）。
// 知らせるかどうかは呼んだ側が決める。
// WHY rows を返す: 同じ hook の中で状態を読み直しても、書く前の値が返る（1 回の dispatch の get は、同じ時点を読む）。
// WHY マージに気づいても jj git fetch しない: リモートのブランチが消えていると、fetch で手元のコミットが abandon される
// （git.abandon-unreachable-commits が true）。Claude の作業の最中に履歴が変わるのを避け、知らせるだけにする。
// WHY ターンの終わりには呼ばない: ターンのたびに GitHub を叩くことになる（2026-10-09 に利用者が決めた）。
// 呼ぶのは、セッションの開始時、gh pr <動詞> の後、push の後、利用者が頼んだとき（pr ボタン、r キー、track_pr）、
// CI の見張りのあいだ。
// WHY ずっとは見張らない: 手元のセッションは GitHub のイベントを受け取れない（v2.1.295 のバイナリで確認。
// Webhook が届くのは /autofix-pr が起こすクラウドのセッションだけ）。取りに行くしかないので、CI を待つあいだに限る。
// 画面でのマージは、次に取り直すまで分からない
const refreshPrs = async ($: EngineInterface): Promise<{ rows: PrRow[]; merged: PrRow[]; failed: PrRow[] }> => {
  // 一覧は、最後に触った PR を先頭にして持つ
  const refs = (await loadPrRefs($)).reverse()
  const known = await read($, pullRequests)
  const before = (ref: PrRef): PrStatus | null => known.find(row => row.url === ref.url)?.status ?? null
  // マージ済みの PR は、もう状態が変わらない。問い合わせに入れない
  const statuses = await fetchPrStatuses(
    $,
    refs.filter(ref => before(ref)?.state !== 'merged'),
  )
  // 取れなかった PR は、前に取れた状態を残す
  const fetched: PrRow[] = refs.map(ref => ({ ...ref, status: statuses[ref.url] ?? before(ref) }))
  // 終わった PR が溜まらないよう、新しいものだけを残す。消したぶんは $.store からも消す
  const next = pruneDone(fetched, PRS_DONE_MAX)
  if (next.length < fetched.length) {
    await savePrRefs(
      $,
      next.map(row => row.url).reverse(),
    )
  }
  // WHY 同じなら書かない: 書くたびに帯と pane が描き直される
  await update($, pullRequests, current => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
  // WHY 消す前の fetched で比べる: マージされた PR が、終わった PR の上限を超えてすぐ消えることがある
  return { rows: next, merged: newlyMerged(known, fetched), failed: newlyFailed(known, fetched) }
}

// いま動いている CI の見張り。null は、見張っていない。
// WHY モジュールの変数: タイマーの控え（cancel を持つ）は JSON にできず、$.state に置けない。
// Mod を読み込み直すと、エンジンが古いタイマーを止める
let watch: { timer: Timer; ticks: number } | null = null

const stopWatching = (): void => {
  watch?.timer.cancel()
  watch = null
}

// 見張りの 1 回分。状態を取り直し、続けるかを決める
const watchTick = async ($: EngineInterface): Promise<void> => {
  const mine = watch
  if (mine === null) return
  mine.ticks += 1
  const { rows, merged, failed } = await refreshPrs($)
  // タイマーはターンを止めていないので、その場で送る
  const text = noticeOf(merged, failed)
  if (text !== null) submitNotice($, text)
  // 取り直しているあいだに、新しい見張りに替わっていたら、そちらには手を出さない
  if (watch === mine && !keepsWatching(rows, mine.ticks, WATCH_LIMITS)) stopWatching()
}

// CI の結果を待つ理由があれば、見張りを始める。すでに見張っていれば、回数を数え直す。
// pushed は、push の直後か。そのときは、実行中の PR がまだ見えていなくても始める
const watchIfWaiting = ($: EngineInterface, rows: PrRow[], pushed: boolean): void => {
  if (rows.length === 0 || !(pushed || hasPendingChecks(rows))) return
  stopWatching()
  const timer = $.clock.every(WATCH_INTERVAL_MS, () => {
    void watchTick($).catch(() => undefined)
  })
  watch = { timer, ticks: 0 }
}

// ツールの後に気づいたマージと CI の失敗を、ターンの終わりに送るために溜める。
// WHY 溜める: tool.call の hook の中からは送れない
const queueNotice = async ($: EngineInterface, text: string | null): Promise<void> => {
  if (text === null) return
  await update($, pendingNotice, waiting => (waiting === null ? text : `${waiting}\n${text}`))
}

// PR を一覧から外す。GitHub は叩かない。
// 外した PR も、あとで gh pr edit するか track_pr で足せば、また一覧に入る
const dropPr = async ($: EngineInterface, url: string): Promise<void> => {
  await savePrRefs(
    $,
    (await loadPrRefs($)).filter(ref => ref.url !== url).map(ref => ref.url),
  )
  await update($, pullRequests, current => current.filter(row => row.url !== url))
}

// 利用者の操作（pr ボタン、r キー）で取り直す。マージや CI の失敗に気づいたら、その場で Claude に知らせる
const refreshPrsNow = async ($: EngineInterface): Promise<void> => {
  const { rows, merged, failed } = await refreshPrs($)
  const text = noticeOf(merged, failed)
  if (text !== null) submitNotice($, text)
  watchIfWaiting($, rows, false)
}

// セッションの開始時。開き直したセッションでは、$.store に残っている PR の一覧を戻す。
// 状態は覚えていないので、ここで取る。前の状態が無いので、マージの知らせは出ない
const restorePrs = async ($: EngineInterface): Promise<void> => {
  const { rows } = await refreshPrs($)
  watchIfWaiting($, rows, false)
}

// PR の一覧の pane を、利用者の操作を待たずに出す。フォーカスは移さない（入力欄で打ち続けられるように）。
// 利用者の操作から開くわけではないので、幅が足りないと置かれない。そのときは toast で知らせる
const showPrPane = async ($: EngineInterface, added: PrRef): Promise<void> => {
  const opened = await $.ui.open({ id: PR_PANE, title: PR_PANE_TITLE, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`PR #${added.number} を一覧に入れました。帯の pr で開けます`, { timeoutMs: 8_000 })
}

// Bash の結果を見て、作った PR と直した PR を一覧に足す。一覧の PR を操作したときと push したときは、状態を取り直す
const trackPrs = async ($: EngineInterface, command: string, result: unknown): Promise<void> => {
  const refs = await loadPrRefs($)
  const adopted = adoptedPrOf(result)
  // 作った PR と直した PR は足す。覚えている PR へのほかの操作（comment、close など）は、先頭に上げるだけ
  const touched = adopted ?? touchedRefOf(result, refs)
  if (touched !== null) await rememberPr($, touched)
  // 一覧に関係の無いコマンドでは、GitHub を叩かない。push は、一覧に PR があるときだけ取り直す
  if (touched === null && !(isPush(command, result) && refs.length > 0)) return
  const { rows, merged, failed } = await refreshPrs($)
  // Claude が自分でマージした PR は、知らせなくても分かっている
  await queueNotice(
    $,
    noticeOf(
      merged.filter(row => !(isMerge(result) && row.url === touched?.url)),
      failed,
    ),
  )
  watchIfWaiting($, rows, isPush(command, result))
  // 一覧に新しく入った時点で、一覧を横に出す
  if (adopted !== null && !refs.some(known => known.url === adopted.url)) await showPrPane($, adopted)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TRACK_TOOL_NAME, description: TRACK_TOOL_DESCRIPTION, inputSchema: TRACK_TOOL_SCHEMA, isDeferred: false })
    // WHY catch: PR の一覧を戻せなくても、帯は出す
    await Promise.all([refresh($, 'read'), restorePrs($).catch(() => undefined)])
    return next(e)
  })

  // セッションの始めに、利用者の画面と操作の届き方を Claude に伝える。
  // WHY classic.SessionStart: 起動、再開、fork、/clear、compact のたびに来る（入力の source の型で確認）。
  // /clear と compact は前の文脈を落とすので、そのたびに渡し直す。claude-deck の Mod と同じやり方。
  // WHY サブエージェントには渡さない: 帯とボタンを見ているのは、メインのセッションの利用者だけ
  on('classic.SessionStart', async (_$, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), SESSION_CONTEXT] }
  }).catch((_$, e, next) => next(e))

  // Claude が、PR を一覧に足す
  on('tool.call', { tool: TRACK_TOOL }, async ($, e) => {
    const ref = requestedPrOf(e)
    if (ref === null) return { deny: 'track_pr failed: url must look like https://github.com/<owner>/<repo>/pull/<number>' }
    const isNew = !(await loadPrRefs($)).some(known => known.url === ref.url)
    await rememberPr($, ref)
    const { rows, merged, failed } = await refreshPrs($)
    await queueNotice($, noticeOf(merged, failed))
    watchIfWaiting($, rows, false)
    if (isNew) await showPrPane($, ref)
    const added = rows.find(row => row.url === ref.url)?.status ?? null
    return {
      result:
        added === null
          ? `PR #${ref.number} (${ref.repo}) is on the list, but its state could not be read. Check the URL and that gh is signed in.`
          : `PR #${ref.number} (${ref.repo}) is on the list: ${added.isDraft && added.state === 'open' ? 'draft' : added.state}, checks ${added.checks ?? 'none'}.`,
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `track_pr failed: ${next.error.message}` }))

  // コンテキストはツールのたびに動く。jj は Bash（jj commit、jj git push など）の後だけ数え直す。
  // WHY ここでは記録しない: 番の途中は Claude の jj コマンドと重なりうる。操作ログもツールのたびに増える
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    await refresh($, e.tool === 'Bash' ? 'read' : 'skip')
    // Bash の結果から、PR への操作（gh pr <動詞>）と push を拾う
    if (e.tool === 'Bash') await trackPrs($, e.command, ran.result)
    return ran
    // WHY catch: この hook はすべてのツールの呼び出しを通る。集め直しで何が起きても、ツールの結果はそのまま返す
  }).catch(($, e, next) => next(e))

  // 番の終わりにだけ作業コピーを記録する。Edit や Write で編集した分が、ここで件数に入る
  on('turn.complete', async ($, e, next) => {
    await refresh($, 'snapshot')
    // ツールの後に気づいたマージと CI の失敗を、ここで Claude に知らせる
    const waiting = await read($, pendingNotice)
    if (waiting !== null) {
      await update($, pendingNotice, () => null)
      submitNotice($, waiting)
    }
    return next(e)
  })

  // プロンプトの下の行に描く。古いステータス行があった場所と同じ。
  // WHY PromptHint: プロンプトの下で、色とボタンを使える場所はここだけ。
  // WHY NOT AbovePrompt: 上の帯は調査（survey）と場所を取り合い、入力欄を下へ押す
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // この行に元から出ている表示（manual mode on、esc to interrupt など）。消さずに、帯の下に並べる
    const original = await next(e)
    const now = await read($, status)
    if (e.surface !== 'terminal' || now === null) return original

    const { Box, Button, Text } = $.ui.resolve(e)
    // WHY -2: この行は左に 2 桁の字下げが付く（目測、未計測）
    const width = Math.max(40, (e.viewport?.columns ?? 100) - 2)
    const jj = now.jj
    // スラッシュコマンドを、利用者が打ったのと同じようにすぐ実行する。
    // WHY 失敗したら fill: $.command.run は知らない名前を拒む。そのときも操作を失わないよう、入力欄に入れて知らせる
    const run = (command: string) => () => {
      $.command.run({ command }).catch(() => {
        void $.prompt.fill({ text: `/${command}` })
        $.ui.toast(`/${command} をすぐには実行できませんでした。入力欄に入れたので、Enterで送ってください`, { timeoutMs: 8_000 })
      })
    }
    // 押した時点のログを読んでから、pane を開く。利用者の操作で開くので、幅に関係なく出る
    const openLog = () => {
      void refreshLog($).then(() => $.ui.open({ id: LOG_PANE, title: 'jj log', focus: true, closeOnEscape: true }))
    }
    // PR の一覧の pane をすぐ開き、開いた後で状態を取り直す。
    // WHY 直接開く: スラッシュコマンドを経由すると、ターンの途中に押したときに、ターンが終わるまで開かない
    // （commit と diff のボタンがそうなる。pane を開くコマンドでも同じだと、利用者が実機で確認。2026-10-09）。
    // $.ui.open が開けるのは自分の Mod の pane だけなので、ボタンと pane を同じ Mod に置いている
    const openPrs = () => {
      void $.ui.open({ id: PR_PANE, title: PR_PANE_TITLE, focus: true, closeOnEscape: true })
      void refreshPrsNow($).catch(() => undefined)
    }
    // 次にやることを 1 つだけ目立たせる。未コミットがあればコミット、無ければログ
    const primary = jj !== null && jj.changed > 0 ? 'commit' : 'log'
    const pill = (name: string) =>
      name === primary
        ? { backgroundColor: ACCENT, color: INK, bold: true }
        : { backgroundColor: SURFACE, color: SOFT, bold: false }
    const percent = now.contextPercent
    const filled = percent === undefined ? 0 : filledCells(percent)
    const prs = await read($, pullRequests)
    // 最後に触った PR から、幅に応じて 3 つまで出す
    const shownPrs = prs.slice(0, width >= WIDE ? 3 : width >= MEDIUM ? 2 : 1)

    return (
      <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Box flexDirection="row" columnGap={3}>
          <Text bold color={ACCENT}>
            {now.model}
          </Text>
          {percent !== undefined && (
            <Box flexDirection="row" columnGap={1}>
              <Box flexDirection="row">
                <Text color={LEVEL_COLOR[levelOf(percent)]}>{'━'.repeat(filled)}</Text>
                <Text dimColor>{'─'.repeat(BAR_CELLS - filled)}</Text>
              </Box>
              <Text color={levelOf(percent) === 'calm' ? undefined : LEVEL_COLOR[levelOf(percent)]}>{percent}%</Text>
            </Box>
          )}
          {width >= WIDE && <Text dimColor>{now.directory}</Text>}
          {jj !== null && jj.changed > 0 && (
            <Box flexDirection="row" columnGap={1}>
              <Text color={AMBER}>●</Text>
              <Text>{jj.changed}</Text>
            </Box>
          )}
          {jj !== null && jj.unpushed > 0 && (
            <Box flexDirection="row" columnGap={1}>
              <Text color={ACCENT}>↑</Text>
              <Text>{jj.unpushed}</Text>
            </Box>
          )}
          {shownPrs.length > 0 && (
            <Box flexDirection="row" columnGap={1}>
              {shownPrs.map(row => (
                // 番号を押すと、ブラウザで開く（macOS の open）
                <Button key={`pr-${row.url}`} plain onPress={() => void $.process.run(['open', row.url], { timeoutMs: 5_000 }).catch(() => undefined)}>
                  <Text color={prColor(row)} dimColor={prColor(row) === undefined}>
                    #{row.number}
                  </Text>
                </Button>
              ))}
            </Box>
          )}
        </Box>
        {/* WHY hotkey を付けない: plain の Button は hotkey があると「c: commit」と描かれ、札の見た目が崩れる。
            クリックか、ctrl+x tab の後の Tab と Enter で押す */}
        <Box flexDirection="row" columnGap={1}>
          {jj !== null && jj.changed > 0 && (
            <Button key="commit" plain onPress={run('jjcommit')}>
              <Text {...pill('commit')}> commit </Text>
            </Button>
          )}
          {jj !== null && jj.changed > 0 && (
            <Button key="difit" plain onPress={run('difit')}>
              <Text {...pill('difit')}> diff </Text>
            </Button>
          )}
          {jj !== null && (
            <Button key="log" plain onPress={openLog}>
              <Text {...pill('log')}> log </Text>
            </Button>
          )}
          {prs.length > 0 && (
            <Button key="pr" plain onPress={openPrs}>
              <Text {...pill('pr')}> pr </Text>
            </Button>
          )}
        </Box>
      </Box>
      {original}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const entries = await read($, log)
    const width = e.props.bodyColumns
    const hasUnpushed = (entries ?? []).some(entry => !entry.isPushed && !entry.isEmpty)

    return (
      <Box flexDirection="column" gap={1} width={width}>
        {entries === null ? (
          <Text dimColor>jj のログを読めませんでした（jj のリポジトリの外かもしれません）</Text>
        ) : (
          <Box flexDirection="column">
            {entries.map(entry => {
              const mark = entry.isWorkingCopy ? '@' : entry.isPushed ? '◆' : '↑'
              const tags = entry.bookmarks.join(' ')
              const title = entry.title !== '' ? entry.title : entry.isEmpty ? '(empty)' : '(no description)'
              // 印 1、ID 8、ブックマーク、経過時間と、あいだの空き 1 桁ずつを引いた残りを、説明に使う
              const room = width - (1 + 1 + 8 + 1 + (tags === '' ? 0 : cellWidth(tags) + 1) + 1 + cellWidth(entry.age))
              return (
                <Box flexDirection="row" justifyContent="space-between" width={width}>
                  <Box flexDirection="row" columnGap={1}>
                    <Text bold={entry.isWorkingCopy} color={entry.isPushed ? undefined : ACCENT} dimColor={entry.isPushed}>
                      {mark}
                    </Text>
                    <Text color={PURPLE}>{entry.id}</Text>
                    {tags !== '' && <Text color={GREEN}>{tags}</Text>}
                    <Text dimColor={entry.title === '' || entry.isPushed}>{clip(title, Math.max(8, room))}</Text>
                  </Box>
                  <Text dimColor>{entry.age}</Text>
                </Box>
              )
            })}
          </Box>
        )}
        <Text dimColor>@ 作業コピー　↑ まだpushしていない　◆ push済み</Text>
        <Box flexDirection="row" columnGap={2}>
          <Button key="refresh" hotkey="r" onPress={() => void refreshLog($)}>
            更新
          </Button>
          {/* WHY fill: リモートに出る操作で、押し間違いをやり直せない。入力欄に入れるだけにして、Enter を挟む */}
          {hasUnpushed && (
            <Button
              key="push"
              hotkey="p"
              onPress={() => {
                void $.prompt.fill({ text: 'pushしといて' })
              }}
            >
              push
            </Button>
          )}
          <Button
            key="close"
            role="dismiss"
            hotkey="q"
            onPress={() => {
              void $.ui.close({ id: LOG_PANE })
            }}
          >
            閉じる
          </Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PR_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, pullRequests)
    const width = e.props.bodyColumns
    // リポジトリが 1 つなら、行ごとに名前を出さない
    const showsRepo = new Set(list.map(row => row.repo)).size > 1
    // キーで選んでいる行
    const cursor = clampCursor((await read($, cursors))[PR_PANE] ?? 0, list.length)
    const selected = list[cursor]
    // 落ちたチェックの名前は、開いている PR にだけ出す。終わった PR では、もう直す相手ではない
    const failedChecksOf = (row: PrRow): string[] => (row.status !== null && row.status.state === 'open' ? row.status.failedChecks : [])
    // 一覧の外に描くもの: 空き 1、凡例 1、空き 1、ヒント 2
    const shown = windowOf(
      list.map(row => (failedChecksOf(row).length > 0 ? 2 : 1)),
      cursor,
      listRoom(e.props.scroll.bodyRows, 5),
      0,
    )

    return (
      <Box flexDirection="column" gap={1} width={width}>
        {list.length === 0 ? (
          <Text dimColor>このセッションで作るか直すかしたPRはまだありません（gh pr create か gh pr edit を実行すると、ここに並びます）</Text>
        ) : (
          <Box flexDirection="column">
            {shown.start > 0 && <Text dimColor>{`  ↑ あと ${shown.start} 件`}</Text>}
            {list.slice(shown.start, shown.end).map((row, offset) => {
              const index = shown.start + offset
              const prStatus = row.status
              const checks = prStatus?.checks ?? null
              const review = prStatus?.review ?? null
              const number = `#${row.number}`
              const state = prStatus === null ? '' : prStatus.isDraft && prStatus.state === 'open' ? 'draft' : prStatus.state
              const reviewLabel = review === null ? '' : REVIEW_LABEL[review].label
              // 選んでいる印 1、CI の印 1、番号、リポジトリ、右側の 2 つの札と × のボタン、あいだの空き 1 桁ずつを引いた残りを、題名に使う
              const taken =
                2 + 1 + 1 + number.length + 1 + (showsRepo ? row.repo.length + 1 : 0) + 1 + state.length + (reviewLabel === '' ? 0 : reviewLabel.length + 1) + 2
              const isDone = prStatus !== null && prStatus.state !== 'open'
              const failedChecks = failedChecksOf(row)
              return (
                <Box key={`row-${row.url}`} flexDirection="column" width={width}>
                <Box flexDirection="row" justifyContent="space-between" width={width}>
                  <Box flexDirection="row" columnGap={1}>
                    <Text color={ACCENT}>{index === cursor ? '▸' : ' '}</Text>
                    {checks === null ? <Text dimColor>–</Text> : <Text color={CHECK_MARK[checks].color}>{CHECK_MARK[checks].mark}</Text>}
                    {/* WHY 番号だけがボタン: Button の中には文字と Text しか置けず、行全体は包めない（v2.1.295 で確認） */}
                    <Button key={`open-${row.url}`} plain onPress={() => openInBrowser($, row.url)}>
                      <Text color={ACCENT}>{number}</Text>
                    </Button>
                    {showsRepo && <Text dimColor>{row.repo}</Text>}
                    <Box width={Math.max(8, width - taken)}>
                      <Text wrap="truncate-end" dimColor={prStatus === null || isDone}>
                        {prStatus === null ? '状態を取れていません' : prStatus.title}
                      </Text>
                    </Box>
                  </Box>
                  <Box flexDirection="row" columnGap={1}>
                    {review !== null && <Text color={REVIEW_LABEL[review].color}>{reviewLabel}</Text>}
                    {prStatus !== null && (
                      <Text color={state === 'draft' ? undefined : PR_STATE_COLOR[prStatus.state]} dimColor={state === 'draft'}>
                        {state}
                      </Text>
                    )}
                    <Button key={`drop-${row.url}`} plain onPress={() => void dropPr($, row.url).catch(() => undefined)}>
                      <Text dimColor>×</Text>
                    </Button>
                  </Box>
                </Box>
                {failedChecks.length > 0 && (
                  <Text wrap="truncate-end" color={RED}>
                    {`    ${failedChecks.join(', ')}`}
                  </Text>
                )}
                </Box>
              )
            })}
            {shown.end < list.length && <Text dimColor>{`  ↓ あと ${list.length - shown.end} 件`}</Text>}
          </Box>
        )}
        <Text dimColor>✓ 成功　✗ 失敗　● 実行中　– チェック無し</Text>
        {/* キーのヒント。2 行をまとめて、あいだに空きを入れない */}
        <Box flexDirection="column">
        {selected !== undefined && (
          <Box flexDirection="row" columnGap={2}>
            <Button key="down" hotkey="j" onPress={() => void moveSelection($, PR_PANE, 1, list.length).catch(() => undefined)}>
              下
            </Button>
            <Button key="up" hotkey="k" onPress={() => void moveSelection($, PR_PANE, -1, list.length).catch(() => undefined)}>
              上
            </Button>
            <Button key="open" hotkey="o" onPress={() => openInBrowser($, selected.url)}>
              開く
            </Button>
            <Button key="drop" hotkey="x" onPress={() => void dropPr($, selected.url).catch(() => undefined)}>
              外す
            </Button>
            <Button
              key="copy"
              hotkey="y"
              onPress={press => void copyText($, selected.url, press.surface, `PR #${selected.number} のURLをコピーしました`).catch(() => undefined)}
            >
              URLをコピー
            </Button>
          </Box>
        )}
        <Box flexDirection="row" columnGap={2}>
          <Button key="refresh" hotkey="r" onPress={() => void refreshPrsNow($).catch(() => undefined)}>
            更新
          </Button>
          <Button
            key="close"
            role="dismiss"
            hotkey="q"
            onPress={() => {
              void $.ui.close({ id: PR_PANE })
            }}
          >
            閉じる
          </Button>
        </Box>
        </Box>
      </Box>
    )
  })
}
