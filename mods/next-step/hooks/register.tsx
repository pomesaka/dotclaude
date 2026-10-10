import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { SESSION_CONTEXT } from './context'
import { cardWidth, forkPrompt, parseReply, SUGGESTIONS_MAX } from './suggestions'

// いまプロンプトの上に出している札
const suggestions = atom({ plugin: 'next-step', key: 'suggestions' } as const, [])
// 2 枚めからの案をモデルに作らせている最中
const isThinking = atom({ plugin: 'next-step', key: 'isThinking' } as const, false)

const ACCENT = '#6cb6ff'

// 直前に終わったターンの答え。null は、答えて終わったターンがまだ無い（次のターンが始まった、中断やエラーで終わった）。
// WHY モジュール変数: prompt.suggest には答えが付いてこない。turn.complete で受けて、案が来るまで持つだけの一時状態
let lastAnswer: string | null = null
// 案を作っている回の番号。次のターンが始まるか、新しい案が来るたびに進める。遅れて来た返事が古い回のものかを見分ける
let round = 0

// エンジンの案を先頭の札にして、残りの札を、会話を分岐させてメインのモデルに聞く。
// WHY $.model.fork: 会話の全部、システムプロンプト、CLAUDE.md を踏まえた案になる。メインの要求のキャッシュを使い回すので、
//   全部を読ませても速い。Claude Code 自身の案も同じやり方で作られている（実行ファイルの prompt_suggestion の呼び出しで確認）。
// WHY NOT $.model.complete で小さいモデル: 会話の末尾だけを渡す形で試したが、それらしいだけで的を外した案が並んだ
//   （2026-10-10 に利用者が実機で比べて決めた）。会話の全部を渡すと、キャッシュが効かず、長いセッションほど遅くなる
const think = async ($: EngineInterface, first: string, answer: string): Promise<void> => {
  const mine = ++round
  await update($, suggestions, () => [first])
  await update($, isThinking, () => true)
  try {
    const reply = await $.model.fork({ prompt: forkPrompt(first, answer) })
    // 待っているあいだに次のターンが始まっていたら、古い答えに対する案なので捨てる
    if (round !== mine) return
    // 返事が無いとき（API のエラー、空の返事）は、先頭の札だけを残す
    const more = reply.isAnswered ? parseReply(reply.text, [first], SUGGESTIONS_MAX - 1) : []
    await update($, suggestions, () => [first, ...more])
  } finally {
    if (round === mine) await update($, isThinking, () => false)
  }
}

// 札を押したとき。札を消してから、その文を Claude に送る。
// WHY asUser: 押したのは利用者。利用者が打って送った文と同じ扱いで届ける。
// WHY 待たない: 送信は、始まったターンが終わるまで返らない
const send = async ($: EngineInterface, chosen: string): Promise<void> => {
  const shown = await read($, suggestions)
  await update($, suggestions, () => [])
  const failed = async (): Promise<void> => {
    // 送れなかったら、押す前の札に戻す。次のターンが始まっていないので、消したままだと選び直せない
    await update($, suggestions, current => (current.length === 0 ? shown : current))
    $.ui.toast(`「${chosen}」を送れませんでした。もう一度押してください`, { timeoutMs: 8_000 })
  }
  void $.prompt.submit({ text: chosen, asUser: true }).then(
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

  // 答えて終わったメインのターンの答えを、案が来るまで覚えておく。
  // WHY 答えたターンだけ: 中断やエラーで終わったターンには、続きを決める答えが無い。
  // サブエージェントのターン（agentId がある）も通るので、メインのターンだけを拾う
  on('turn.complete', async (_$, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) lastAnswer = e.reason === 'answer' && e.answer.trim() !== '' ? e.answer : null
    return result
  }).catch((_$, e, next) => next(e))

  // Claude Code 自身の案（入力欄に薄く出るもの）が来たら、それを先頭の札にして、残りの札を聞きはじめる。
  // WHY この案で起動する: エンジンは、次の一手がはっきりしないターンやエラーの後には案を出さない。
  //   そういうターンに札を並べても外れやすいので、エンジンが黙ったら札も出さない（2026-10-10 に利用者が決めた）。
  // WHY next(e) を返す: 入力欄の薄い表示は残す。Tab で取って、直してから送る使い方をそのまま使える。
  // WHY 待たない: 分岐の返事に数秒かかる。待つと、そのあいだ入力欄に案が出ない
  on('prompt.suggest', async ($, e, next) => {
    const first = e.text.trim()
    if (e.origin.kind === 'suggestion' && first !== '' && lastAnswer !== null) void think($, first, lastAnswer).catch(() => undefined)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // 次のターンが始まったら、札を消す。札を押したときも、利用者が自分で打って送ったときも通る。
  // WHY turn.start: 案は「いまの答えの次」に対するもの。話が進んだ後まで残すと、古い案を押せてしまう。
  // サブエージェントの実行では turn.start が来ない（型定義の TurnCompleteFields.turnId の説明）ので、途中で消えない
  on('turn.start', async ($, e, next) => {
    round++
    lastAnswer = null
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
    if (e.props.isWorking || e.props.hasSurvey || list.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // WHY 考えているあいだも札の数ぶんの幅で割らない: 先頭の 1 枚が、あとから来る札で縮むと、読んでいる途中で文が折り返し直される。
    //   はじめから上限の枚数で割っておく
    const width = cardWidth(e.props.bodyColumns, thinking ? SUGGESTIONS_MAX : list.length)
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box flexDirection="row" columnGap={1}>
          {list.map((one, index) => (
            <Box key={`card-${index}`} flexDirection="column" borderStyle="round" borderColor={index === 0 ? ACCENT : undefined} paddingX={1} width={width}>
              {/* WHY 数字の hotkey: 帯にフォーカスを移せば（ctrl+x tab）、キーでも選べる。入力欄にいるあいだは効かない。
                  番号は、エンジンが hotkey から「1: 」と札の前に描く（v2.1.295 の画面で確認）。自分では書かない。
                  WHY 折り返して全文を出す: 押すと、この文がそのまま送られる。途中で切ると、何を送るのか分からないまま押すことになる */}
              <Button key={`send-${index}`} plain hotkey={String(index + 1)} onPress={() => void send($, one).catch(() => undefined)}>
                <Text wrap="wrap" bold={index === 0} color={index === 0 ? ACCENT : undefined}>
                  {one}
                </Text>
              </Button>
            </Box>
          ))}
        </Box>
        <Box flexDirection="row" columnGap={2}>
          <Text dimColor>{thinking ? 'ほかの案を考えています…' : '札を押すと、その文がClaudeに届く'}</Text>
          <Button
            key="dismiss"
            plain
            role="dismiss"
            onPress={() => {
              round++
              void update($, suggestions, () => [])
                .then(() => update($, isThinking, () => false))
                .catch(() => undefined)
            }}
          >
            <Text dimColor>× 消す</Text>
          </Button>
        </Box>
      </Box>
    )
  })
}
