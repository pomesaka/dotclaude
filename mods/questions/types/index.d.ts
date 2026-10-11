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
    }
  }
}
