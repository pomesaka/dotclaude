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

// ホームの下で、3 段めまでを広い場所として扱うディレクトリ。アプリや道具が、その下にデータを置く
const DEEP_HOMES = ['Library', '.local', '.config']
// 鍵や認証の情報を置くディレクトリ（ホームからの道筋）。中のファイルを 1 つ消すだけでも止める
const SECRETS = ['.ssh', '.gnupg', '.aws', '.kube', '.docker', '.config/gh', 'Library/Keychains']

// ホームから数えた深さ。ホームの下でなければ null。ホームそのものは 0
const depthInHome = (path: string, home: string | undefined): number | null =>
  home === undefined || home === '' || !isWithin(path, home) ? null : path === home ? 0 : path.slice(home.length + 1).split('/').length

// その道筋が、作業ディレクトリの中（作業ディレクトリそのものは除く）か
export const isInsideProject = (path: string, project: string): boolean => path !== project && isWithin(path, project)

// その道筋が広い場所か。理由を返す。広くなければ null。
// project は、セッションの作業ディレクトリ（cd で動く前の場所）
export const broadReason = (path: string, home: string | undefined, project: string): string | null => {
  const name = path.split('/').at(-1) ?? ''
  // 作業ディレクトリか、それを含むディレクトリにある履歴。作業ディレクトリが、リポジトリの中の深い場所のこともある
  if ((name === '.git' || name === '.jj') && isWithin(project, parentOf(path))) return `the repository's history (${path})`
  // 作業ディレクトリの中は、自分の作業の場所
  if (isInsideProject(path, project)) return null
  if (path === '/') return 'the root of the disk'
  if (parentOf(path) === '/') return `a top-level directory (${path})`
  if (BROAD.has(path)) return `a system directory (${path})`
  const depth = depthInHome(path, home)
  if (home !== undefined && home !== '') {
    if (depth === 0) return 'your home directory'
    if (isWithin(home, path)) return `a directory that contains your home (${path})`
    if (depth === 1) return `a top-level entry of your home (${path})`
    if (depth === 2) return `a second-level directory of your home (${path})`
    if (depth === 3 && DEEP_HOMES.some(deep => isWithin(path, `${home}/${deep}`))) return `a directory where applications keep their data (${path})`
  }
  if (isWithin(project, path)) return path === project ? 'the working directory of this session' : `a directory that contains the working directory (${path})`
  return null
}

// その道筋が、消したり上書きしたりすると困る 1 つのファイルの場所か。理由を返す。
// ホームの直下（~/.zshrc など）と、鍵や認証の情報を置くディレクトリの中
export const preciousReason = (path: string, home: string | undefined, project: string): string | null => {
  if (home === undefined || home === '' || isInsideProject(path, project) || path === project) return null
  if (parentOf(path) === home) return `a file at the top of your home (${path})`
  const secret = SECRETS.find(dir => isWithin(path, `${home}/${dir}`))
  return secret === undefined ? null : `credentials (${path})`
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

// 語が指す場所が、消すと困る 1 つのファイルの場所かを返す。glob は、その親の中のファイルをまとめて指すものとして読む
export const preciousTargetReason = (word: string, place: Place, project: string): string | null => {
  const last = word.split('/').at(-1) ?? ''
  const hasGlob = /[*?[]/.test(last)
  const resolved = resolve(hasGlob ? `${word.slice(0, word.length - last.length) || '.'}/x` : word, place)
  return resolved === null ? null : preciousReason(resolved, place.home, project)
}
