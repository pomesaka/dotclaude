// 仮に決めて先へ進んだこと。あとで利用者が決め直す
export type OpenQuestion = {
  // 一覧と会話で使う番号（Q3 の 3）
  id: number
  // 決めること
  question: string
  // 何を決めるのか、選ぶと何が変わるのかの説明。無ければ空文字
  detail: string
  // 選択肢。2 つ以上
  options: string[]
  // 仮に置いた選択肢。options の 1 つ
  assumed: string
  // 利用者が pane で選んで、Claude に送った答え。options の 1 つ。null は、まだ選んでいない
  answer: string | null
}

// 保留を束ねて見る、ほかのセッション。束ねる側のセッションが、自分の pane に相手の保留を出す
export type FollowedSession = {
  // 相手の Claude のセッション ID（相手の $.session.id() の答え）
  sessionId: string
  // pane の見出しに出す名前
  label: string
}

// 届けられなかった答え。持ち主のセッションが、次に始まるか見回ったときに受け取る
export type QueuedAnswer = {
  // 持ち主のセッションでの番号（Q3 の 3）
  id: number
  // 選んだ選択肢
  option: string
}

// 束ねたセッション 1 つ分の保留。持ち主のセッションが $.store に書いた一覧を、読んで写したもの。
// 写しなので、この Mod は書き換えない。答えは持ち主のセッションへ送り、持ち主が印を付ける
export type OthersQuestions = {
  session: FollowedSession
  questions: OpenQuestion[]
  // 持ち主が止まっていて、まだ届いていない答え
  queued: QueuedAnswer[]
}

// 保留 1 件についての相談。メインの会話を引き継いだ別のエージェントと、そのエージェントの会話の画面でやりとりする
export type Consult = {
  // 相談を始めた時点の保留
  question: OpenQuestion
  // 相談用のエージェント。null は、立てている最中
  agentId: string | null
  // 結論をメインへ送るために、エージェントの要約を待っている
  isHandingOff: boolean
}

declare module 'claude-code' {
  interface PluginState {
    questions: {
      // 仮に決めて先へ進んだこと。古いものが先頭（番号の順）
      questions: OpenQuestion[]
      // 開いている相談。null は、相談していない
      consult: Consult | null
      // 束ねたセッションの保留。束ねた順
      others: OthersQuestions[]
    }
  }
}
