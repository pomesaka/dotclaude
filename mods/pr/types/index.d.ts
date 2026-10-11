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
    pr: {
      // このセッションで作るか直すかした PR。最後に触った PR が先頭。プロンプトの下の行と pane が、この順で出す
      prs: PrRow[]
      // pane の一覧で、キーで選んでいる行の位置
      cursor: number
      // Claude へ送るのを待っている、マージと CI の失敗の知らせ。null は、待っているものが無い。
      // ツールの後に気づいた分をここに溜め、ターンの終わりに送る
      pendingNotice: string | null
    }
  }
}
