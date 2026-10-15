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
  // CI の状態。開いている PR と閉じた PR では、PR の最後のコミットのチェック。
  // マージ済みの PR では、マージでベースのブランチに入ったコミット（squash なら squash したコミット）のチェック。
  // null は、チェックが 1 つも無い
  checks: Checks | null
  // 失敗したチェックの名前（Rust lint、test など）。失敗が無ければ空。どのコミットのチェックかは checks と同じ
  failedChecks: string[]
  // マージされた時刻（エポックからのミリ秒）。マージされていなければ null
  mergedAt: number | null
  // 開いている PR が、ベースのブランチと競合しているか。null は、分からない（GitHub がまだ計算していない、開いていない）
  hasConflicts: boolean | null
  // null は、レビューの判定がまだ無い
  review: Review | null
}

// PR の一覧の 1 行。status の null は、まだ 1 度も状態を取れていない
export type PrRow = PrRef & { status: PrStatus | null }

// 1 回の取り直しで、Claude に知らせる変化があった PR
export type PrChanges = {
  // 開いていた PR が、マージ済みになった
  merged: PrRow[]
  // CI が失敗に変わった（マージ後の CI も含む）
  failed: PrRow[]
  // 開いている PR が、ベースのブランチと競合するようになった
  conflicted: PrRow[]
}

declare module 'claude-code' {
  interface PluginState {
    pr: {
      // このセッションで作るか直すかした PR。最後に触った PR が先頭。プロンプトの下の行と pane が、この順で出す
      prs: PrRow[]
      // pane の一覧で、キーで選んでいる行の位置
      cursor: number
      // Claude へ送るのを待っている、マージ、CI の失敗、競合の知らせ。null は、待っているものが無い。
      // ツールの後に気づいた分をここに溜め、ターンの終わりに送る
      pendingNotice: string | null
    }
  }
}
