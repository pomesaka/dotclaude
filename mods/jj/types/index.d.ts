export type JjCounts = { unpushed: number; changed: number }

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

declare module 'claude-code' {
  interface PluginState {
    jj: {
      // null は、まだ数えていないか、jj のリポジトリでないか、jj を実行できなかった。件数もボタンも出さない
      counts: JjCounts | null
      // ログの pane に出す行。null は、まだ読んでいないか、jj を実行できなかった
      log: LogEntry[] | null
    }
  }
}
