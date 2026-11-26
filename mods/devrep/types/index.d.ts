// 会話を分岐させて書かせる、作業の状況。どの文も、会話を忘れた利用者が読んで分かるように書かれる。
// WHY 2 つだけ: 戻ってきた利用者が読むのは、いまどうなっているかと、自分が動かないと止まっていること。
//   次の手、決まったこと、条件つきの確認を並べていたら、読む気にならない長さになった（2026-11-27 に pomesaka と決めた）
export type ReportBody = {
  // いまどうなっているか。前に書いた状況から変わったことと、何を待っているか
  now: string
  // 利用者がいま動かないと作業が止まっていること（コマンドの実行、画面での確認、決めること）。空は、待っていることが無い
  todo: string[]
}

// updatedAt は、書いた時刻（エポックからのミリ秒）。turns は、書いた後に終わったターンの数
export type Report = ReportBody & { updatedAt: number; turns: number }

// セッションごとに覚えているもの
export type SessionRecord = {
  // 自動更新するか。OFF でも、pane の「更新する」で書ける
  isOn: boolean
  // null は、まだ書かれていない
  report: Report | null
  // 最後に書いてから終わったターンの数。自動更新の時点を決めるのに使う。書けなかったときは戻さず、次のターンで書き直す
  unchecked: number
}

declare module 'claude-code' {
  interface PluginState {
    devrep: {
      record: SessionRecord
      // pane を最後に描き直させた時刻（エポックからのミリ秒）。「3時間前に更新」を出すのに使う
      clock: number
      // 分岐に状況を書かせている最中
      isWriting: boolean
    }
  }
}
