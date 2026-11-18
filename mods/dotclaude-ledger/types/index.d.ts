// 記録の 1 行の形（Entry）は hooks/ledger.ts にある。スキルのスクリプトも読むので、claude-code の型から離して置く
// まだコミットされていない書き込みのファイルの数
export type Pending = number

declare module 'claude-code' {
  interface PluginState {
    'dotclaude-ledger': {
      // 全セッションの記録を合わせた数
      pending: Pending
    }
  }
}
