import { expect, test } from 'claude-code/testing'
import { bodyOf, foldedOf, isModRequest } from '../hooks/rows'

const FRAMED =
  "The devrep plugin sent a message:\ndevrep: 状況を書き直してください。\n変わっていなければ何もしないでください。\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above."

test('bodyOf は、エンジンの枠を除いて、送った文だけを返す', async () => {
  expect(bodyOf(FRAMED)).toBe('devrep: 状況を書き直してください。\n変わっていなければ何もしないでください。')
})

test('bodyOf は、枠が無い文をそのまま返す', async () => {
  expect(bodyOf('PR #12 がマージされました')).toBe('PR #12 がマージされました')
})

const FOLDS: { name: string; text: string; max: number; folded: string }[] = [
  { name: '1 行で収まる文は、そのまま', text: 'PR #12 merged', max: 40, folded: 'PR #12 merged' },
  { name: '続きの行があれば、最初の行に … を付ける', text: FRAMED, max: 60, folded: 'devrep: 状況を書き直してください。 …' },
  { name: '収まらない行は切る。全角は 2 桁', text: '状況を書き直してください', max: 9, folded: '状況を書…' },
  { name: '半角を切る', text: 'abcdefgh', max: 5, folded: 'abcd…' },
  { name: '空の文', text: '', max: 20, folded: '' },
]

for (const one of FOLDS) {
  test(`foldedOf: ${one.name}`, async () => {
    expect(foldedOf(one.text, one.max)).toBe(one.folded)
  })
}

const REQUESTS: { name: string; text: string; isModRequest: boolean }[] = [
  { name: 'questions の相談の依頼', text: '[questions: ここからは、利用者との相談用に分岐した会話です。]', isModRequest: true },
  { name: 'next-step の問い合わせ', text: '[next-step: 利用者が、次に入力欄へ打ちそうな文を当てる]', isModRequest: true },
  { name: '利用者が打った文', text: 'commitしてpushしといて！', isModRequest: false },
  { name: '貼り付けを表す角かっこ', text: '[Image #3] これ見て', isModRequest: false },
  { name: '保留への回答', text: '【保留への回答】Q2 名前: questions', isModRequest: false },
]

for (const one of REQUESTS) {
  test(`isModRequest: ${one.name}`, async () => {
    expect(isModRequest(one.text)).toBe(one.isModRequest)
  })
}
