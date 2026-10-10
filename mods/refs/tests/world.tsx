import type { TestBody } from 'claude-code/testing'

// テストが共有する土台。セッション、$.store、pane、下の層の描画を、決めた値で答える。
// テストの本体ではないので、ファイル名に .test を付けていない

export type On = Parameters<TestBody>[1]

export const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

// プロンプトの下の行
export const line = {
  plugin: 'refs',
  surface: 'terminal' as const,
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  viewport: { columns: 142, rows: 40 },
}

// bodyRows は、pane に見えている行数
const pane = (bodyRows: number) => ({
  plugin: 'refs',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'references',
  props: { title: 'references', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} },
  viewport: { columns: 177, rows: 60 },
})

export const referencesPane = pane(40)
// 一覧が収まらない、背の低い pane
export const shortReferencesPane = pane(14)

export type Given = {
  // $.store の中身。一覧のキーは refs:<セッションID>
  stored?: { [key: string]: unknown }
  // ほかの hook が、セッションの始めに足した文脈
  otherContext?: string[]
}

export const world = (on: On, given: Given = {}) => {
  // 実行したコマンド
  const ran: string[][] = []
  const opened: string[] = []
  const toasts: string[] = []
  // クリップボードへコピーした文
  const copied: string[] = []
  const seen = { store: new Map(Object.entries(given.stored ?? {})), ran, opened, toasts, copied }

  on('session.id', () => ({ value: 's1' }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('classic.SessionStart', () => (given.otherContext === undefined ? {} : { additionalContext: given.otherContext }))
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

  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  // テストの土台にはエンジンの描画が無い。下の層（エンジンの元の表示、ほかの Mod の帯）の代わりに、目印を返す
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>BELOW</Text>
  })
  return seen
}
