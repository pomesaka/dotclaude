// dotclaude の作業コピーへの 1 回の書き込み。
// file は リポジトリの直下からの相対パス、cwd は書いたセッションの作業ディレクトリ（元のプロジェクト）。
// excerpt は書いた中身の頭、why は書いた理由に当たる依頼の文。agentId はサブエージェントが書いたときだけ
export type Entry = {
  at: string
  session: string
  agentId?: string
  cwd: string
  tool: string
  file: string
  excerpt: string
  why: string
}

declare module 'claude-code' {
  interface PluginState {
    'dotclaude-ledger': {
      // まだコミットされていない書き込みのファイルの数（全セッションの記録を合わせたもの）
      pending: number
    }
  }
}
