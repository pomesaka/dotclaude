import { expect, test } from 'bun:test'
import { parseArgs, planFor, type Session, sessionsOf, typedText } from './send'

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const frame = (prompt: string) => `前の行\n\x1b[38;5;244m────── name ─\n\x1b[39m${prompt}\n\x1b[38;5;244m──────\n  auto mode`

test.each([
  ['空の入力欄', frame('❯ '), ''],
  ['薄い字の案だけ', frame(`❯ ${DIM}PR の画面を見せて${RESET}`), ''],
  ['打った文', frame('❯ 本番デプロイ終わったか見て'), '本番デプロイ終わったか見て'],
  ['打った文の後ろに薄い字の案', frame(`❯ 見て${DIM}おいて${RESET}`), '見て'],
  ['打った文に色の戻しが混ざる', frame(`❯ 見て${RESET}`), '見て'],
  ['閉じない薄い字', frame(`❯ ${DIM}案`), ''],
  ['入力欄が無い', '会話の行だけ\n別の行', null],
  ['最後の入力欄を読む', `❯ 前の発言\n途中の行\n${frame('❯ ')}`, ''],
] as const)('typedText: %s', (_name, screen, expected) => {
  expect(typedText(screen)).toBe(expected)
})

const session = (over: Partial<Session> = {}): Session => ({ id: 'd1', name: 'kiara-1', alias: 'docs', status: 'idle', ...over })
const EMPTY = frame('❯ ')

test.each([
  ['止まっていて空', session(), [], EMPTY, 'send'],
  ['操作待ちで空', session({ status: 'waiting_action' }), [], EMPTY, 'send'],
  ['動いている', session({ status: 'running' }), [], EMPTY, 'skip:running'],
  ['承認待ち', session({ status: 'waiting_approval' }), [], EMPTY, 'skip:waiting_approval'],
  ['書きかけ', session(), [], frame('❯ まだ途中'), 'skip:書きかけがある（まだ途中）'],
  ['入力欄が無い', session(), [], 'ログだけ', 'skip:入力欄が見つからない'],
  ['自分', session({ id: 'self' }), [], EMPTY, null],
  ['ウィンドウが無い', session(), [], null, null],
  ['--only の名前に当たる', session(), ['kiara'], EMPTY, 'send'],
  ['--only の alias に当たる', session(), ['doc'], EMPTY, 'send'],
  ['--only に当たらない', session(), ['risa'], EMPTY, null],
] as const)('planFor: %s', (_name, s, only, screen, expected) => {
  const plan = planFor(s, 'self', [...only], screen)
  expect(plan === null ? null : plan.action === 'send' ? 'send' : `skip:${plan.reason}`).toBe(expected)
})

test.each([
  ['欄がそろった行', [{ id: 'a', name: 'kiara-1', alias: 'docs', status: 'idle' }], [session({ id: 'a' })]],
  ['alias と name が無い', [{ id: 'a', status: 'idle' }], [{ id: 'a', name: 'a', alias: '', status: 'idle' }]],
  ['文字列でない欄は空にする', [{ id: 'a', name: 1, alias: null, status: 'idle' }], [{ id: 'a', name: 'a', alias: '', status: 'idle' }]],
  ['id の無い行と、オブジェクトでない行は捨てる', [{ name: 'x' }, 'x', null], []],
  ['配列でない', { id: 'a' }, []],
])('sessionsOf: %s', (_name, raw, expected) => {
  expect(sessionsOf(raw)).toEqual(expected)
})

const ARGS: [string, string[], ReturnType<typeof parseArgs>][] = [
  ['引数なし', [], { text: '/reload-plugins', only: [], dryRun: false }],
  ['文と送り先', ['--text', '/clear', '--only', 'kiara, risa'], { text: '/clear', only: ['kiara', 'risa'], dryRun: false }],
  ['送らずに見る', ['--dry-run'], { text: '/reload-plugins', only: [], dryRun: true }],
  ['値の無い --text', ['--text'], '知らない引数か、値が無い: --text'],
  ['空の --text', ['--text', ' '], '知らない引数か、値が無い: --text'],
  ['改行のある文', ['--text', 'a\nb'], '--text に改行は入れられない（入力欄で途中の Enter が送られる）'],
  ['知らない引数', ['--all'], '知らない引数か、値が無い: --all'],
]
test.each(ARGS)('parseArgs: %s', (_name, args, expected) => {
  expect(parseArgs(args)).toEqual(expected)
})
