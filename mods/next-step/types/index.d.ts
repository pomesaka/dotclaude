// 次の一手の案。label はカードに出す短い札、prompt は押したときに Claude へ送る文
export type Suggestion = { label: string; prompt: string }

declare module 'claude-code' {
  interface PluginState {
    'next-step': {
      // いまプロンプトの上に出している案。空は、出すものが無い
      suggestions: Suggestion[]
      // 案をモデルに作らせている最中
      isThinking: boolean
    }
  }
}
