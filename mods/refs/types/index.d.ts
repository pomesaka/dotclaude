// このセッションが参照した文書や URL。url は、URL かファイルのパス。
// title は短い題名、note は何が分かったかの一言。どちらも、無ければ空文字
export type Reference = { url: string; title: string; note: string }

declare module 'claude-code' {
  interface PluginState {
    refs: {
      // このセッションが参照した文書や URL。最後に足したものが先頭
      references: Reference[]
      // pane の一覧で、キーで選んでいる行の位置
      cursor: number
    }
  }
}
