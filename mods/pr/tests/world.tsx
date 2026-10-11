import type { TestBody } from 'claude-code/testing'

// テストが共有する土台。セッション、GitHub、$.store、pane を、決めた値で答える。
// テストの本体ではないので、ファイル名に .test を付けていない

export type On = Parameters<TestBody>[1]

export const END = { turnId: 't1', answer: '', durationMs: 0, isAborted: false, reason: 'answer' } as const
export const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

// プロンプトの下の行。幅は viewport から決まる（左の字下げの 2 桁を引く）
export const line = (width: number) => ({
  plugin: 'pr',
  surface: 'terminal' as const,
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  viewport: { columns: width + 2, rows: 40 },
})

// bodyRows は、pane に見えている行数
const pane = (id: string, title: string, bodyRows = 40) => ({
  plugin: 'pr',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: id,
  props: { title, isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} },
  viewport: { columns: 177, rows: 60 },
})

export const prPane = pane('pull-requests', 'pull requests')
// 一覧が収まらない、背の低い pane
export const shortPrPane = pane('pull-requests', 'pull requests', 12)

export const prUrl = (number: number, repo = 'o/r') => `https://github.com/${repo}/pull/${number}`

// GitHub が 1 つの PR について返す値。failed は、失敗したチェックの名前
export const view = (title: string, state: string, rollup: string | null = 'SUCCESS', failed: string[] = []) => ({
  title,
  state,
  isDraft: false,
  reviewDecision: 'APPROVED',
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup:
            rollup === null
              ? null
              : {
                  state: rollup,
                  contexts: {
                    nodes: [
                      { __typename: 'CheckRun', name: 'build', conclusion: 'SUCCESS' },
                      ...failed.map(name => ({ __typename: 'CheckRun', name, conclusion: 'FAILURE' })),
                    ],
                  },
                },
        },
      },
    ],
  },
})

// Bash の結果に Claude Code が付ける、PR への操作
export const operated = (number: number, action: string) => ({ stdout: '', gitOperation: { pr: { number, url: prUrl(number), action } } })

export type Given = {
  // $.store の中身。PR の一覧のキーは prs:<セッションID>
  stored?: { [key: string]: unknown }
  // GitHub にある PR。url ごと。無い url は null（見つからない）で答える
  views?: { [url: string]: ReturnType<typeof view> }
  // Bash の結果として返す値
  bash?: unknown
  // 開いている pane の id
  panes?: string[]
  // false は、pane を置けなかった（幅が足りない）
  isPlaced?: boolean
  // ほかの hook が、セッションの始めに足した文脈
  otherContext?: string[]
}

// 問い合わせを前から読む。リポジトリの宣言の後に続く PR は、そのリポジトリのもの
const ASKED = /(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)|(p\d+): pullRequest\(number: (\d+)\)/g

export const world = (on: On, given: Given = {}) => {
  // gh を呼んだ回ごとに、問い合わせた PR の url
  const queried: string[][] = []
  // gh 以外に実行したコマンド
  const ran: string[][] = []
  const opened: string[] = []
  const toasts: string[] = []
  // Claude へ送った文
  const submitted: string[] = []
  // クリップボードへコピーした文
  const copied: string[] = []
  // $.clock.every が頼んだ待ち時間（ミリ秒）。1 周期ごとに 1 つ増える
  const periods: number[] = []
  // いま待っている周期を終わらせる関数。null は、待っている周期が無い
  let release: (() => void) | null = null
  const seen = {
    store: new Map(Object.entries(given.stored ?? {})),
    queried,
    ran,
    opened,
    toasts,
    submitted,
    copied,
    periods,
    // 時間を 1 周期ぶん進める。タイマーの関数が 1 回走る
    tick: () => {
      const go = release
      release = null
      go?.()
    },
  }
  const output = (stdout: string, exitCode = 0) => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('session.id', () => ({ value: 's1' }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('classic.SessionStart', () => (given.otherContext === undefined ? {} : { additionalContext: given.otherContext }))
  // 周期は、テストが tick() を呼ぶまで終わらない
  on(
    'clock.every',
    (_$, e) =>
      new Promise<{ value: undefined }>(resolve => {
        periods.push(e.ms)
        release = () => resolve({ value: undefined })
      }),
  )
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: given.bash ?? '' }))

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
    if (e.argv[0] !== 'gh') {
      seen.ran.push([...e.argv])
      return output('')
    }
    // 問い合わせを読み、聞かれた PR だけを、聞かれた名前で答える
    const urls: string[] = []
    const data: { [alias: string]: { [alias: string]: unknown } } = {}
    let repository = { alias: '', path: '' }
    for (const [, alias, owner, name, prAlias, number] of (e.argv[4] ?? '').matchAll(ASKED)) {
      if (alias !== undefined) {
        repository = { alias, path: `${owner}/${name}` }
        data[alias] = {}
        continue
      }
      const asked = `https://github.com/${repository.path}/pull/${number}`
      urls.push(asked)
      const answers = data[repository.alias]
      if (answers !== undefined && prAlias !== undefined) answers[prAlias] = given.views?.[asked] ?? null
    }
    seen.queried.push(urls)
    return output(JSON.stringify({ data }))
  })

  on('ui.panes', () => ({
    value: (given.panes ?? []).map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    return { value: given.isPlaced === false ? { isPlaced: false, reason: 'too narrow' } : { isPlaced: true } }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  // テストの土台にはエンジンの描画が無い。プロンプトの下の行に元から出ている表示の代わりに、目印を返す
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  return seen
}
