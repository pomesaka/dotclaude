// コマンドに書かれた道筋が、まとめて消したり書き換えたりしてはいけない広い場所かを判定する。

// 道筋を読む基準。cwd の null は、分からない（変数の入った cd の後など）
export type Place = { cwd: string | null; home: string | undefined }

// . と .. を畳み、末尾の / を落とす
const normalize = (path: string): string => {
  const kept: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') kept.pop()
    else kept.push(part)
  }
  return `/${kept.join('/')}`
}

// コマンドに書かれた語を、絶対の道筋にする。変数やコマンドの展開が入っていて読めなければ null。
// ~、$HOME、${HOME} はホームに読み替える
export const resolve = (word: string, place: Place): string | null => {
  const home = place.home
  const expanded =
    home === undefined || home === ''
      ? word
      : word.replace(/^~(?=\/|$)/, home).replace(/^\$\{HOME\}(?=\/|$)/, home).replace(/^\$HOME(?=\/|$)/, home)
  if (expanded.includes('$') || expanded.startsWith('~')) return null
  if (expanded.startsWith('/')) return normalize(expanded)
  return place.cwd === null ? null : normalize(`${place.cwd}/${expanded}`)
}

const parentOf = (path: string): string => normalize(`${path}/..`)
const isWithin = (path: string, ancestor: string): boolean => path === ancestor || path.startsWith(ancestor === '/' ? '/' : `${ancestor}/`)

// / の直下でなくても、広い場所として扱うもの
const BROAD = new Set(['/private/tmp', '/private/var', '/private/etc', '/usr/local', '/usr/bin', '/usr/lib', '/opt/homebrew', '/var/folders'])

// その道筋が広い場所か。理由を返す。広くなければ null。
// project は、セッションの作業ディレクトリ（cd で動く前の場所）
export const broadReason = (path: string, home: string | undefined, project: string): string | null => {
  if (path === '/') return 'the root of the disk'
  if (parentOf(path) === '/') return `a top-level directory (${path})`
  if (BROAD.has(path)) return `a system directory (${path})`
  if (home !== undefined && home !== '') {
    if (path === home) return 'your home directory'
    if (isWithin(home, path)) return `a directory that contains your home (${path})`
    if (parentOf(path) === home) return `a top-level entry of your home (${path})`
  }
  if (isWithin(project, path)) return path === project ? 'the working directory of this session' : `a directory that contains the working directory (${path})`
  const name = path.split('/').at(-1) ?? ''
  if ((name === '.git' || name === '.jj') && isWithin(project, parentOf(path))) return `the repository's history (${path})`
  return null
}

// 語が指す場所が広いかを返す。最後の要素が glob なら、その親の中身をまとめて指すものとして読む。
// * と .* は中身の全部。それ以外の glob（*.log など）は一部なので、作業ディレクトリの中では止めない
export const broadTargetReason = (word: string, place: Place, project: string): string | null => {
  const last = word.split('/').at(-1) ?? ''
  if (!/[*?[]/.test(last)) {
    const resolved = resolve(word, place)
    return resolved === null ? null : broadReason(resolved, place.home, project)
  }
  const parent = resolve(word.slice(0, word.length - last.length) || '.', place)
  if (parent === null) return null
  const isEverything = /^\.?\*$/.test(last)
  // WHY 一部の glob では project を渡さない: 作業ディレクトリの *.log を消すのは、ふつうの片付け
  const reason = broadReason(parent, place.home, isEverything ? project : '\0')
  return reason === null ? null : `everything matching "${last}" in ${reason}`
}
