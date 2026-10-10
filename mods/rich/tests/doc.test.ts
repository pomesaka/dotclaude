import { expect, test } from 'claude-code/testing'
import { answerText, isTakenOver, parseDoc, type Doc } from '../hooks/doc'

const REJECTED: { name: string; input: unknown; error: string }[] = [
  { name: 'オブジェクトでない', input: 'x', error: 'input must be an object' },
  { name: 'title が無い', input: { blocks: [{ type: 'text', text: 'a' }] }, error: 'title must be a non-empty string' },
  { name: 'blocks が空', input: { title: 't', blocks: [] }, error: 'blocks must be a non-empty array' },
  { name: 'where が不正', input: { title: 't', where: 'side', blocks: [{ type: 'text', text: 'a' }] }, error: 'where must be "inline" or "pane"' },
  { name: 'type が不明', input: { title: 't', blocks: [{ type: 'image' }] }, error: 'blocks[0].type must be one of text, cards, diagram, question, tabs' },
  { name: 'タブが 1 つ', input: { title: 't', blocks: [{ type: 'tabs', tabs: [{ label: 'A', blocks: [{ type: 'text', text: 'a' }] }] }] }, error: 'blocks[0].tabs needs at least 2 tabs' },
  {
    name: 'タブの中に質問',
    input: { title: 't', blocks: [{ type: 'tabs', tabs: [{ label: 'A', blocks: [{ type: 'question', key: 'k', question: 'q', options: ['a', 'b'] }] }, { label: 'B', blocks: [{ type: 'text', text: 'b' }] }] }] },
    error: 'blocks[0].tabs[0].blocks[0].type must be one of text, cards, diagram inside a tab',
  },
  {
    name: 'タブの中にタブ',
    input: { title: 't', blocks: [{ type: 'tabs', tabs: [{ label: 'A', blocks: [{ type: 'text', text: 'a' }] }, { label: 'B', blocks: [{ type: 'tabs', tabs: [] }] }] }] },
    error: 'blocks[0].tabs[1].blocks[0].type must be one of text, cards, diagram inside a tab',
  },
  { name: 'tone が不正', input: { title: 't', blocks: [{ type: 'cards', cards: [{ title: 'c', lines: [{ text: 'l', tone: 'red' }] }] }] }, error: 'blocks[0].cards[0].lines[0].tone must be one of plain, good, warn, dim' },
  { name: '矢印の先が無い', input: { title: 't', blocks: [{ type: 'diagram', nodes: [{ id: 'a', title: 'A' }], edges: [{ from: 'a', to: 'b' }] }] }, error: 'blocks[0].edges[0] names "b", which is no node id' },
  { name: '自分への矢印', input: { title: 't', blocks: [{ type: 'diagram', nodes: [{ id: 'a', title: 'A' }], edges: [{ from: 'a', to: 'a' }] }] }, error: 'blocks[0].edges[0] goes from "a" to itself' },
  { name: '箱の id が重複', input: { title: 't', blocks: [{ type: 'diagram', nodes: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] }] }, error: 'blocks[0].nodes has the id "a" twice' },
  { name: '選択肢が 1 つ', input: { title: 't', blocks: [{ type: 'question', key: 'k', question: 'q', options: ['only'] }] }, error: 'blocks[0].options needs at least 2 options' },
  { name: '選択肢が重複', input: { title: 't', blocks: [{ type: 'question', key: 'k', question: 'q', options: ['a', 'a'] }] }, error: 'blocks[0].options has the same option twice' },
  { name: '選択肢のカードに question が無い', input: { title: 't', blocks: [{ type: 'cards', key: 'k', cards: [{ title: 'a', lines: ['l'] }, { title: 'b', lines: ['l'] }] }] }, error: 'blocks[0].question must be a non-empty string' },
  { name: '選択肢のカードが 1 枚', input: { title: 't', blocks: [{ type: 'cards', key: 'k', question: 'q', cards: [{ title: 'a', lines: ['l'] }] }] }, error: 'blocks[0].cards needs at least 2 cards to be choices' },
  {
    name: '選択肢のカードの値が重複',
    input: { title: 't', blocks: [{ type: 'cards', key: 'k', question: 'q', cards: [{ title: 'a', lines: ['l'], value: 'x' }, { title: 'b', lines: ['l'], value: 'x' }] }] },
    error: 'blocks[0].cards has the same value twice',
  },
  {
    name: 'タブの中に選択肢のカード',
    input: {
      title: 't',
      blocks: [{ type: 'tabs', tabs: [{ label: 'A', blocks: [{ type: 'cards', key: 'k', question: 'q', cards: [{ title: 'a', lines: ['l'] }, { title: 'b', lines: ['l'] }] }] }, { label: 'B', blocks: [{ type: 'text', text: 'b' }] }] }],
    },
    error: 'blocks[0].tabs[0].blocks[0] cannot take key or question inside a tab: cards that are choices go outside the tabs',
  },
  {
    name: '質問とカードの key が重複',
    input: {
      title: 't',
      blocks: [{ type: 'question', key: 'k', question: 'q', options: ['a', 'b'] }, { type: 'cards', key: 'k', question: 'r', cards: [{ title: 'a', lines: ['l'] }, { title: 'b', lines: ['l'] }] }],
    },
    error: 'two questions share the key "k"',
  },
  {
    name: '質問の key が重複',
    input: { title: 't', blocks: [{ type: 'question', key: 'k', question: 'q', options: ['a', 'b'] }, { type: 'question', key: 'k', question: 'r', options: ['a', 'b'] }] },
    error: 'two questions share the key "k"',
  },
]

for (const one of REJECTED) {
  test(`parseDoc は拒む: ${one.name}`, async () => {
    expect(parseDoc(one.input)).toEqual({ ok: false, error: one.error })
  })
}

test('parseDoc は省略された値を埋める', async () => {
  const parsed = parseDoc({
    // tool.call の e には tool と tool_use_id も載っている。余分な項目は無視する
    tool: 'mcp__rich__show',
    tool_use_id: 'toolu_1',
    title: 't',
    blocks: [
      { type: 'cards', cards: [{ title: 'c', lines: ['plain line', { text: 'good line', tone: 'good' }] }] },
      { type: 'diagram', nodes: [{ id: 'a', title: 'A' }] },
    ],
  })
  expect(parsed).toEqual({
    ok: true,
    value: {
      where: 'inline',
      title: 't',
      blocks: [
        { type: 'cards', cards: [{ title: 'c', lines: [{ text: 'plain line', tone: 'plain' }, { text: 'good line', tone: 'good' }], value: 'c' }], choice: null },
        { type: 'diagram', nodes: [{ id: 'a', title: 'A', note: '' }], edges: [] },
      ],
    },
  })
})

const DOC: Doc = {
  where: 'inline',
  title: '次の一手',
  blocks: [
    { type: 'text', text: 'x' },
    { type: 'question', key: 'next', question: '次にやること', options: ['push', '待つ'] },
    { type: 'question', key: 'scope', question: '範囲', options: ['全部', '一部'] },
  ],
}

const ANSWERS: { name: string; answers: { [key: string]: string }; text: string | undefined }[] = [
  { name: 'すべて答えると文になる', answers: { next: 'push', scope: '一部' }, text: '【次の一手 への回答】\n1. 次にやること: push\n2. 範囲: 一部' },
  { name: '1 つ欠けると送れない', answers: { next: 'push' }, text: undefined },
  { name: '選択肢に無い答えは送れない', answers: { next: 'push', scope: '半分' }, text: undefined },
]

for (const one of ANSWERS) {
  test(`answerText: ${one.name}`, async () => {
    expect(answerText(DOC, one.answers)).toBe(one.text)
  })
}

test('parseDoc は、key と question の付いたカードを選択肢にする。value が無ければ題名を値にする', async () => {
  const parsed = parseDoc({
    title: 't',
    blocks: [{ type: 'cards', key: 'plan', question: 'どの案', cards: [{ title: '案A（仮置き）', lines: ['l'], value: '案A' }, { title: '案B', lines: ['l'] }] }],
  })
  expect(parsed).toEqual({
    ok: true,
    value: {
      where: 'inline',
      title: 't',
      blocks: [
        {
          type: 'cards',
          cards: [
            { title: '案A（仮置き）', lines: [{ text: 'l', tone: 'plain' }], value: '案A' },
            { title: '案B', lines: [{ text: 'l', tone: 'plain' }], value: '案B' },
          ],
          choice: { key: 'plan', question: 'どの案' },
        },
      ],
    },
  })
})

const CARD_DOC: Doc = {
  where: 'inline',
  title: '保存の方式',
  blocks: [
    {
      type: 'cards',
      cards: [
        { title: '案A（仮置き）', lines: [{ text: 'l', tone: 'plain' }], value: '案A' },
        { title: '案B', lines: [{ text: 'l', tone: 'plain' }], value: '案B' },
      ],
      choice: { key: 'plan', question: 'どの案' },
    },
  ],
}

const CARD_ANSWERS: { name: string; answers: { [key: string]: string }; text: string | undefined }[] = [
  { name: '選んだカードの値を送る。題名ではない', answers: { plan: '案A' }, text: '【保存の方式 への回答】\n1. どの案: 案A' },
  { name: '題名を答えにしても、値でなければ送れない', answers: { plan: '案A（仮置き）' }, text: undefined },
  { name: '選んでいなければ送れない', answers: {}, text: undefined },
]

for (const one of CARD_ANSWERS) {
  test(`answerText（選択肢のカード）: ${one.name}`, async () => {
    expect(answerText(CARD_DOC, one.answers)).toBe(one.text)
  })
}

test('answerText: 質問が無ければ送る文も無い', async () => {
  expect(answerText({ where: 'inline', title: 't', blocks: [{ type: 'text', text: 'x' }] }, {})).toBe(undefined)
})

const DROPPED: { name: string; reason: string; isTaken: boolean }[] = [
  { name: 'questions が相談の結論として引き取った', reason: '相談の結論として受け取りました（要約を付けてメインへ送ります）', isTaken: true },
  { name: 'ほかの理由で止められた', reason: 'blocked by policy', isTaken: false },
  { name: '理由が空', reason: '', isTaken: false },
]

for (const one of DROPPED) {
  test(`isTakenOver: ${one.name}`, async () => {
    expect(isTakenOver(one.reason)).toBe(one.isTaken)
  })
}
