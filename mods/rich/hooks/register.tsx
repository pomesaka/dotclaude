import { atom, memberOf, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import { answerText, parseDoc, questionsOf, type Block, type Doc, type Tone } from './doc'
import { cellsOf, layout } from './layout'

const TOOL_NAME = 'show'
const TOOL = 'mcp__rich__show'
const PANE = 'rich'

const DESCRIPTION = `Draw a short explanation in the terminal: cards, a box-and-arrow diagram, markdown, tabs, and questions the user answers by clicking.
Use it when a figure, a side-by-side comparison, or a clickable choice reads faster than prose. Plain reports stay as normal text.
where "inline" (default) draws in the transcript at this point; "pane" keeps it beside the conversation until closed.
Questions here do NOT block: the answer arrives as the user's next message. Use them only for a choice you hand over as your turn ends. When you need the answer to continue this turn, use AskUserQuestion instead.
After a call with questions, end your turn; do not repeat the question in text.`

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short title. Also names the answer message: 【<title> への回答】' },
    where: { type: 'string', enum: ['inline', 'pane'], description: 'Default inline.' },
    blocks: {
      type: 'array',
      description: 'Drawn top to bottom. Keep the whole thing within about one screen.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['text', 'cards', 'diagram', 'question', 'tabs'] },
          tabs: {
            type: 'array',
            description:
              'type=tabs: 2 or more tabs; clicking a label swaps the content below. Use when each option needs its own figure or detail; use cards when a glance across them is enough. Blocks inside a tab are text, cards or diagram only.',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, blocks: { type: 'array', items: { type: 'object' } } },
              required: ['label', 'blocks'],
            },
          },
          text: { type: 'string', description: 'type=text: markdown (paragraphs, lists, code). Prefer a list to a table: a table is drawn wider than a pane and its lines wrap. In a pane, write each row as a list item (name first, then the rest). Inline, a table is fine only when every cell is a few words.' },
          cards: {
            type: 'array',
            description: 'type=cards: 2-3 cards side by side.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                lines: {
                  type: 'array',
                  description: 'Each a string, or { text, tone } with tone plain | good | warn | dim.',
                  items: {},
                },
              },
              required: ['title', 'lines'],
            },
          },
          nodes: {
            type: 'array',
            description: 'type=diagram: boxes. Laid out left to right by the edges; keep it to about 4 columns of boxes and short labels.',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' } },
              required: ['id', 'title'],
            },
          },
          edges: {
            type: 'array',
            description: 'type=diagram: arrows between node ids, each with an optional short label.',
            items: {
              type: 'object',
              properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
              required: ['from', 'to'],
            },
          },
          key: { type: 'string', description: 'type=question: unique id of the question.' },
          question: { type: 'string', description: 'type=question: short name of what is asked.' },
          options: { type: 'array', description: 'type=question: 2 or more choices.', items: { type: 'string' } },
        },
        required: ['type'],
      },
    },
  },
  required: ['title', 'blocks'],
}

const paneInput = atom({ plugin: 'rich', key: 'paneInput' } as const, null)
const answers = atom({ plugin: 'rich', key: 'answers' } as const, {})
const sent = atom({ plugin: 'rich', key: 'sent' } as const, '')
const tabs = atom({ plugin: 'rich', key: 'tabs' } as const, {})

// タブの見出しの色。選ばれている 1 つだけを目立たせる
const TAB_ACCENT = '#6cb6ff'
const TAB_INK = '#0d1117'
const TAB_SURFACE = '#30363d'
const TAB_SOFT = '#c9d1d9'

const CARD_COLORS = ['#6cb6ff', '#7ee0a1', '#e8a35c', '#c9a0ff']
const TONE_COLOR: { [tone in Tone]: string | undefined } = {
  plain: undefined,
  good: 'success',
  warn: 'warning',
  dim: undefined,
}
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

type Site = { width: number; isPane: boolean; id: string }

// 質問の状態を $.store（セッションをまたいで残る）に持つ。説明ごとに、次のどちらか 1 つ。
//   open:<id>    まだ答えていない。ボタンを押せる
//   answer:<id>  答えた。選んだ答えを表示し、ボタンは出さない
// どちらも無い質問は閉じている（古くて消えた、この仕組みより前に出した）。
// WHY $.state でなく $.store: $.state はセッションを開き直すと消える。「送信済み」を state に持つと、
// 開き直した後に過去の質問をもう一度送れてしまう（2026-10-09 に起きた）。
// WHY 未回答の印も持つ: 答えの記録だけだと、記録に無い行を未回答と見なすことになり、
// 上限を超えて消えた古い答え済みの質問が、また押せるようになる
const OPEN_PREFIX = 'open:'
const ANSWER_PREFIX = 'answer:'
// 増え続けないよう、古いものから消す。未回答は答えられないまま残ったもの、答えは見直すための記録
const OPEN_MAX = 30
const ANSWER_MAX = 50

const isAnswers = (value: unknown): value is { [key: string]: string } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(one => typeof one === 'string')

// prefix の付いた記録を 1 つ書き、max を超えた分を古いものから消す
const remember = async ($: EngineInterface, prefix: string, id: string, value: unknown, max: number): Promise<void> => {
  // WHY 先に消す: keys() は入れた順に返る。入れ直して、いちばん新しい位置に置く
  await $.store.delete(`${prefix}${id}`)
  await $.store.set(`${prefix}${id}`, value)
  const keys = (await $.store.keys()).filter(key => key.startsWith(prefix))
  for (const stale of keys.slice(0, Math.max(0, keys.length - max))) await $.store.delete(stale)
}

// 会話の中の行と pane の両方から呼ぶ。描く中身は同じで、幅と操作の受け方だけが違う。
// WHY ファイルの先頭の階層: $ を渡す先の関数は、ここに宣言したものしか読み込みを通らない（v2.1.295 で確認）
const draw = async ($: EngineInterface, ui: Elements['terminal'], doc: Doc, site: Site) => {
  const { Box, Text, Button, Markdown, Raster } = ui
  const mine = { requestId: site.id }
  const choosing = await read($, memberOf(answers, mine))
  // sent は、送ったときに描き直しを起こすためだけに読む。送ったかどうかは store で決める
  await read($, memberOf(sent, mine))
  const questions = questionsOf(doc)
  const isSingle = questions.length === 1
  const isOpen = questions.length > 0 && (await $.store.get(`${OPEN_PREFIX}${site.id}`)) !== undefined
  const recorded = questions.length > 0 && !isOpen ? await $.store.get(`${ANSWER_PREFIX}${site.id}`) : undefined
  const answered = isAnswers(recorded) ? recorded : undefined
  // 答え済みなら記録した答えを、選んでいる途中ならいま選んでいるものを、印を付けて見せる
  const picked = answered ?? choosing
  const pending = answerText(doc, choosing)

  const send = (text: string, chosen: { [key: string]: string }) => {
    // 未回答の印を消し、答えを記録してから state を書く。state の書き込みで描き直しが走り、質問が閉じる
    void $.store
      .delete(`${OPEN_PREFIX}${site.id}`)
      .then(() => remember($, ANSWER_PREFIX, site.id, chosen, ANSWER_MAX))
      .then(() => update($, memberOf(sent, mine), () => text))
    // WHY asUser: 付けないと「plugin が送った」という枠付きでモデルに届く。本人の答えとして読ませる
    // WHY toast: 送信を hook に止められたときに、答えを失わないよう画面に残す
    $.prompt.submit({ text, asUser: true }).then(
      result => {
        if (result.drop !== undefined) $.ui.toast(text, { timeoutMs: 15_000 })
      },
      () => $.ui.toast(text, { timeoutMs: 15_000 }),
    )
  }
  const pick = (key: string, option: string) => {
    // WHY update の戻り値から作る: 描いた時点の picked は、連続で押したときに古い
    void update($, memberOf(answers, mine), current => ({ ...current, [key]: option })).then(next => {
      // 質問が 1 つなら、選んだ時点で送る。複数なら「回答を送る」を待つ
      const text = isSingle ? answerText(doc, next) : undefined
      if (text !== undefined) send(text, next)
    })
  }

  const shown = await read($, memberOf(tabs, mine))

  // id はブロックの位置（"2" や、タブの中なら "2-0"）。Raster の key とタブの状態の名前に使う
  const renderBlock = (block: Block, id: string, width: number): RenderElement => {
        switch (block.type) {
          case 'text':
            return <Markdown text={block.text} />
          case 'cards': {
            const count = block.cards.length
            const cardWidth = Math.max(22, Math.floor((width - (count - 1)) / count))
            return (
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                {block.cards.map((card, at) => {
                  const color = CARD_COLORS[at % CARD_COLORS.length] ?? 'text'
                  return (
                    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={cardWidth}>
                      <Text bold color={color}>
                        {card.title}
                      </Text>
                      {card.lines.map(line => (
                        <Text color={TONE_COLOR[line.tone]} dimColor={line.tone === 'dim'}>
                          {line.text}
                        </Text>
                      ))}
                    </Box>
                  )
                })}
              </Box>
            )
          }
          case 'diagram': {
            const figure = layout(block.nodes, block.edges)
            return (
              <Box flexDirection="column">
                <Box width={Math.min(figure.columns, width)} height={figure.rows} overflow="hidden">
                  <Raster key={`figure-${id}`} columns={figure.columns} rows={figure.rows} cells={cellsOf(figure)} />
                  {figure.labels.map(label => (
                    <Box position="absolute" top={label.y} left={label.x}>
                      <Text bold={label.kind === 'title'} color={label.kind === 'note' ? undefined : hex(label.color)}>
                        {label.text}
                      </Text>
                    </Box>
                  ))}
                </Box>
                {figure.columns > width && (
                  <Text color="warning">
                    図の幅が足りません（{figure.columns}桁が必要、いまは{width}桁）。右側が切れています
                  </Text>
                )}
              </Box>
            )
          }
          case 'question':
            return (
              <Box flexDirection="column" borderStyle="single" paddingX={1}>
                <Text bold>{block.question}</Text>
                {block.options.map((option, at) =>
                  isOpen ? (
                    // WHY Button: キーボードを受け取れるのは pane と帯だけ（ui.focus の型定義）。
                    // 会話の行でも選べるよう、クリックで押せる Button にする。pane では数字キーでも押せる
                    <Button
                      key={`pick-${block.key}-${at}`}
                      plain
                      hotkey={site.isPane && isSingle && at < 9 ? String(at + 1) : undefined}
                      onPress={() => pick(block.key, option)}
                    >
                      {picked[block.key] === option ? '(x) ' : '( ) '}
                      {option}
                    </Button>
                  ) : (
                    <Text dimColor>
                      {picked[block.key] === option ? '(x) ' : '( ) '}
                      {option}
                    </Text>
                  ),
                )}
              </Box>
            )
          case 'tabs': {
            const active = Math.min(shown[id] ?? 0, block.tabs.length - 1)
            const tab = block.tabs[active]
            return (
              <Box flexDirection="column">
                <Box flexDirection="row" columnGap={1}>
                  {block.tabs.map((one, at) => (
                    <Button
                      key={`tab-${id}-${at}`}
                      plain
                      onPress={() => {
                        void update($, memberOf(tabs, mine), current => ({ ...current, [id]: at }))
                      }}
                    >
                      <Text
                        bold={at === active}
                        color={at === active ? TAB_INK : TAB_SOFT}
                        backgroundColor={at === active ? TAB_ACCENT : TAB_SURFACE}
                      >
                        {` ${one.label} `}
                      </Text>
                    </Button>
                  ))}
                </Box>
                <Box flexDirection="column" gap={1} borderStyle="round" borderColor={TAB_ACCENT} paddingX={1}>
                  {/* WHY -4: 枠の 2 桁と左右の余白の 2 桁 */}
                  {(tab?.blocks ?? []).map((inner, at) => renderBlock(inner, `${id}-${at}`, width - 4))}
                </Box>
              </Box>
            )
          }
        }
  }

  return (
    <Box flexDirection="column" gap={1} width={site.width}>
      <Text bold color="claude">
        {doc.title}
      </Text>

      {doc.blocks.map((block, index) => renderBlock(block, String(index), site.width))}

      {(questions.length > 0 || site.isPane) && (
        <Box flexDirection="row" columnGap={2}>
          {questions.length === 0 ? undefined : !isOpen ? (
            answered !== undefined ? <Text color="success">送信済み</Text> : <Text dimColor>この質問は閉じています</Text>
          ) : pending === undefined ? (
            <Text dimColor>{isSingle ? '選ぶと、そのまま送ります' : 'すべて選ぶと送れます'}</Text>
          ) : (
            <Button key="send" variant="primary" hotkey={site.isPane ? 's' : undefined} onPress={() => send(pending, choosing)}>
              回答を送る
            </Button>
          )}
          {site.isPane && (
            // WHY q: pane がキーボードを持っているあいだ、1 キーで閉じられるようにする。
            // エンジンの閉じる印（右上の ×、ctrl+x x）とは別に置く
            <Button
              key="close"
              role="dismiss"
              hotkey="q"
              onPress={() => {
                void $.ui.close({ id: PANE })
              }}
            >
              閉じる
            </Button>
          )}
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  // WHY next(e) より先に登録する: Claude Code は最初のプロンプトの前に session.start の hook を待つので、
  // 先に登録すれば最初のターンからツールが見える（Mods「Use the mods API」の例と同じ順番）
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    await $.command.register({ name: 'rich-pane', description: 'Reopen the pane the show tool last drew' })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const parsed = parseDoc(e)
    if (!parsed.ok) return { deny: `show failed: ${parsed.error}` }
    const doc = parsed.value
    const asksSomething = questionsOf(doc).length > 0
    const tail = asksSomething
      ? ' The user answers by clicking; the answer arrives as their next message. End your turn now.'
      : ''
    // 質問があれば「未回答」の印を置く。会話の行は tool_use_id、pane は pane の id が、描くときの requestId になる
    const id = doc.where === 'pane' ? PANE : e.tool_use_id
    if (asksSomething) await remember($, OPEN_PREFIX, id, true, OPEN_MAX)
    // pane は同じ id を使い回す。前の説明への答えが、新しい説明の答えとして出ないように消す
    if (doc.where === 'pane') await $.store.delete(`${ANSWER_PREFIX}${PANE}`)
    if (doc.where === 'inline') return { result: `Shown inline in the transcript.${tail}` }

    await update($, paneInput, () => ({ title: e['title'], where: e['where'], blocks: e['blocks'] }))
    await update($, memberOf(answers, { requestId: PANE }), () => ({}))
    await update($, memberOf(sent, { requestId: PANE }), () => '')
    await update($, memberOf(tabs, { requestId: PANE }), () => ({}))
    const opened = await $.ui.open({ id: PANE, title: doc.title })
    // WHY 置けないことがある: モデルが開く pane は、ターミナルが 144 桁（一度開いた後は 110 桁）より狭いと待たされる
    return {
      result: opened.isPlaced
        ? `Shown in a pane.${tail}`
        : `The pane is not drawn yet (${opened.reason}). Tell the user to type /rich-pane to open it.${tail}`,
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `show failed: ${next.error.message}` }))

  on('command.run', { command: 'rich-pane' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'rich', focus: true })
    return { text: opened.isPlaced ? 'rich pane opened.' : `rich pane is waiting: ${opened.reason}` }
  })

  on('ui.render', { component: 'ToolUse', props: { tool: TOOL } }, async ($, e, next) => {
    // WHY NOT 他の surface: Raster はターミナルの表にしか無い
    if (e.surface !== 'terminal') return next(e)
    if (e.props.isRunning || e.props.isErrored || e.props.isInterrupted) return next(e)
    // WHY input から描く: 会話の記録に残るのは入力だけ。セッションを開き直しても同じ行を描ける
    const parsed = parseDoc(e.props.input)
    if (!parsed.ok) return next(e)
    const ui = $.ui.resolve(e)
    if (parsed.value.where === 'pane') {
      const { Text } = ui
      return <Text dimColor>rich: 「{parsed.value.title}」をpaneに出しました（/rich-pane で開き直せます）</Text>
    }
    return draw($, ui, parsed.value, {
      // WHY -4: 会話の行は左に印と字下げが付く。幅いっぱいに描くと折り返す（幅は目測、未計測）
      width: Math.max(40, (e.viewport?.columns ?? 80) - 4),
      isPane: false,
      id: e.requestId,
    })
  })

  // 結果の文（"Shown inline ..."）はモデル向け。利用者には上の行で足りるので描かない
  on('ui.render', { component: 'ToolResult', props: { tool: TOOL } }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const ui = $.ui.resolve(e)
    const parsed = parseDoc(await read($, paneInput))
    if (!parsed.ok) {
      const { Text } = ui
      return <Text dimColor>まだ何も出していません。show ツールが where: "pane" で呼ばれると、ここに出ます</Text>
    }
    return draw($, ui, parsed.value, { width: e.props.bodyColumns, isPane: true, id: e.requestId })
  })
}
