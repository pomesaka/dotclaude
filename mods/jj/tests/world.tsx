import type { TestBody } from 'claude-code/testing'

// テストが共有する土台。jj と pane を、決めた値で答える。
// テストの本体ではないので、ファイル名に .test を付けていない

export type On = Parameters<TestBody>[1]

export const END = { turnId: 't1', answer: '', durationMs: 0, isAborted: false, reason: 'answer' } as const
export const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

// プロンプトの下の行
export const line = {
  plugin: 'jj',
  surface: 'terminal' as const,
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  viewport: { columns: 142, rows: 40 },
}

export const logPane = {
  plugin: 'jj',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'jj-log',
  props: { title: 'jj log', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 177, rows: 60 },
}

// jj log のテンプレートが出す形。作業コピー、未push、push済みの 3 行
const LOG = [
  'aaaaaaaa\t@\t\tempty\t\t14 minutes ago\t',
  'bbbbbbbb\t\t\t\tfeat/x\t2 hours ago\tfeat: まだpushしていない変更',
  'cccccccc\t\tpushed\t\tmain\t7 hours ago\tfix: push済みの変更',
].join('\n')

export type Given = {
  // jj の出力。unpushed は未 push のコミットの行、changed は変わったファイルの行
  unpushed?: string
  changed?: string
  log?: string
  // jj の終了コード。1 は、jj のリポジトリの外
  jjExitCode?: number
  // 開いている pane の id
  panes?: string[]
  // false は、スラッシュコマンドの実行が拒まれる
  runsCommands?: boolean
  // ほかの hook が、セッションの始めに足した文脈
  otherContext?: string[]
}

export const world = (on: On, given: Given = {}) => {
  // 実行した jj の種類。作業コピーを記録する実行（--ignore-working-copy が無い）には ! を付ける
  const jj: string[] = []
  const opened: string[] = []
  const toasts: string[] = []
  const filled: string[] = []
  const commands: string[] = []
  const seen = { jj, opened, toasts, filled, commands }

  on('session.start', () => ({ cwd: '/repo' }))
  on('classic.SessionStart', () => (given.otherContext === undefined ? {} : { additionalContext: given.otherContext }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: '' }))

  on('process.run', (_$, e) => {
    // ログの pane 用は範囲が ancestors(...)。件数用の jj log（未push）と区別する
    const kind = e.argv.some(arg => arg.startsWith('ancestors(')) ? 'log' : e.argv[1] === 'log' ? 'unpushed' : 'changed'
    jj.push(e.argv.includes('--ignore-working-copy') ? kind : `${kind}!`)
    const stdout = kind === 'log' ? (given.log ?? LOG) : kind === 'unpushed' ? (given.unpushed ?? '') : (given.changed ?? '')
    return { value: { exitCode: given.jjExitCode ?? 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  on('ui.panes', () => ({
    value: (given.panes ?? []).map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  if (given.runsCommands !== false) {
    on('command.run', (_$, e) => {
      commands.push(e.command)
      return { text: '' }
    })
  }
  // テストの土台にはエンジンの描画が無い。プロンプトの下の行に元から出ている表示の代わりに、目印を返す
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  return seen
}
