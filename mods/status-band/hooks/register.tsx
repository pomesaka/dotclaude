import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Status } from '../types'
import { SESSION_CONTEXT } from './context'
import { BAR_CELLS, filledCells, isSameStatus, levelOf, shortPath, type Level } from './format'

const status = atom({ plugin: 'status-band', key: 'status' } as const, null)

// 帯の色。ほかの Mod（jj、pr、refs、questions）が帯の右に足す札も、この色に揃えている
const ACCENT = '#6cb6ff'
const AMBER = '#e8a35c'
const RED = '#ff7b72'
const LEVEL_COLOR: { [level in Level]: string } = { calm: ACCENT, watch: AMBER, full: RED }

// これより狭いと、場所を出さない（桁）
const WIDE = 120
// 場所の表示に使う桁の上限。超えたら途中を省いて、末尾のディレクトリを収まるだけ残す
// WHY 40: ~/github.com/<owner>/<repo> の形（30 桁前後）は省かずに出したい
const DIRECTORY_MAX = 40

// 帯に出す値を集め直す
// WHY ファイルの先頭の階層: $ を渡す先の関数は、ここに宣言したものしか読み込みを通らない（v2.1.295 で確認）
const refresh = async ($: EngineInterface): Promise<void> => {
  const [model, usage, cwd, home] = await Promise.all([$.session.model(), $.session.usage(), $.session.cwd(), $.env.get('HOME')])
  // WHY 同じなら書かない: 書くたびに帯が描き直される
  await update($, status, current => {
    const next: Status = { model, contextPercent: usage.context.percent, directory: shortPath(cwd, home, DIRECTORY_MAX) }
    return isSameStatus(current, next) ? current : next
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  // セッションの始めに、利用者の画面に出ているものを Claude に伝える。
  // WHY classic.SessionStart: 起動、再開、fork、/clear、compact のたびに来る（入力の source の型で確認）。
  // /clear と compact は前の文脈を落とすので、そのたびに渡し直す。claude-deck の Mod と同じやり方。
  // WHY サブエージェントには渡さない: 帯を見ているのは、メインのセッションの利用者だけ
  on('classic.SessionStart', async (_$, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), SESSION_CONTEXT] }
  }).catch((_$, e, next) => next(e))

  // コンテキストはツールのたびに動く
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    await refresh($)
    return ran
    // WHY catch: この hook はすべてのツールの呼び出しを通る。集め直しで何が起きても、ツールの結果はそのまま返す
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  // プロンプトの下の行に描く。古いステータス行があった場所と同じ。
  // WHY PromptHint: プロンプトの下で、色とボタンを使える場所はここだけ。
  // WHY NOT AbovePrompt: 上の帯は調査（survey）と場所を取り合い、入力欄を下へ押す
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // この行に元から出ている表示（manual mode on、esc to interrupt など）。消さずに、帯の下に並べる
    const original = await next(e)
    const now = await read($, status)
    if (e.surface !== 'terminal' || now === null) return original

    const { Box, Text } = $.ui.resolve(e)
    // WHY -2: この行は左に 2 桁の字下げが付く（目測、未計測）
    const width = Math.max(40, (e.viewport?.columns ?? 100) - 2)
    const percent = now.contextPercent
    const filled = percent === undefined ? 0 : filledCells(percent)

    return (
      <Box flexDirection="column">
        {/* WHY width を付ける: 帯を行の幅いっぱいに取り、ほかの Mod が足す札を右端へ寄せる。札が足されると、その分だけ縮む */}
        <Box flexDirection="row" columnGap={3} width={width}>
          <Text bold color={ACCENT}>
            {now.model}
          </Text>
          {percent !== undefined && (
            <Box flexDirection="row" columnGap={1}>
              <Box flexDirection="row">
                <Text color={LEVEL_COLOR[levelOf(percent)]}>{'━'.repeat(filled)}</Text>
                <Text dimColor>{'─'.repeat(BAR_CELLS - filled)}</Text>
              </Box>
              <Text color={levelOf(percent) === 'calm' ? undefined : LEVEL_COLOR[levelOf(percent)]}>{percent}%</Text>
            </Box>
          )}
          {width >= WIDE && <Text dimColor>{now.directory}</Text>}
        </Box>
        {original}
      </Box>
    )
  })
}
