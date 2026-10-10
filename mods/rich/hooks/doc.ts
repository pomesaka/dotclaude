export type Tone = 'plain' | 'good' | 'warn' | 'dim'
export type CardLine = { text: string; tone: Tone }
export type Card = { title: string; lines: CardLine[] }
export type DiagramNode = { id: string; title: string; note: string }
export type DiagramEdge = { from: string; to: string; label: string }

export type Block =
  | { type: 'text'; text: string }
  | { type: 'cards'; cards: Card[] }
  | { type: 'diagram'; nodes: DiagramNode[]; edges: DiagramEdge[] }
  | { type: 'question'; key: string; question: string; options: string[] }
  | { type: 'tabs'; tabs: Tab[] }

export type Tab = { label: string; blocks: Block[] }

export type Where = 'inline' | 'pane'
export type Doc = { where: Where; title: string; blocks: Block[] }
export type Question = Extract<Block, { type: 'question' }>

const TONES: readonly Tone[] = ['plain', 'good', 'warn', 'dim']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTone = (value: unknown): value is Tone => TONES.some(tone => tone === value)

// 失敗は文字列で返す。モデルが読んで入力を直せるよう、どの位置の何が悪いかを書く
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const fail = (error: string): Parsed<never> => ({ ok: false, error })

const text = (value: unknown, at: string): Parsed<string> =>
  typeof value === 'string' && value.trim() !== '' ? ok(value) : fail(`${at} must be a non-empty string`)

const optionalText = (value: unknown, at: string): Parsed<string> =>
  value === undefined ? ok('') : typeof value === 'string' ? ok(value) : fail(`${at} must be a string`)

const list = <T>(value: unknown, at: string, each: (item: unknown, at: string) => Parsed<T>): Parsed<T[]> => {
  if (!Array.isArray(value) || value.length === 0) return fail(`${at} must be a non-empty array`)
  const out: T[] = []
  for (const [index, item] of value.entries()) {
    const parsed = each(item, `${at}[${index}]`)
    if (!parsed.ok) return parsed
    out.push(parsed.value)
  }
  return ok(out)
}

const cardLine = (value: unknown, at: string): Parsed<CardLine> => {
  if (typeof value === 'string') return ok({ text: value, tone: 'plain' })
  if (!isRecord(value)) return fail(`${at} must be a string or { text, tone }`)
  const body = text(value.text, `${at}.text`)
  if (!body.ok) return body
  if (value.tone !== undefined && !isTone(value.tone)) return fail(`${at}.tone must be one of ${TONES.join(', ')}`)
  return ok({ text: body.value, tone: isTone(value.tone) ? value.tone : 'plain' })
}

const card = (value: unknown, at: string): Parsed<Card> => {
  if (!isRecord(value)) return fail(`${at} must be an object`)
  const title = text(value.title, `${at}.title`)
  if (!title.ok) return title
  const lines = list(value.lines, `${at}.lines`, cardLine)
  if (!lines.ok) return lines
  return ok({ title: title.value, lines: lines.value })
}

const node = (value: unknown, at: string): Parsed<DiagramNode> => {
  if (!isRecord(value)) return fail(`${at} must be an object`)
  const id = text(value.id, `${at}.id`)
  if (!id.ok) return id
  const title = text(value.title, `${at}.title`)
  if (!title.ok) return title
  const note = optionalText(value.note, `${at}.note`)
  if (!note.ok) return note
  return ok({ id: id.value, title: title.value, note: note.value })
}

const edge = (value: unknown, at: string): Parsed<DiagramEdge> => {
  if (!isRecord(value)) return fail(`${at} must be an object`)
  const from = text(value.from, `${at}.from`)
  if (!from.ok) return from
  const to = text(value.to, `${at}.to`)
  if (!to.ok) return to
  const label = optionalText(value.label, `${at}.label`)
  if (!label.ok) return label
  return ok({ from: from.value, to: to.value, label: label.value })
}

const diagram = (value: Record<string, unknown>, at: string): Parsed<Block> => {
  const nodes = list(value.nodes, `${at}.nodes`, node)
  if (!nodes.ok) return nodes
  const edges = value.edges === undefined ? ok<DiagramEdge[]>([]) : list(value.edges, `${at}.edges`, edge)
  if (!edges.ok) return edges
  const ids = new Set<string>()
  for (const one of nodes.value) {
    if (ids.has(one.id)) return fail(`${at}.nodes has the id "${one.id}" twice`)
    ids.add(one.id)
  }
  for (const [index, one] of edges.value.entries()) {
    for (const end of [one.from, one.to]) {
      if (!ids.has(end)) return fail(`${at}.edges[${index}] names "${end}", which is no node id`)
    }
    if (one.from === one.to) return fail(`${at}.edges[${index}] goes from "${one.from}" to itself`)
  }
  return ok({ type: 'diagram', nodes: nodes.value, edges: edges.value })
}

// タブの中に置けるのは text、cards、diagram だけ。
// WHY NOT question: 見えていないタブの質問が未回答のまま残り、送れない理由が利用者に見えなくなる
// WHY NOT tabs: 入れ子のタブは、ターミナルの幅では読めない
const tab = (value: unknown, at: string): Parsed<Tab> => {
  if (!isRecord(value)) return fail(`${at} must be an object`)
  const label = text(value.label, `${at}.label`)
  if (!label.ok) return label
  const blocks = list(value.blocks, `${at}.blocks`, (item, where) => {
    if (isRecord(item) && (item.type === 'question' || item.type === 'tabs')) {
      return fail(`${where}.type must be one of text, cards, diagram inside a tab`)
    }
    return block(item, where)
  })
  if (!blocks.ok) return blocks
  return ok({ label: label.value, blocks: blocks.value })
}

const block = (value: unknown, at: string): Parsed<Block> => {
  if (!isRecord(value)) return fail(`${at} must be an object`)
  switch (value.type) {
    case 'tabs': {
      const tabs = list(value.tabs, `${at}.tabs`, tab)
      if (!tabs.ok) return tabs
      if (tabs.value.length < 2) return fail(`${at}.tabs needs at least 2 tabs`)
      return ok({ type: 'tabs', tabs: tabs.value })
    }
    case 'text': {
      const body = text(value.text, `${at}.text`)
      return body.ok ? ok({ type: 'text', text: body.value }) : body
    }
    case 'cards': {
      const cards = list(value.cards, `${at}.cards`, card)
      return cards.ok ? ok({ type: 'cards', cards: cards.value }) : cards
    }
    case 'diagram':
      return diagram(value, at)
    case 'question': {
      const key = text(value.key, `${at}.key`)
      if (!key.ok) return key
      const question = text(value.question, `${at}.question`)
      if (!question.ok) return question
      const options = list(value.options, `${at}.options`, text)
      if (!options.ok) return options
      if (options.value.length < 2) return fail(`${at}.options needs at least 2 options`)
      if (new Set(options.value).size !== options.value.length) return fail(`${at}.options has the same option twice`)
      return ok({ type: 'question', key: key.value, question: question.value, options: options.value })
    }
    default:
      return fail(`${at}.type must be one of text, cards, diagram, question, tabs`)
  }
}

export const parseDoc = (input: unknown): Parsed<Doc> => {
  if (!isRecord(input)) return fail('input must be an object')
  const title = text(input.title, 'title')
  if (!title.ok) return title
  if (input.where !== undefined && input.where !== 'inline' && input.where !== 'pane') {
    return fail('where must be "inline" or "pane"')
  }
  const blocks = list(input.blocks, 'blocks', block)
  if (!blocks.ok) return blocks
  const keys = new Set<string>()
  for (const one of blocks.value) {
    if (one.type !== 'question') continue
    if (keys.has(one.key)) return fail(`two questions share the key "${one.key}"`)
    keys.add(one.key)
  }
  return ok({ where: input.where === 'pane' ? 'pane' : 'inline', title: title.value, blocks: blocks.value })
}

export const questionsOf = (doc: Doc): Question[] =>
  doc.blocks.flatMap(one => (one.type === 'question' ? [one] : []))

// 質問がすべて答えられていれば、送る文を返す。1 つでも欠けていれば undefined
export const answerText = (doc: Doc, answers: { [key: string]: string }): string | undefined => {
  const questions = questionsOf(doc)
  if (questions.length === 0) return undefined
  const lines: string[] = []
  for (const [index, one] of questions.entries()) {
    const answer = answers[one.key]
    if (answer === undefined || !one.options.includes(answer)) return undefined
    lines.push(`${index + 1}. ${one.question}: ${answer}`)
  }
  return [`【${doc.title} への回答】`, ...lines].join('\n')
}
