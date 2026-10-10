// プロジェクトルート配下への制限。字面の判定（lexical）と実体パスの判定（real）の2段で行う。
// WHY 2段: 字面だけだとroot内のsymlink経由で外へ出られ、実体だけだと存在しない新規ファイル
// （`.env`の新規作成）を判定できない。実体側はhuman-edit.tsが$.fs.statで解決してisInsideに渡す。

export type LexicalPath =
  | { ok: true; absolute: string; relative: string }
  | { ok: false; reason: string }

const normalize = (absolute: string): string => {
  const out: string[] = []
  for (const segment of absolute.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return `/${out.join('/')}`
}

export const isInside = (root: string, candidate: string): boolean => {
  const base = normalize(root)
  const target = normalize(candidate)
  return target !== base && target.startsWith(base === '/' ? '/' : `${base}/`)
}

export const resolveLexical = (root: string, input: string): LexicalPath => {
  if (input.trim() === '') return { ok: false, reason: 'path is empty' }
  if (input.includes('\0')) return { ok: false, reason: 'path contains a NUL byte' }
  const base = normalize(root)
  const absolute = normalize(input.startsWith('/') ? input : `${base}/${input}`)
  if (!isInside(base, absolute)) {
    return { ok: false, reason: `${input} is outside the project root` }
  }
  return { ok: true, absolute, relative: absolute.slice(base.length + 1) }
}

/**
 * 存在しないパスを、存在する最も近い祖先と残りのセグメントに分ける。
 * 残りはresolveLexicalで`..`を畳んだ後なので、実体パス+残りがそのまま着地点になる。
 */
export const splitAtExisting = async (
  absolute: string,
  exists: (path: string) => Promise<boolean>,
): Promise<{ existing: string; rest: string[] }> => {
  const segments = absolute.split('/').filter(s => s !== '')
  const rest: string[] = []
  while (segments.length > 0) {
    const candidate = `/${segments.join('/')}`
    if (await exists(candidate)) return { existing: candidate, rest }
    const last = segments.pop()
    if (last !== undefined) rest.unshift(last)
  }
  return { existing: '/', rest }
}
