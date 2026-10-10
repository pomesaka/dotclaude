export type RichAnswers = { [key: string]: string }

declare module 'claude-code' {
  interface PluginState {
    rich: {
      // pane に出している説明。show ツールの入力をそのまま持つ（描くたびに parse し直す）
      paneInput: unknown
      // 質問への答え。会話の中の行は tool_use_id、pane は pane の id ごとに 1 つ
      answers: StateFamily<RichAnswers>
      // 最後に送った文。答えを選び直すと送る文が変わり、もう一度送れるようになる
      sent: StateFamily<string>
      // いま開いているタブの番号。名前はブロックの位置（"2" など）。開き直すと最初のタブに戻る
      tabs: StateFamily<{ [id: string]: number }>
    }
  }
}
