import type { Status } from '../types'

export const BAR_CELLS = 10

// 使用率を 10 マスの棒にする。1% でも使っていれば 1 マスは埋める
export const filledCells = (percent: number): number =>
  percent <= 0 ? 0 : Math.max(1, Math.min(BAR_CELLS, Math.round((percent / 100) * BAR_CELLS)))

export type Level = 'calm' | 'watch' | 'full'

// 自動の compaction が近づいたことを色で知らせる。境目の 75 と 90 は目安で、測って決めた値ではない
export const levelOf = (percent: number): Level => (percent >= 90 ? 'full' : percent >= 75 ? 'watch' : 'calm')

// ホームを ~ に縮める。それでも長ければ途中を省き、末尾のディレクトリを max に収まるだけ残す。
// 最後の 1 つは、収まらなくても残す（どこにいるかが分からなくなるため）
export const shortPath = (path: string, home: string | undefined, max: number): string => {
  const tilde = home !== undefined && home !== '' && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
  if (tilde.length <= max) return tilde
  const parts = tilde.split('/')
  const head = parts[0] ?? ''
  let kept = parts.slice(-1)
  for (let count = 2; count < parts.length; count++) {
    const candidate = parts.slice(-count)
    if (`${head}/…/${candidate.join('/')}`.length > max) break
    kept = candidate
  }
  return `${head}/…/${kept.join('/')}`
}

export const isSameStatus = (left: Status | null, right: Status | null): boolean =>
  left === null || right === null
    ? left === right
    : left.model === right.model &&
      left.contextPercent === right.contextPercent &&
      left.directory === right.directory
