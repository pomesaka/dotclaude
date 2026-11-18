// アプリを起動して確かめているかを、Bash のコマンドから見分ける。
// WHY 起動のコマンドで見る: 起動して確かめる手順は、どのセッションも同じ形で書き直していた（2026-11-18、xwb で 10 回以上）。
//   起動した時点で手順書の有無を伝えれば、手順書を読むか、確かめ終えた後に書くかを、その場で決められる
const LAUNCH = [
  /(^|[\s;&|])portless\s+\S+\s+\S/, // portless <名前> <コマンド>（開発サーバー）
  /(^|[\s;&|])playwright-cli\s+(-s=\S+\s+)?open\b/, // 画面を開く
  /(^|[\s;&|])(bun|npm|pnpm|yarn)\s+(run\s+)?(dev|start|preview)\b/,
  /(^|[\s;&|])(vite|next\s+dev|wrangler\s+dev|cf\s+dev)\b/,
]

export const isLaunch = (command: string): boolean => LAUNCH.some(pattern => pattern.test(command))

// 動かし方の手順書の候補。同梱の /verify と同じく、verify、verifier-*、run-* を探す
export const isGuide = (name: string): boolean => name === 'verify' || name.startsWith('verifier-') || name.startsWith('run-')

// Claude に渡す文。found は見つけた手順書のパス（リポジトリの直下からの相対）
export const noticeOf = (found: readonly string[]): string =>
  found.length > 0
    ? `このリポジトリには、アプリの動かし方の手順書がある: ${found.join('、')}。起動と操作は、手順書のコマンドに従う。手順書のコマンドが動かなかったり、要る手順が抜けていたりしたら、確かめ終えた後にその所だけ直す。`
    : 'このリポジトリには、アプリの動かし方の手順書（.claude/skills/verify/SKILL.md）がまだ無い。確かめ終えて起動と操作の手順が分かったら、~/.claude/agents/verifier.md の「手順書を残す」に従って書く。verifier のエージェントに確かめを任せているなら、そちらが書く。'
