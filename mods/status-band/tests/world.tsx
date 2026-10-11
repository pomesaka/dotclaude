import type { TestBody } from 'claude-code/testing'

// テストが共有する土台。セッションの値を、決めた値で答える。
// テストの本体ではないので、ファイル名に .test を付けていない

export type On = Parameters<TestBody>[1]

export const END = { turnId: 't1', answer: '', durationMs: 0, isAborted: false, reason: 'answer' } as const

// プロンプトの下の行。幅は viewport から決まる（左の字下げの 2 桁を引く）
export const line = (width: number) => ({
  plugin: 'status-band',
  surface: 'terminal' as const,
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  viewport: { columns: width + 2, rows: 40 },
})

export type Given = {
  // ほかの hook が、セッションの始めに足した文脈
  otherContext?: string[]
}

export const world = (on: On, given: Given = {}) => {
  // セッションの値を読んだ回数
  const seen = { usageReads: 0 }

  on('session.model', () => ({ value: 'opus' }))
  on('session.cwd', () => ({ value: '/Users/p/github.com/pomesaka/dotclaude' }))
  on('session.usage', () => {
    seen.usageReads += 1
    return {
      value: { startedAt: 0, context: { window: 200_000, tokens: 94_000, percent: 47 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23.5 }], cost: { usd: 173.614 } },
    }
  })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/Users/p' : undefined }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('classic.SessionStart', () => (given.otherContext === undefined ? {} : { additionalContext: given.otherContext }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: '' }))
  // テストの土台にはエンジンの描画が無い。プロンプトの下の行に元から出ている表示の代わりに、目印を返す
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  return seen
}
