import { describe, expect, test } from 'bun:test'
import { childrenOf, classifyArrival, commandKey, duration, type Subagent, sumUsage } from './timeline'

describe('classifyArrival', () => {
  test.each([
    ['利用者の文', { type: 'user', origin: { kind: 'human' }, message: { content: '続けて' } }, { kind: '利用者', text: '続けて' }],
    ['origin の無い利用者の文', { type: 'user', message: { content: '直して' } }, { kind: '利用者', text: '直して' }],
    ['サブエージェントの報告', { type: 'user', isMeta: true, origin: { kind: 'peer', name: 'verifier', body: '[Subagent hand-back] PASS' }, message: { content: 'x' } }, { kind: '報告 verifier', text: '' }],
    ['別のセッションからの依頼', { type: 'user', isMeta: true, origin: { kind: 'peer', name: 'risa-b155', body: '#249 を直して' }, message: { content: 'x' } }, { kind: '依頼 risa-b155', text: '#249 を直して' }],
    ['Mod の知らせ', { type: 'user', origin: { kind: 'plugin', name: 'pr', body: 'PR #1 がマージされました' }, message: { content: 'x' } }, { kind: 'Mod pr', text: 'PR #1 がマージされました' }],
    ['スラッシュコマンド', { type: 'user', message: { content: '<command-name>/reload-plugins</command-name>' } }, { kind: 'コマンド', text: '/reload-plugins' }],
    ['スキルの本文の付け足し', { type: 'user', isMeta: true, message: { content: 'Base directory for this skill' } }, null],
    ['ツールの結果だけ', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }, null],
    ['応答', { type: 'assistant', message: { content: 'x' } }, null],
  ])('%s', (_, entry, expected) => {
    expect(classifyArrival(entry)).toEqual(expected)
  })
})

describe('commandKey', () => {
  test.each([
    ['サブコマンドまで', 'jj git fetch', 'jj git'],
    ['cd を飛ばす', 'cd /repo && bun test src', 'bun test'],
    ['複合コマンドは並べる', 'cd /repo; jj st >/dev/null 2>&1; bun run check', '複合（jj st、bun run）'],
    ['ヒアドキュメントの中身は数えない', "python3 - <<'EOF'\nimport os\nos.remove(p)\nEOF", 'python3'],
    ['ヒアドキュメントの後ろのコマンドは数える', "python3 - <<'EOF'\nprint(1)\nEOF\nbun test", '複合（python3、bun test）'],
    ['パイプの後ろは同じコマンドの一部', 'jj log | head -3', 'jj log'],
    ['環境変数の代入を飛ばす', 'CI=1 bun run build', 'bun run'],
    ['パスを外す', '/usr/bin/python3 -c "print(1)"', 'python3'],
    ['2 語目が値なら 1 語', 'rg -n foo', 'rg'],
    ['サブシェルの括弧を外す', '(bun run dev &) ', 'bun run'],
  ])('%s', (_, command, expected) => {
    expect(commandKey(command)).toBe(expected)
  })
})

describe('sumUsage', () => {
  const usage = { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 10, output_tokens: 5 }
  test.each([
    ['同じ message.id の行は 1 回だけ数える', [{ type: 'assistant', message: { id: 'm1', usage } }, { type: 'assistant', message: { id: 'm1', usage } }], { newIn: 3, cacheRead: 10, out: 5 }],
    ['別の message.id は足す', [{ type: 'assistant', message: { id: 'm1', usage } }, { type: 'assistant', message: { id: 'm2', usage } }], { newIn: 6, cacheRead: 20, out: 10 }],
    ['利用者の行は数えない', [{ type: 'user', message: { id: 'm1', usage } }], { newIn: 0, cacheRead: 0, out: 0 }],
  ])('%s', (_, entries, expected) => {
    expect(sumUsage(entries)).toEqual(expected)
  })
})

describe('duration', () => {
  test.each([
    [59_000, '59s'],
    [61_000, '1m01s'],
    [3_660_000, '1h01m'],
  ])('%d ms', (ms, expected) => {
    expect(duration(ms)).toBe(expected)
  })
})

describe('childrenOf', () => {
  const agent = (id: string, parentAgentId?: string): Subagent => ({ id, parentAgentId, label: id, type: 'general-purpose', description: '', background: true, start: 0, end: 1, usage: { newIn: 0, cacheRead: 0, out: 0 } })
  test.each([
    ['親の下に子を持つ', [agent('a'), agent('b', 'a')], { a: ['b'] }],
    ['孫は子の下に持つ', [agent('a'), agent('b', 'a'), agent('c', 'b')], { a: ['b'], b: ['c'] }],
    ['親が記録に無い子は持たない', [agent('b', 'x')], {}],
    ['親の無いものだけなら空', [agent('a'), agent('b')], {}],
  ])('%s', (_, agents, expected) => {
    const children = childrenOf(agents)
    expect(Object.fromEntries([...children].map(([id, list]) => [id, list.map(child => child.id)]))).toEqual(expected)
  })
})
