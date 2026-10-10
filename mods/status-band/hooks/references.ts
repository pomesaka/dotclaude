import type { Reference } from '../types'

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// add_reference ツールの入力を読む。読めなければ、理由の文字列を返す
export const parseReference = (input: unknown): Reference | string => {
  const url = field(input, 'url')
  if (typeof url !== 'string' || url.trim() === '') return 'url must be a non-empty string (a URL or a file path)'
  const title = field(input, 'title')
  const note = field(input, 'note')
  if (title !== undefined && typeof title !== 'string') return 'title must be a string'
  if (note !== undefined && typeof note !== 'string') return 'note must be a string'
  return { url: url.trim(), title: text(title), note: text(note) }
}

// $.store から読んだ値を、参照の並びに戻す。形の合わない項目は飛ばす
export const referencesOf = (stored: unknown): Reference[] =>
  Array.isArray(stored)
    ? stored.flatMap((item: unknown) => {
        const url = text(field(item, 'url'))
        return url === '' ? [] : [{ url, title: text(field(item, 'title')), note: text(field(item, 'note')) }]
      })
    : []

// 参照を先頭に置く。並びは、最後に足したものが先頭。
// 同じ url がすでにあれば 1 つにまとめる。新しい側の題名と一言が空なら、前のものを残す。
// WHY 空で上書きしない: WebFetch で読んだ url は、題名も一言も無いまま自動で入る。
// Claude が一言を足した後に同じ url をもう一度読んでも、その一言を消さない
export const addReference = (list: Reference[], added: Reference, max: number): Reference[] => {
  const before = list.find(known => known.url === added.url)
  const merged: Reference = {
    url: added.url,
    title: added.title !== '' ? added.title : (before?.title ?? ''),
    note: added.note !== '' ? added.note : (before?.note ?? ''),
  }
  return [merged, ...list.filter(known => known.url !== added.url)].slice(0, max)
}

// portless のサブコマンド。アプリの名前には使えない（portless --help の Reserved names で確認）
const PORTLESS_RESERVED = ['run', 'get', 'alias', 'hosts', 'list', 'trust', 'clean', 'prune', 'proxy', 'service']

const PORTLESS_AT = String.raw`(?:^|[|;&]\s*|--\s+|\b(?:sudo|npx|bunx)\s+)portless\s+`
const PORTLESS_NAME = String.raw`([a-z0-9][a-z0-9.-]*)`
const PORTLESS_FORCED = new RegExp(String.raw`${PORTLESS_AT}(?:run\s+)?--name\s+${PORTLESS_NAME}(?=\s|$)`, 'i')
const PORTLESS_NAMED = new RegExp(String.raw`${PORTLESS_AT}${PORTLESS_NAME}\s+\S`, 'i')

// Bash のコマンドが portless で名前を付けてサーバーを起動していれば、その画面の参照を返す。difit もこの形で起動する。
// WHY 出力でなくコマンドから読む: サーバーは run_in_background で起動するので、hook に届く結果に url が出ない。
// url は名前から決まる（portless <name> <cmd> -> https://<name>.localhost）。
// 名前を書かない起動（portless、portless run）は、名前が package.json で決まるので拾わない。
// jj のワークスペースで付く接頭辞と --tld も見ていない
export const servedOf = (command: string): Reference | null => {
  const forced = PORTLESS_FORCED.exec(command)?.[1]
  const named = PORTLESS_NAMED.exec(command)?.[1]
  const name = forced ?? (named !== undefined && !PORTLESS_RESERVED.includes(named.toLowerCase()) ? named : undefined)
  if (name === undefined) return null
  return {
    url: `https://${name.toLowerCase()}.localhost`,
    title: name,
    note: /\bdifit\b/.test(command) ? 'difit で開いた差分' : 'portless で起動したサーバー',
  }
}

// Write で一時ディレクトリに書いた HTML（explain スキルのページなど）の参照を返す。
// WHY tmp の下だけ: リポジトリの中の HTML は編集しているコードで、参照ではない
export const pageOf = (path: string): Reference | null => {
  const name = /\/tmp\/(?:.*\/)?([^/]+)\.html$/.exec(path)?.[1]
  return name === undefined ? null : { url: path, title: name, note: '生成した HTML' }
}

// Web の url か。
export const isWebUrl = (url: string): boolean => /^https?:\/\//.test(url)

// open に渡してよい url か。Web の url と、絶対パスの HTML だけを通す。
// WHY 絞る: url はモデルが渡す文字列で、そのまま open に渡す。
// file: や独自のスキーム、HTML 以外のファイルを通すと、アプリの起動やファイルの実行につながる。
// HTML は既定のブラウザで開くだけなので通す
export const canOpen = (url: string): boolean => isWebUrl(url) || /^\/.+\.html$/.test(url)

// 一覧に出す見出し。題名が無ければ url
export const headingOf = (reference: Reference): string => (reference.title !== '' ? reference.title : reference.url)

// 一覧を Markdown の箇条書きにする。PR の本文やメモに貼る用
export const toMarkdown = (list: Reference[]): string =>
  list
    .map(reference => {
      const link = isWebUrl(reference.url)
        ? `[${headingOf(reference)}](${reference.url})`
        : reference.title !== ''
          ? `${reference.title}（\`${reference.url}\`）`
          : `\`${reference.url}\``
      return reference.note !== '' ? `- ${link}: ${reference.note}` : `- ${link}`
    })
    .join('\n')
