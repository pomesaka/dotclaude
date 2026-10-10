declare module 'claude-code' {
  interface PluginState {
    'next-step': {
      // いまプロンプトの上に出している札。押したときに Claude へ送る文そのもの。空は、出すものが無い
      suggestions: string[]
      // 2 枚めからの案を、モデルに作らせている最中
      isThinking: boolean
    }
  }
}
