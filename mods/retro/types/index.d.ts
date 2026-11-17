// 会話を分岐させて見つけさせた、次に活かせる発見。書き手のエージェントに渡す
export type Finding = {
  // 1 行の見出し。前に見つけたものと重ならないかを比べるのにも使う
  title: string
  // 何が起きて、次にどう動くべきか
  detail: string
  // 根拠にした会話の発言や出来事
  evidence: string
}

// 振り返りを始めたきっかけ。
// turn は一定のターン数と出来事、completion はコミットや PR の作成、compact は compact の直前、manual は /retro
export type Trigger = 'turn' | 'completion' | 'compact' | 'manual'

// 書き手のエージェントの報告。agentId は、報告した書き手。同じ書き手の報告は 1 件にまとめる
export type LogEntry = { at: number; agentId: string; text: string }

// セッションごとに覚えているもの
export type SessionRecord = {
  // 自動で振り返るか。OFF でも /retro で振り返れる
  isOn: boolean
  // 最後に振り返った後に、メインが終えたターンの数
  turns: number
  // 最後に振り返った後に、利用者が直した回数（「違う」「なんで」などで始まる発言）
  corrections: number
  // 最後に振り返った後に、中断やエラーで止まったターンの数
  stops: number
  // これまでに見つけた発見の見出し。新しいものから
  found: string[]
  // 書き手のエージェントの報告。新しいものから
  log: LogEntry[]
}

declare module 'claude-code' {
  interface PluginState {
    retro: {
      // 分岐に発見を聞いている最中
      isJudging: boolean
    }
  }
}
