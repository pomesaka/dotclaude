export type Status = {
  model: string
  // 0 から 100。最初の応答の前は undefined
  contextPercent: number | undefined
  // ホームを ~ に縮めた作業ディレクトリ
  directory: string
}

declare module 'claude-code' {
  interface PluginState {
    'status-band': {
      // null は、まだ 1 度も集めていない。帯を出さない
      status: Status | null
    }
  }
}
