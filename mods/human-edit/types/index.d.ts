// いま利用者に編集してもらっているファイル。path はプロジェクトのルートからの相対パス。
// instructions の null は、指示が無い
export type Editing = { path: string; instructions: string | null }

declare module 'claude-code' {
  interface PluginState {
    'human-edit': {
      // null は、編集してもらっているファイルが無い
      editing: Editing | null
    }
  }
}
