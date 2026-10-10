import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Suggestion } from '../types'
import { SESSION_CONTEXT } from './context'
import { askPrompt, cardWidth, modelOf, parseReply, SYSTEM_PROMPT, tailOf } from './suggestions'

// いまプロンプトの上に出している案
const suggestions = atom({ plugin: 'next-step', key: 'suggestions' } as const, [])
// 案をモデルに作らせている最中
const isThinking = atom({ plugin: 'next-step', key: 'isThinking' } as const, false)

const ACCENT = '#6cb6ff'

// 案を待っているターンの id。null は、待っているターンが無い（次のターンが始まった、まだ 1 度も終わっていない）。
// WHY モジュール変数: 進行中の問い合わせに紐づく一時状態で、読み込み直しをまたいで残す意味がない
let awaited: string | null = null

// 返事を待つ時間の上限（ミリ秒）。これより遅い案は、出ても押されない
const TIMEOUT_MS = 15_000

// 終わったターンについて、小さいモデルに次の一手を聞いて札にする。会話の末尾と直前の答えだけを渡す。
// WHY $.model.complete: モデルを選べて、読ませる量を自分で決められる。依頼と返事は会話に残らない。
// WHY NOT $.model.fork: 会話の全文をメインのモデルに読ませるので、札が出るまでが遅かった。モデルも選べない。
// WHY NOT Claude がツールで渡す: モデルの往復が 1 回増えるのは同じで、呼び忘れがあり、毎ターン会話にツールの行が出る
// （どちらも 2026-10-10 に利用者と決めた）
const think = async ($: EngineInterface, turnId: string, answer: string): Promise<void> => {
  awaited = turnId
  await update($, isThinking, () => true)
  try {
    // $.env.get の名前は、文字列をその場に書く。定数で渡すと読み込みで弾かれる（v2.1.295）
    const model = modelOf(await $.env.get('NEXT_STEP_MODEL'))
    const tail = tailOf(await $.session.messages(), answer)
    const reply = await $.model.complete({
      model,
      system: SYSTEM_PROMPT,
      prompt: askPrompt(tail, answer),
      // 札 4 枚ぶんの JSON が入る長さ
      maxTokens: 800,
      effort: 'low',
      timeoutMs: TIMEOUT_MS,
    })
    // 待っているあいだに次のターンが始まっていたら、古い答えに対する案なので捨てる
    if (awaited !== turnId) return
    await update($, suggestions, () => (reply.isAnswered ? parseReply(reply.text) : []))
  } finally {
    if (awaited === turnId) await update($, isThinking, () => false)
  }
}

// 札を押したとき。案を消してから、その文を Claude に送る。
// WHY asUser: 押したのは利用者。利用者が打って送った文と同じ扱いで届ける。
// WHY 待たない: 送信は、始まったターンが終わるまで返らない
const send = async ($: EngineInterface, chosen: Suggestion): Promise<void> => {
  const shown = await read($, suggestions)
  await update($, suggestions, () => [])
  const failed = async (): Promise<void> => {
    // 送れなかったら、押す前の札に戻す。次のターンが始まっていないので、消したままだと選び直せない
    await update($, suggestions, current => (current.length === 0 ? shown : current))
    $.ui.toast(`「${chosen.label}」を送れませんでした。もう一度押してください`, { timeoutMs: 8_000 })
  }
  void $.prompt.submit({ text: chosen.prompt, asUser: true }).then(
    result => (result.drop === undefined ? undefined : failed()),
    () => failed(),
  )
}

export const register: Register = on => {
  // セッションの始めに、札の仕組みを Claude に伝える。
  // WHY サブエージェントには渡さない: 札を見て押すのは、メインのセッションの利用者だけ
  on('classic.SessionStart', async (_$, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), SESSION_CONTEXT] }
  }).catch((_$, e, next) => next(e))

  // ターンが終わったら、次の一手をモデルに聞く。
  // WHY 待たない: 問い合わせに数秒かかる。待つと、そのあいだターンが終わらない。
  // hook が戻った後も問い合わせは走り切る（v2.1.295 で動作確認）。
  // WHY 答えたターンだけ: 中断やエラーで終わったターンには、続きを決める答えが無い。
  // サブエージェントのターン（agentId がある）も通るので、メインのターンだけを拾う
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && e.answer.trim() !== '') {
      void think($, e.turnId, e.answer).catch(() => undefined)
    }
    return result
  }).catch((_$, e, next) => next(e))

  // 次のターンが始まったら、札を消す。札を押したときも、利用者が自分で打って送ったときも通る。
  // WHY turn.start: 案は「いまの答えの次」に対するもの。話が進んだ後まで残すと、古い案を押せてしまう。
  // サブエージェントの実行では turn.start が来ない（型定義の TurnCompleteFields.turnId の説明）ので、途中で消えない
  on('turn.start', async ($, e, next) => {
    awaited = null
    await update($, suggestions, current => (current.length === 0 ? current : []))
    await update($, isThinking, () => false)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // プロンプトの上に、案を札として横に並べる。
  // WHY AbovePrompt: 入力欄のすぐ上で、打つ代わりに押せる。下の行は status-band が使っている
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, suggestions)
    const thinking = await read($, isThinking)
    // ターンの途中は出さない。案は終わった答えに対するもので、途中に押すと、いまの作業の後ろに並んでしまう。
    // 調査（survey）が帯を使っているあいだは譲る
    if (e.props.isWorking || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    if (list.length === 0) return thinking ? <Text dimColor>次の一手を考えています…</Text> : next(e)
    const width = cardWidth(e.props.bodyColumns, list.length)
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box flexDirection="row" columnGap={1}>
          {list.map((one, index) => (
            <Box key={`card-${index}`} flexDirection="column" borderStyle="round" borderColor={index === 0 ? ACCENT : undefined} paddingX={1} width={width}>
              {/* WHY 数字の hotkey: 帯にフォーカスを移せば（ctrl+x tab）、キーでも選べる。入力欄にいるあいだは効かない。
                  番号は、エンジンが hotkey から「1: 」と札の前に描く（v2.1.295 の画面で確認）。自分では書かない */}
              <Button key={`send-${index}`} plain hotkey={String(index + 1)} onPress={() => void send($, one).catch(() => undefined)}>
                <Text wrap="truncate-end" bold color={index === 0 ? ACCENT : undefined}>
                  {one.label}
                </Text>
              </Button>
              {/* WHY 折り返して全文を出す: 押すと、この文がそのまま送られる。途中で切ると、何を送るのか分からないまま押すことになる
                  （2026-10-10 に利用者が決めた。開くボタンは持たない） */}
              <Text wrap="wrap" dimColor>
                {one.prompt}
              </Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="row" columnGap={2}>
          <Text dimColor>札を押すと、その指示がClaudeに届く</Text>
          <Button
            key="dismiss"
            plain
            role="dismiss"
            onPress={() => {
              void update($, suggestions, () => []).catch(() => undefined)
            }}
          >
            <Text dimColor>× 消す</Text>
          </Button>
        </Box>
      </Box>
    )
  })
}
