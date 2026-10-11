import type { TestBody } from 'claude-code/testing'

// テストが共有する土台。セッション、$.store、pane、エージェント、下の層の描画を、決めた値で答える。
// テストの本体ではないので、ファイル名に .test を付けていない

export type On = Parameters<TestBody>[1]

export const END = { turnId: 't1', answer: '', durationMs: 0, isAborted: false, reason: 'answer' } as const
export const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

// プロンプトの下の行
export const line = {
  plugin: 'questions',
  surface: 'terminal' as const,
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  viewport: { columns: 142, rows: 40 },
}

// viewed は、利用者がいま開いているエージェントの会話。無ければ、メインの会話を開いている
const pane = (id: string, title: string, viewed?: string) => ({
  plugin: 'questions',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: id,
  props: {
    title,
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: viewed === undefined ? {} : { agentId: viewed },
  },
  viewport: { columns: 177, rows: 60 },
})

export const questionsPane = pane('questions', 'open questions')
export const consultPane = pane('consult', 'consult')

export type Given = {
  // $.store の中身。保留の一覧のキーは qs:<セッションID>
  stored?: { [key: string]: unknown }
  // HOME 以外の環境変数。無い名前は、設定されていない扱い
  env?: { [name: string]: string }
  // ほかの hook が、セッションの始めに足した文脈
  otherContext?: string[]
  // false は、エージェントを立てられない
  spawnsAgents?: boolean
  // 立てたエージェントの状態。無ければ、答え終わっている（completed）
  agentStatus?: 'running' | 'completed'
  // 相談用のエージェントの会話。無ければ、最初の依頼と説明だけ
  talk?: { role: 'user' | 'assistant'; text: string }[]
}

// world が立てるエージェントの ID
export const AGENT = 'a1'
// 相談用のエージェントの会話を開いている状態の、相談の pane
export const consultPaneViewing = pane('consult', 'consult', AGENT)

export const world = (on: On, given: Given = {}) => {
  const opened: string[] = []
  const closed: string[] = []
  const toasts: string[] = []
  const filled: string[] = []
  // Claude へ送った文
  const submitted: string[] = []
  // 立てたエージェントへの最初の依頼
  const spawned: string[] = []
  // エージェントへ送った文
  const sent: string[] = []
  // 実行したスラッシュコマンド
  const commands: string[] = []
  const seen = { store: new Map(Object.entries(given.stored ?? {})), opened, closed, toasts, filled, submitted, spawned, sent, commands }

  on('session.id', () => ({ value: 's1' }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('env.get', (_$, e) => ({ value: given.env?.[e.name] }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('classic.SessionStart', () => (given.otherContext === undefined ? {} : { additionalContext: given.otherContext }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: '' }))

  on('store.get', (_$, e) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_$, e) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    seen.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...seen.store.keys()] }))

  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.scroll', () => ({}))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  // WHY ID を一覧で答える: 土台は、ここで答えた agentId を捨てる（v2.1.296 の claude plugin test で確認）。
  // 立てるたびに、新しい ID のエージェントを一覧に足す。1 つ目が AGENT
  const agents: { id: string; description: string; type: string; status: 'running' | 'completed' }[] = []
  on('agent.spawn', (_$, e) => {
    if (given.spawnsAgents === false) return { deny: 'agents are off' }
    spawned.push(e.prompt)
    agents.push({
      id: agents.length === 0 ? AGENT : `a${agents.length + 1}`,
      description: e.description,
      type: 'fork',
      status: given.agentStatus ?? 'completed',
    })
    return { model: 'opus' }
  })
  on('agent.list', () => ({ value: [...agents] }))
  on('session.messages', () => ({
    value: (given.talk ?? [{ role: 'user' as const, text: '依頼' }, { role: 'assistant' as const, text: '説明' }]).map(one => ({ ...one, toolUses: [] })),
  }))
  on('command.run', (_$, e) => {
    commands.push(e.command)
    return { text: '' }
  })
  on('session.send', (_$, e) => {
    sent.push(e.text)
    return { isDelivered: true as const }
  })
  // 待ち時間は、テストのあいだ終わらない
  on('clock.after', () => new Promise<{ value: undefined }>(() => undefined))

  // テストの土台にはエンジンの描画が無い。下の層（エンジンの元の表示、ほかの Mod の帯）の代わりに、目印を返す
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>BELOW</Text>
  })
  return seen
}
