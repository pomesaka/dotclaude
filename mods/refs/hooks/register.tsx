import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Reference } from '../types'
import { SESSION_CONTEXT } from './context'
import { clampCursor, moveCursor, windowOf } from './cursor'
import { listRoom, wrappedLines } from './format'
import { addReference, canOpen, headingOf, pageOf, parseReference, referencesOf, servedOf, toMarkdown } from './references'

const references = atom({ plugin: 'refs', key: 'references' } as const, [])
const cursor = atom({ plugin: 'refs', key: 'cursor' } as const, 0)
const PANE = 'references'
const PANE_TITLE = 'references'

// $.store には、セッションごとに参照の配列を持つ。キーは refs:<セッションID>。
// WHY セッションごと: $.store は Mod ごとに 1 つで、どのセッションからも同じものが見える
const PREFIX = 'refs:'
// 1 つのセッションで覚える参照の数。古いものから落とす
const REFERENCES_MAX = 100
// $.store に覚えておくセッションの数。古いセッションから落とす
const SESSIONS_MAX = 30

// プロンプトの下の行に足す札の色。status-band の帯の、目立たせない札と同じ
const ACCENT = '#6cb6ff'
const SURFACE = '#30363d'
const SOFT = '#c9d1d9'

// Claude が、参照した文書や URL を一覧に残すためのツール
const ADD_TOOL_NAME = 'add_reference'
const ADD_TOOL = 'mcp__refs__add_reference'
const ADD_TOOL_DESCRIPTION = `Record a document or URL this session relied on, with one line on what it told you, in the user's references pane.
Call it for sources that shaped an answer, a design decision or a fix: a web page, a file in another repository, a local document outside the code being edited. Call it again with the same url to add or replace the note.
URLs read with WebFetch are listed automatically, without a note; add the note here when the page turned out to matter. Do not record the files you are editing.`
const ADD_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'The URL, or the file path for a local document.' },
    title: { type: 'string', description: 'A short title the user will recognize it by.' },
    note: { type: 'string', description: 'One line, in the language you answer the user in: what this source told you or why it mattered.' },
  },
  required: ['url', 'title'],
}
// Claude が、もう開けなくなった参照を一覧から外すためのツール。
// WHY 外すツールを持つ: 自動で入るサーバーの url（difit、portless）は、プロセスが終わると開けなくなる。
// 終わったことに気づけるのは、バックグラウンドのコマンドの終了を知らされる Claude だけ
const REMOVE_TOOL_NAME = 'remove_reference'
const REMOVE_TOOL = 'mcp__refs__remove_reference'
const REMOVE_TOOL_DESCRIPTION = `Remove an entry from the user's references pane by its url.
Use it when the entry no longer opens: a server you started (difit, portless) has exited, or a generated page was deleted. Do not remove sources the user may still want to trace.`
const REMOVE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'The url or file path of the entry, exactly as it is listed.' },
  },
  required: ['url'],
}

// WHY 全部外すツールを持つ: 話題が切り替わったときに、利用者が「refs をまっさらにして」と頼む。
// 外すツールは url を 1 つずつ受けるだけで、Claude は一覧の中身を読めないので、まとめて消す道が無かった（2026-10-10）
const CLEAR_TOOL_NAME = 'clear_references'
const CLEAR_TOOL = 'mcp__refs__clear_references'
const CLEAR_TOOL_DESCRIPTION = `Remove every entry from the user's references pane.
Use it only when the user asks to clear the references. To drop single entries that no longer open, use remove_reference.`
const CLEAR_TOOL_SCHEMA = { type: 'object', properties: {} }

const load = async ($: EngineInterface): Promise<Reference[]> => referencesOf(await $.store.get(`${PREFIX}${await $.session.id()}`))

// 参照の一覧を、$.store と画面の両方に書く。覚えておくセッションの数を超えたら、古いものから消す。
// WHY 消してから書く: $.store.keys() の並びを「最後に書いた順」に保ち、古いセッションから落とせるようにする
const save = async ($: EngineInterface, list: Reference[]): Promise<void> => {
  const key = `${PREFIX}${await $.session.id()}`
  await $.store.delete(key)
  await $.store.set(key, list)
  const keys = (await $.store.keys()).filter(stored => stored.startsWith(PREFIX))
  for (const stale of keys.slice(0, Math.max(0, keys.length - SESSIONS_MAX))) await $.store.delete(stale)
  // WHY 同じなら書かない: 書くたびに、プロンプトの下の行と pane が描き直される
  await update($, references, current => (JSON.stringify(current) === JSON.stringify(list) ? current : list))
}

// 参照を一覧の先頭に足す。同じ url があれば、題名と一言を足して 1 つにまとめる
const remember = async ($: EngineInterface, added: Reference): Promise<Reference[]> => {
  const list = addReference(await load($), added, REFERENCES_MAX)
  await save($, list)
  return list
}

const drop = async ($: EngineInterface, url: string): Promise<void> =>
  save(
    $,
    (await load($)).filter(reference => reference.url !== url),
  )

// セッションの開始時。開き直したセッションでは、$.store に残っている一覧を戻す
const restore = async ($: EngineInterface): Promise<void> => {
  const list = await load($)
  await update($, references, () => list)
}

// pane の一覧で、選んでいる行を delta だけ動かす。length は一覧の行数。
// 一覧は、選んでいる行のまわりの収まる分だけを描くので、pane を送る必要は無い（windowOf）。
// WHY Button の hotkey で作る: 書けるのは数字 1 つか小文字 1 つで、Shift を押しても小文字と同じ扱いになる
// （型定義に「Shift+w is "w"」）。y と Y は区別できないので、全部のコピーは別の小文字（a）にしている。
// WHY NOT Client: キーを自分で受けられて Y も区別できるが、キーが届くのは、その部分をクリックした後だけ。
// キーボードで使う一覧には向かない
const moveSelection = async ($: EngineInterface, delta: number, length: number): Promise<void> => {
  await update($, cursor, current => moveCursor(current, delta, length))
}

// クリップボードへコピーして、結果を toast で知らせる。done は、できたときに出す文
const copyText = async ($: EngineInterface, text: string, surface: RenderSurface, done: string): Promise<void> => {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? done : `コピーできませんでした: ${copied.reason}`)
}

const openInBrowser = ($: EngineInterface, url: string): void => {
  // WHY open: macOS の既定のブラウザで開く。ほかの OS では動かない
  void $.process.run(['open', url], { timeoutMs: 5_000 }).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: ADD_TOOL_NAME, description: ADD_TOOL_DESCRIPTION, inputSchema: ADD_TOOL_SCHEMA, isDeferred: false })
    await $.tool.register({ name: REMOVE_TOOL_NAME, description: REMOVE_TOOL_DESCRIPTION, inputSchema: REMOVE_TOOL_SCHEMA, isDeferred: false })
    await $.tool.register({ name: CLEAR_TOOL_NAME, description: CLEAR_TOOL_DESCRIPTION, inputSchema: CLEAR_TOOL_SCHEMA, isDeferred: false })
    // WHY catch: 一覧を戻せなくても、セッションは始める
    await restore($).catch(() => undefined)
    return next(e)
  })

  // セッションの始め（開き直し、/clear、compact の後も含む）に、一覧とツールの使い方を Claude に伝える。
  // WHY サブエージェントには渡さない: 根拠を残すのは、利用者と話しているメインのセッション
  on('classic.SessionStart', async (_$, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), SESSION_CONTEXT] }
  }).catch((_$, e, next) => next(e))

  // Claude が、参照した文書や URL を一覧に残す
  on('tool.call', { tool: ADD_TOOL }, async ($, e) => {
    const parsed = parseReference(e)
    if (typeof parsed === 'string') return { deny: `add_reference failed: ${parsed}` }
    const list = await remember($, parsed)
    return { result: `Recorded. The references pane now lists ${list.length}.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `add_reference failed: ${next.error.message}` }))

  // Claude が、もう開けなくなった参照を一覧から外す
  on('tool.call', { tool: REMOVE_TOOL }, async ($, e) => {
    const parsed = parseReference(e)
    if (typeof parsed === 'string') return { deny: `remove_reference failed: ${parsed}` }
    const list = await load($)
    if (!list.some(known => known.url === parsed.url)) return { deny: `remove_reference failed: ${parsed.url} is not on the list` }
    await drop($, parsed.url)
    return { result: `Removed. The references pane now lists ${list.length - 1}.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `remove_reference failed: ${next.error.message}` }))

  // Claude が、利用者に頼まれて参照の一覧を空にする
  on('tool.call', { tool: CLEAR_TOOL }, async $ => {
    const list = await load($)
    await save($, [])
    return { result: `Cleared ${list.length}. The references pane is empty.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `clear_references failed: ${next.error.message}` }))

  // 利用者が開き直す画面と、読んだ URL を、ツールの後に一覧へ入れる
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // portless で起動した画面（difit もこれで開く）は、開き直せるように入れる
    const served = e.tool === 'Bash' ? servedOf(e.command) : null
    if (served !== null) await remember($, served)
    // 一時ディレクトリに書いた HTML（explain のページなど）も、同じ理由で入れる
    const page = e.tool === 'Write' ? pageOf(e.file_path) : null
    if (page !== null) await remember($, page)
    // WebFetch で読んだ url は、題名も一言も無いまま入れる。一言は、Claude が add_reference で足す
    if (e.tool === 'WebFetch') await remember($, { url: e.url, title: '', note: '' })
    return ran
    // WHY catch: この hook はすべてのツールの呼び出しを通る。一覧に入れられなくても、ツールの結果はそのまま返す
  }).catch(($, e, next) => next(e))

  // プロンプトの下の行に、refs の札を足す。下の層（エンジンの元の表示、status-band の帯）の右に並べる。
  // WHY 下の層を包むだけにする: この行は、複数の Mod が重ねて描く。ほかの Mod の中身を知らずに、自分の札を足せる。
  // WHY Box に width を付けない: 下の層の木を width の付いた Box に入れると、エンジンが重ねた hook の全部を捨てて、
  // 元の表示だけを描く（v2.1.296 で確認）。status-band の帯も消える。下へ渡す幅（viewport）も書き換えられない。
  // 幅を指定しなくても、下の層の箱は、足した札の分だけ縮む
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.surface !== 'terminal') return inner
    const list = await read($, references)
    if (list.length === 0) return inner
    const { Box, Button, Text } = $.ui.resolve(e)
    // WHY 直接開く: スラッシュコマンドを経由すると、ターンの途中に押したときに、ターンが終わるまで開かない
    const open = () => {
      void $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true })
    }
    return (
      <Box flexDirection="row" columnGap={1}>
        {inner}
        {/* WHY hotkey を付けない: plain の Button は hotkey があると「r: refs」と描かれ、札の見た目が崩れる */}
        <Button key="refs" plain onPress={open}>
          <Text backgroundColor={SURFACE} color={SOFT}>
            {' refs '}
          </Text>
        </Button>
      </Box>
    )
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, references)
    const width = e.props.bodyColumns
    // キーで選んでいる行
    const at = clampCursor(await read($, cursor), list.length)
    const selected = list[at]
    // 一言と url は、選んでいる印の幅（2 桁）だけ字下げして描く
    const inner = Math.max(1, width - 2)
    // 一言は、選んでいる行だけ全文を折り返して出す。ほかの行は 1 行に切る。
    // WHY 選んでいる行だけ: 全部を折り返すと、行の高さが読めず、収まる件数を決められない
    const noteLines = (reference: Reference, index: number): number =>
      reference.note === '' ? 0 : index === at ? wrappedLines(reference.note, inner) : 1
    // 一覧の外に描くもの: 空き 1、ヒント 2
    const shown = windowOf(
      list.map((reference, index) => 1 + noteLines(reference, index) + (reference.title !== '' ? 1 : 0)),
      at,
      listRoom(e.props.scroll.bodyRows, 3),
      1,
    )

    return (
      <Box flexDirection="column" gap={1} width={width}>
        {list.length === 0 ? (
          <Text dimColor>このセッションが参照した文書やURLは、まだありません</Text>
        ) : (
          <Box flexDirection="column" gap={1} width={width}>
            {shown.start > 0 && <Text dimColor>{`  ↑ あと ${shown.start} 件`}</Text>}
            {list.slice(shown.start, shown.end).map((reference, offset) => {
              const index = shown.start + offset
              return (
                <Box key={`row-${reference.url}`} flexDirection="column" width={width}>
                  <Box flexDirection="row" justifyContent="space-between" width={width}>
                    <Box flexDirection="row" columnGap={1}>
                      <Text color={ACCENT}>{index === at ? '▸' : ' '}</Text>
                      {/* 押せるのは canOpen が通すものだけ。ほかのファイルのパスは押せない文字で出す */}
                      <Box width={width - 4}>
                        {canOpen(reference.url) ? (
                          <Button key={`open-${reference.url}`} plain onPress={() => openInBrowser($, reference.url)}>
                            <Text wrap="truncate-end" bold color={ACCENT}>
                              {headingOf(reference)}
                            </Text>
                          </Button>
                        ) : (
                          <Text wrap="truncate-end" bold>
                            {headingOf(reference)}
                          </Text>
                        )}
                      </Box>
                    </Box>
                    <Button key={`drop-${reference.url}`} plain onPress={() => void drop($, reference.url).catch(() => undefined)}>
                      <Text dimColor>×</Text>
                    </Button>
                  </Box>
                  {/* 一言と url は、選んでいる印の幅だけ字下げして、題名の下に揃える */}
                  {reference.note !== '' && (
                    <Box flexDirection="row">
                      <Text>{'  '}</Text>
                      <Box width={inner}>
                        <Text wrap={index === at ? 'wrap' : 'truncate-end'}>{reference.note}</Text>
                      </Box>
                    </Box>
                  )}
                  {/* 題名があるときだけ、url を別の行に出す。無いときは、見出しが url そのもの */}
                  {reference.title !== '' && (
                    <Box flexDirection="row">
                      <Text>{'  '}</Text>
                      <Box width={inner}>
                        <Text wrap="truncate-end" dimColor>
                          {reference.url}
                        </Text>
                      </Box>
                    </Box>
                  )}
                </Box>
              )
            })}
            {shown.end < list.length && <Text dimColor>{`  ↓ あと ${list.length - shown.end} 件`}</Text>}
          </Box>
        )}
        {/* キーのヒント。2 行をまとめて、あいだに空きを入れない */}
        <Box flexDirection="column">
          {selected !== undefined && (
            <Box flexDirection="row" columnGap={2}>
              <Button key="down" hotkey="j" onPress={() => void moveSelection($, 1, list.length).catch(() => undefined)}>
                下
              </Button>
              <Button key="up" hotkey="k" onPress={() => void moveSelection($, -1, list.length).catch(() => undefined)}>
                上
              </Button>
              {canOpen(selected.url) && (
                <Button key="open" hotkey="o" onPress={() => openInBrowser($, selected.url)}>
                  開く
                </Button>
              )}
              <Button key="drop" hotkey="x" onPress={() => void drop($, selected.url).catch(() => undefined)}>
                外す
              </Button>
            </Box>
          )}
          <Box flexDirection="row" columnGap={2}>
            {selected !== undefined && (
              <Button
                key="copy"
                hotkey="y"
                onPress={press => void copyText($, toMarkdown([selected]), press.surface, '選んでいる1件を、Markdownでコピーしました').catch(() => undefined)}
              >
                コピー
              </Button>
            )}
            {selected !== undefined && (
              <Button
                key="copy-all"
                hotkey="a"
                onPress={press => void copyText($, toMarkdown(list), press.surface, `参照を ${list.length} 件、Markdownでコピーしました`).catch(() => undefined)}
              >
                全部コピー
              </Button>
            )}
            {selected !== undefined && (
              // WHY キーを付けない: 取り消せないので、押し間違いで一覧が消えないよう、クリックだけにする
              <Button key="clear" onPress={() => void save($, []).catch(() => undefined)}>
                全部外す
              </Button>
            )}
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
          </Box>
        </Box>
      </Box>
    )
  })
}
