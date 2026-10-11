import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { JjCounts } from '../types'
import { SESSION_CONTEXT } from './context'
import { cellWidth, clip } from './format'
import { CHANGED_ARGV, LOG_ARGV, SNAPSHOT_ARGV, UNPUSHED_ARGV, countsOf, parseLog } from './jj'

const counts = atom({ plugin: 'jj', key: 'counts' } as const, null)
const log = atom({ plugin: 'jj', key: 'log' } as const, null)
const LOG_PANE = 'jj-log'

// 色は、status-band の帯と揃えてある。目立たせる 1 つ（ACCENT）と、控えめな面（SURFACE）を分ける
const ACCENT = '#6cb6ff'
const AMBER = '#e8a35c'
const GREEN = '#7ee0a1'
const PURPLE = '#c9a0ff'
const INK = '#0d1117'
const SURFACE = '#30363d'
const SOFT = '#c9d1d9'

// read は記録せずに読む。snapshot は作業コピーを記録してから読む（番の終わりだけ）
type JjMode = 'read' | 'snapshot'

const jjCounts = async ($: EngineInterface, mode: JjMode): Promise<JjCounts | null> => {
  try {
    if (mode === 'read') {
      const [unpushed, changed] = await Promise.all([
        $.process.run(UNPUSHED_ARGV, { timeoutMs: 5_000 }),
        $.process.run(CHANGED_ARGV, { timeoutMs: 5_000 }),
      ])
      return countsOf(unpushed, changed)
    }
    // WHY 順番に実行する: 先に記録を済ませてから、記録後の状態で未 push を数える
    const changed = await $.process.run(SNAPSHOT_ARGV, { timeoutMs: 10_000 })
    const unpushed = await $.process.run(UNPUSHED_ARGV, { timeoutMs: 5_000 })
    return countsOf(unpushed, changed)
  } catch {
    // jj が入っていない、時間切れ、など。jj の項目を出さないだけで、hook は失敗させない
    return null
  }
}

// ログの pane に出す行を読み直す
const refreshLog = async ($: EngineInterface): Promise<void> => {
  const entries = await $.process.run(LOG_ARGV, { timeoutMs: 5_000 }).then(
    ran => (ran.exitCode === 0 ? parseLog(ran.stdout) : null),
    () => null,
  )
  // WHY 同じなら書かない: 書くたびに pane が描き直される
  await update($, log, current => (JSON.stringify(current) === JSON.stringify(entries) ? current : entries))
}

const isLogOpen = async ($: EngineInterface): Promise<boolean> => (await $.ui.panes()).some(pane => pane.id === LOG_PANE)

// 件数を数え直す。ログの pane を開いているあいだは、同じ時点でログも読み直す
// WHY ファイルの先頭の階層: $ を渡す先の関数は、ここに宣言したものしか読み込みを通らない（v2.1.295 で確認）
const refresh = async ($: EngineInterface, mode: JjMode): Promise<void> => {
  const counted = await jjCounts($, mode)
  // WHY 同じなら書かない: 書くたびに、プロンプトの下の行が描き直される
  await update($, counts, current =>
    current !== null && counted !== null && current.unpushed === counted.unpushed && current.changed === counted.changed ? current : counted,
  )
  if (await isLogOpen($)) await refreshLog($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($, 'read')
    return next(e)
  })

  // セッションの始め（開き直し、/clear、compact の後も含む）に、件数とボタンの届き方を Claude に伝える。
  // WHY サブエージェントには渡さない: 件数とボタンを見ているのは、メインのセッションの利用者だけ
  on('classic.SessionStart', async (_$, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), SESSION_CONTEXT] }
  }).catch((_$, e, next) => next(e))

  // Bash（jj commit、jj git push など）の後に数え直す。
  // WHY ここでは記録しない: 番の途中は Claude の jj コマンドと重なりうる。操作ログもツールのたびに増える
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'Bash') await refresh($, 'read')
    return ran
    // WHY catch: この hook はすべてのツールの呼び出しを通る。数え直しで何が起きても、ツールの結果はそのまま返す
  }).catch(($, e, next) => next(e))

  // 番の終わりにだけ作業コピーを記録する。Edit や Write で編集した分が、ここで件数に入る
  on('turn.complete', async ($, e, next) => {
    await refresh($, 'snapshot')
    return next(e)
  })

  // プロンプトの下の行に、jj の件数とボタンを足す。下の層（エンジンの元の表示、status-band の帯、ほかの Mod の札）の右に並べる。
  // WHY 下の層を包むだけにする: この行は、複数の Mod が重ねて描く。ほかの Mod の中身を知らずに、自分の札を足せる。
  // WHY Box に width を付けない: 下の層の木を width の付いた Box に入れると、エンジンが重ねた hook の全部を捨てて、
  // 元の表示だけを描く（v2.1.296 で確認）。下へ渡す幅（viewport）も書き換えられない
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.surface !== 'terminal') return inner
    const now = await read($, counts)
    if (now === null) return inner
    const { Box, Button, Text } = $.ui.resolve(e)
    // スラッシュコマンドを、利用者が打ったのと同じようにすぐ実行する。
    // WHY 失敗したら fill: $.command.run は知らない名前を拒む。そのときも操作を失わないよう、入力欄に入れて知らせる
    const run = (command: string) => () => {
      $.command.run({ command }).catch(() => {
        void $.prompt.fill({ text: `/${command}` })
        $.ui.toast(`/${command} をすぐには実行できませんでした。入力欄に入れたので、Enterで送ってください`, { timeoutMs: 8_000 })
      })
    }
    // 押した時点のログを読んでから、pane を開く。利用者の操作で開くので、幅に関係なく出る。
    // WHY 直接開く: スラッシュコマンドを経由すると、ターンの途中に押したときに、ターンが終わるまで開かない
    const openLog = () => {
      void refreshLog($).then(() => $.ui.open({ id: LOG_PANE, title: 'jj log', focus: true, closeOnEscape: true }))
    }
    // 次にやることを 1 つだけ目立たせる。未コミットがあればコミット、無ければログ
    const primary = now.changed > 0 ? 'commit' : 'log'
    const pill = (name: string) =>
      name === primary ? { backgroundColor: ACCENT, color: INK, bold: true } : { backgroundColor: SURFACE, color: SOFT, bold: false }

    return (
      <Box flexDirection="row" columnGap={1}>
        {inner}
        {/* WHY flexShrink 0: 下の層の帯が行の幅いっぱいを取るので、縮めてよい箱だと、2 桁の件数が折り返す（v2.1.296 の実機で確認） */}
        {now.changed > 0 && (
          <Box flexDirection="row" columnGap={1} flexShrink={0}>
            <Text color={AMBER}>●</Text>
            <Text>{now.changed}</Text>
          </Box>
        )}
        {now.unpushed > 0 && (
          <Box flexDirection="row" columnGap={1} flexShrink={0}>
            <Text color={ACCENT}>↑</Text>
            <Text>{now.unpushed}</Text>
          </Box>
        )}
        {/* WHY hotkey を付けない: plain の Button は hotkey があると「c: commit」と描かれ、札の見た目が崩れる。
            クリックか、ctrl+x tab の後の Tab と Enter で押す */}
        {now.changed > 0 && (
          <Button key="commit" plain onPress={run('jjcommit')}>
            <Text {...pill('commit')}> commit </Text>
          </Button>
        )}
        <Button key="log" plain onPress={openLog}>
          <Text {...pill('log')}> log </Text>
        </Button>
      </Box>
    )
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const entries = await read($, log)
    const width = e.props.bodyColumns
    const hasUnpushed = (entries ?? []).some(entry => !entry.isPushed && !entry.isEmpty)

    return (
      <Box flexDirection="column" gap={1} width={width}>
        {entries === null ? (
          <Text dimColor>jj のログを読めませんでした（jj のリポジトリの外かもしれません）</Text>
        ) : (
          <Box flexDirection="column">
            {entries.map(entry => {
              const mark = entry.isWorkingCopy ? '@' : entry.isPushed ? '◆' : '↑'
              const tags = entry.bookmarks.join(' ')
              const title = entry.title !== '' ? entry.title : entry.isEmpty ? '(empty)' : '(no description)'
              // 印 1、ID 8、ブックマーク、経過時間と、あいだの空き 1 桁ずつを引いた残りを、説明に使う
              const room = width - (1 + 1 + 8 + 1 + (tags === '' ? 0 : cellWidth(tags) + 1) + 1 + cellWidth(entry.age))
              return (
                <Box flexDirection="row" justifyContent="space-between" width={width}>
                  <Box flexDirection="row" columnGap={1}>
                    <Text bold={entry.isWorkingCopy} color={entry.isPushed ? undefined : ACCENT} dimColor={entry.isPushed}>
                      {mark}
                    </Text>
                    <Text color={PURPLE}>{entry.id}</Text>
                    {tags !== '' && <Text color={GREEN}>{tags}</Text>}
                    <Text dimColor={entry.title === '' || entry.isPushed}>{clip(title, Math.max(8, room))}</Text>
                  </Box>
                  <Text dimColor>{entry.age}</Text>
                </Box>
              )
            })}
          </Box>
        )}
        <Text dimColor>@ 作業コピー　↑ まだpushしていない　◆ push済み</Text>
        <Box flexDirection="row" columnGap={2}>
          <Button key="refresh" hotkey="r" onPress={() => void refreshLog($)}>
            更新
          </Button>
          {/* WHY fill: リモートに出る操作で、押し間違いをやり直せない。入力欄に入れるだけにして、Enter を挟む */}
          {hasUnpushed && (
            <Button
              key="push"
              hotkey="p"
              onPress={() => {
                void $.prompt.fill({ text: 'pushしといて' })
              }}
            >
              push
            </Button>
          )}
          <Button
            key="close"
            role="dismiss"
            hotkey="q"
            onPress={() => {
              void $.ui.close({ id: LOG_PANE })
            }}
          >
            閉じる
          </Button>
        </Box>
      </Box>
    )
  })
}
