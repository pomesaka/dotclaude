// Claude が見出しを決める節。「待っていること」「決まったこと」「知っておいてほしいこと」など
export type Section = { title: string; items: string[] }

// Claude が書く、作業の状況。どの文も、会話を忘れた利用者が読んで分かるように書かれる
export type ReportBody = {
  // いましていること
  now: string
  // 次にすること。取りかかる順
  next: string[]
  // そのほかの節。並べる順は Claude が決める
  sections: Section[]
}

// updatedAt は、書いた時刻（エポックからのミリ秒）。turns は、書いた後に終わったターンの数
export type Report = ReportBody & { updatedAt: number; turns: number }

// セッションごとに覚えているもの
export type SessionRecord = {
  // このセッションで、状況を書き続けるか
  isOn: boolean
  // null は、まだ書かれていない
  report: Report | null
  // 最後に書いたか、書き直しを促してから終わったターンの数。促す時点を決めるのに使う
  unchecked: number
}

declare module 'claude-code' {
  interface PluginState {
    devrep: {
      record: SessionRecord
      // pane を最後に描き直させた時刻（エポックからのミリ秒）。「3時間前に更新」を出すのに使う
      clock: number
    }
  }
}
