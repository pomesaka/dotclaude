// 発見をどう防ぐか。doc は文書に書く。mechanism は hook、lint、スクリプト、Mod、環境の直しで防げるので、文書に書かずに作る候補にする。
// request は、スキル、エージェント、Mod の使いにくさ（守りにくい決まり、長すぎる出力、合わない手順）で、dotclaude のセッションが作り直す
export type Kind = 'doc' | 'mechanism' | 'request'

// 会話を分岐させて見つけさせた、次に活かせる発見
export type Finding = {
  // 1 行の見出し。前に見つけたものと重ならないかを比べるのにも使う
  title: string
  // 何が起きて、次にどう動くべきか
  detail: string
  // 根拠にした会話の発言や出来事
  evidence: string
  kind: Kind
  // 1 回でも害が大きい（データを失う、公開してはいけないものを出す、外へ送る、お金に響く）。2 回目を待たずに文書に上げる
  isSevere: boolean
  // 控えにある同じ発見の id。null は新しい発見
  same: string | null
  // request のときの、使いにくかったスキル、エージェント、Mod の名前。ほかの種類では null
  target: string | null
}

// 控えの 1 件。セッションをまたいで、同じ発見が何回出たかを数える
export type Candidate = {
  id: string
  title: string
  detail: string
  kind: Kind
  // 最後に文書に上げた後に出た回数
  count: number
  // 根拠。新しいものから
  evidence: string[]
  // 最後に出た時刻
  lastAt: number
  // 最後に文書に上げた時刻。null はまだ上げていない
  writtenAt: number | null
  // request のときの対象の名前。ほかの種類では null
  target: string | null
}

// 控えの出来事。~/.claude/retro/<セッションID>.jsonl に 1 行ずつ足し、全ファイルを at の順に束ねて控えの一覧を作る。
// WHY 出来事で持つ: 1 つの値を読んで書き戻すと、同時に振り返った別のセッションの回数を上書きで消した
// seen は発見が 1 回出た、written は文書に上げた、dropped は /retro drop で外した、imported は $.store からの移し替え
export type RetroEvent =
  | { type: 'seen'; id: string; title: string; detail: string; kind: Kind; evidence: string; target: string | null; at: number }
  | { type: 'written'; id: string; at: number }
  | { type: 'dropped'; id: string; at: number }
  | { type: 'imported'; candidate: Candidate; at: number }

// 振り返りを始めたきっかけ。
// turn は一定のターン数と出来事、completion はコミットや PR の作成、compact は compact の直前、manual は /retro
export type Trigger = 'turn' | 'completion' | 'busy' | 'compact' | 'manual'

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
