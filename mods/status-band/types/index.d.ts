export type JjCounts = { unpushed: number; changed: number }

export type Status = {
  model: string
  // 0 から 100。最初の応答の前は undefined
  contextPercent: number | undefined
  // ホームを ~ に縮めた作業ディレクトリ
  directory: string
  // null は「jj のリポジトリでない、または jj を実行できなかった」
  jj: JjCounts | null
}

// jj log の 1 行
export type LogEntry = {
  // change ID の先頭
  id: string
  isWorkingCopy: boolean
  // どれかのリモートのブックマークから辿れる
  isPushed: boolean
  isEmpty: boolean
  bookmarks: string[]
  // 「14m」「7h」のように縮めた経過時間
  age: string
  // 説明の 1 行目。無ければ空文字
  title: string
}

// PR を指す値。url は https://github.com/<owner>/<repo>/pull/<番号> の形に揃えてある
export type PrRef = {
  url: string
  // owner/repo
  repo: string
  number: number
}

export type Checks = 'passing' | 'failing' | 'pending'

export type Review = 'approved' | 'changes_requested' | 'review_required'

export type PrStatus = {
  title: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  // null は、チェックが 1 つも無い
  checks: Checks | null
  // 失敗したチェックの名前（Rust lint、test など）。失敗が無ければ空
  failedChecks: string[]
  // null は、レビューの判定がまだ無い
  review: Review | null
}

// PR の一覧の 1 行。status の null は、まだ 1 度も状態を取れていない
export type PrRow = PrRef & { status: PrStatus | null }

declare module 'claude-code' {
  interface PluginState {
    'status-band': {
      // null は、まだ 1 度も集めていない。帯を出さない
      status: Status | null
      // ログの pane に出す行。null は、まだ読んでいないか、jj を実行できなかった
      log: LogEntry[] | null
      // このセッションで作るか直すかした PR。最後に触った PR が先頭。帯と PR の pane が、この順で出す
      prs: PrRow[]
      // pane の一覧で、キーで選んでいる行の位置。キーは pane の id。まだ動かしていない pane は、項目が無い
      cursors: { [pane: string]: number }
      // Claude へ送るのを待っている、マージの知らせ。null は、待っているものが無い。
      // ツールの後に気づいた分をここに溜め、ターンの終わりに送る
      pendingNotice: string | null
    }
  }
}
