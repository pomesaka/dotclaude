// dotclaude の作業コピーへの書き込みの記録。1 回の書き込みが 1 行（JSON Lines）。
// Mod が書き、dotclaude-sync のスキルのスクリプト（skills/dotclaude-sync/sync.ts）が読んで消す。
// WHY 1 か所に置く: 書く側と読む側で形がずれると、読む側が黙って行を捨てる
// WHY claude-code の型を読まない: スキルのスクリプト（Bun で動かす）もこのファイルを読み込む

// dotclaude の作業コピーへの 1 回の書き込み。
// file はリポジトリの直下からの相対パス、cwd は書いたセッションの作業ディレクトリ（元のプロジェクト）。
// excerpt は書いた中身の頭、why は書いた理由に当たる依頼の文。agentId はサブエージェントが書いたときだけ
export type Entry = {
  at: string
  session: string
  agentId?: string
  cwd: string
  tool: string
  file: string
  excerpt: string
  why: string
}

// 記録の置き場所の、ホームからの位置。セッションごとに <セッションID>.jsonl を置く。
// WHY リポジトリの外: 記録には、元のプロジェクトのパスと依頼の文が入る。dotclaude は公開のリポジトリ
// WHY セッションごとのファイル: どのセッションも自分のファイルにだけ書くので、書き込みが競合しない
export const LEDGER_DIR = '.claude/dotclaude-ledger'

// 書いた中身の抜き書きの長さ（文字数）。差分のどこを誰が書いたかを見分けられれば足りる
export const EXCERPT_MAX = 300
// 書いた理由（依頼の文）の長さ（文字数）
export const WHY_MAX = 600

export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)

// 実体のパスを、dotclaude のリポジトリの中の相対パスにする。記録しないものは null。
// WHY workspace/ を外す: そこは jj のワークスペースで、そのセッションが自分でコミットする別の作業コピー
export const repoRelative = (real: string, root: string): string | null => {
  if (!real.startsWith(`${root}/`)) return null
  const relative = real.slice(root.length + 1)
  if (/^(workspace|\.jj|\.git)\//.test(relative)) return null
  return relative
}

// 会話から、書き込みの理由に当たる文を選ぶ。
// メインのセッションでは、利用者の最後の発言。サブエージェントでは、最初の依頼の文（retro の書き手なら発見が入っている）。
// WHY < で始まる文を外す: 終わった知らせ（<task-notification>）や Mod の知らせで、依頼ではない
export const whyOf = (messages: readonly { role: string; text: string }[], isAgent: boolean): string => {
  const asked = messages.filter(message => message.role === 'user' && message.text.trim() !== '' && !message.text.trimStart().startsWith('<'))
  const picked = isAgent ? asked[0] : asked.at(-1)
  return picked === undefined ? '' : clip(picked.text.trim(), WHY_MAX)
}

const isEntry = (value: unknown): value is Entry =>
  typeof value === 'object' &&
  value !== null &&
  'at' in value &&
  typeof value.at === 'string' &&
  'session' in value &&
  typeof value.session === 'string' &&
  'cwd' in value &&
  typeof value.cwd === 'string' &&
  'tool' in value &&
  typeof value.tool === 'string' &&
  'file' in value &&
  typeof value.file === 'string' &&
  'excerpt' in value &&
  typeof value.excerpt === 'string' &&
  'why' in value &&
  typeof value.why === 'string' &&
  (!('agentId' in value) || typeof value.agentId === 'string')

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    // 書きかけの行。読み飛ばす
    return null
  }
}

// 記録のファイルの中身を読む。形の合わない行は読み飛ばす
export const parseEntries = (text: string): Entry[] =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(parseLine)
    .filter(isEntry)

export const formatEntry = (entry: Entry): string => `${JSON.stringify(entry)}\n`

// まだコミットされていない書き込みのファイルの一覧。重複を除き、名前の順
export const pendingFiles = (entries: readonly Entry[]): string[] => [...new Set(entries.map(entry => entry.file))].sort()
