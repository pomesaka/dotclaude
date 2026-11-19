import type { Candidate, Finding, Kind, RetroEvent } from '../types'

// 文書に上げる回数。WHY 2 回: 1 回きりの事故から書いた規則が積み重なり、11-16 からの 3 日で、よく読む文書が 1.5 倍になった（2026-11-19 に pomesaka と決めた）
export const PROMOTE_AT = 2
// 控えに持つ数と、1 件に持つ根拠の数
export const CANDIDATES_MAX = 100
export const EVIDENCE_MAX = 5
// 控えの出来事を書くディレクトリ（HOME から）。WHY リポジトリの外: 根拠に案件の名前や作業ディレクトリが入る
export const RETRO_DIR = '.claude/retro'

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined

export const isKind = (value: unknown): value is Kind => value === 'doc' || value === 'mechanism' || value === 'request'

const targetOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

const candidateOf = (value: unknown): Candidate | null => {
  const id = field(value, 'id')
  const title = field(value, 'title')
  const detail = field(value, 'detail')
  const kind = field(value, 'kind')
  const count = field(value, 'count')
  const evidence = field(value, 'evidence')
  const lastAt = field(value, 'lastAt')
  const writtenAt = field(value, 'writtenAt')
  if (typeof id !== 'string' || typeof title !== 'string' || typeof detail !== 'string' || !isKind(kind)) return null
  if (typeof count !== 'number' || typeof lastAt !== 'number') return null
  return {
    id,
    title,
    detail,
    kind,
    count,
    evidence: Array.isArray(evidence) ? evidence.filter((one): one is string => typeof one === 'string') : [],
    lastAt,
    writtenAt: typeof writtenAt === 'number' ? writtenAt : null,
    target: targetOf(field(value, 'target')),
  }
}

// 前の版が $.store のキー candidates に持っていた控えを読む。形が合わない項目は捨てる。移し替えにだけ使う
export const storedCandidatesOf = (stored: unknown): Candidate[] => {
  const list = field(stored, 'list')
  return Array.isArray(list) ? list.flatMap(one => candidateOf(one) ?? []) : []
}

const eventOf = (value: unknown): RetroEvent | null => {
  const type = field(value, 'type')
  const id = field(value, 'id')
  const at = field(value, 'at')
  if (typeof at !== 'number') return null
  if (type === 'imported') {
    const candidate = candidateOf(field(value, 'candidate'))
    return candidate === null ? null : { type, candidate, at }
  }
  if (typeof id !== 'string' || id === '') return null
  if (type === 'written' || type === 'dropped') return { type, id, at }
  if (type !== 'seen') return null
  const title = field(value, 'title')
  const detail = field(value, 'detail')
  const kind = field(value, 'kind')
  const evidence = field(value, 'evidence')
  if (typeof title !== 'string' || typeof detail !== 'string' || !isKind(kind)) return null
  return { type, id, title, detail, kind, evidence: typeof evidence === 'string' ? evidence : '', target: targetOf(field(value, 'target')), at }
}

// ファイルの中身を出来事に読む。壊れた行と形の合わない行は捨てる
export const parseEvents = (text: string): RetroEvent[] =>
  text.split('\n').flatMap(line => {
    if (line.trim() === '') return []
    try {
      return eventOf(JSON.parse(line)) ?? []
    } catch {
      return []
    }
  })

export const formatEvents = (events: readonly RetroEvent[]): string => events.map(one => `${JSON.stringify(one)}\n`).join('')

// 出来事を at の順に当てはめて、控えの一覧を作る。並びは最後に出た順。
// WHY 上限を最後に当てる: 回数の少なく古いものから落とすので、どの順に読んでも同じ一覧になる
export const foldEvents = (events: readonly RetroEvent[]): Candidate[] => {
  const byId = new Map<string, Candidate>()
  const ordered = events.map((one, index) => ({ one, index })).sort((a, b) => a.one.at - b.one.at || a.index - b.index)
  for (const { one } of ordered) {
    if (one.type === 'imported') {
      byId.set(one.candidate.id, one.candidate)
      continue
    }
    const before = byId.get(one.id)
    if (one.type === 'dropped') byId.delete(one.id)
    else if (one.type === 'written') {
      if (before !== undefined) byId.set(one.id, { ...before, count: 0, writtenAt: one.at })
    } else
      byId.set(
        one.id,
        before === undefined
          ? { id: one.id, title: one.title, detail: one.detail, kind: one.kind, count: 1, evidence: [one.evidence].filter(e => e !== ''), lastAt: one.at, writtenAt: null, target: one.target }
          : {
              ...before,
              detail: one.detail,
              kind: one.kind,
              count: before.count + 1,
              evidence: [one.evidence, ...before.evidence].filter(e => e !== '').slice(0, EVIDENCE_MAX),
              lastAt: one.at,
              target: one.target ?? before.target,
            },
      )
  }
  const ranked = Array.from(byId.values()).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
  return ranked.slice(0, CANDIDATES_MAX).sort((a, b) => b.lastAt - a.lastAt)
}

// 文書に上げるか。仕組みと要望は、何回出ても文書に書かない
const shouldPromote = (candidate: Candidate, isSevere: boolean): boolean => candidate.kind === 'doc' && (candidate.count >= PROMOTE_AT || isSevere)

// 発見を、足す出来事にする。文書に上げる控えも返す。newId は、ほかのセッションと重ならない id を返す。
// WHY 控えに無い id を指されたら新しくする: 分岐が id を作り話することがある
export const tally = (
  list: readonly Candidate[],
  findings: readonly Finding[],
  at: number,
  newId: () => string,
): { events: RetroEvent[]; promoted: Candidate[] } => {
  const events: RetroEvent[] = []
  const severe = new Set<string>()
  for (const finding of findings) {
    const known = finding.same !== null && list.some(one => one.id === finding.same)
    const id = known && finding.same !== null ? finding.same : newId()
    if (finding.isSevere) severe.add(id)
    events.push({ type: 'seen', id, title: finding.title, detail: finding.detail, kind: finding.kind, evidence: finding.evidence, target: finding.target, at })
  }
  const after = foldEvents([...list.map(candidate => ({ type: 'imported' as const, candidate, at: 0 })), ...events])
  const ids = new Set(events.map(one => (one.type === 'seen' ? one.id : '')))
  const promoted = after.filter(one => ids.has(one.id) && shouldPromote(one, severe.has(one.id)))
  return { events, promoted }
}

// 文書に上げた控えの出来事。WHY tally と分ける: 書き手を立てられなかったら、回数を残して次に出たときに上げ直す
export const writtenEvents = (ids: readonly string[], at: number): RetroEvent[] => ids.map(id => ({ type: 'written', id, at }))

const KIND_LABEL: { [kind in Kind]: string } = { doc: '文書', mechanism: '仕組み', request: '要望' }

const labelOf = (one: Candidate): string => (one.target === null ? KIND_LABEL[one.kind] : `${KIND_LABEL[one.kind]}: ${one.target}`)

// 分岐に渡す控えの一覧。同じ発見を見分けるのに、見出しと種類だけを渡す
export const candidatesForJudge = (list: readonly Candidate[]): string =>
  list.length === 0 ? 'まだ無い' : list.map(one => `- ${one.id}（${labelOf(one)}）${one.title}`).join('\n')

// /retro candidates で見せる一覧。回数の多い順
export const candidatesText = (list: readonly Candidate[]): string =>
  [...list]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .map(one => `${one.id}  ${one.count} 回  ${labelOf(one)}${one.writtenAt === null ? '' : '（文書に上げた）'}  ${one.title}\n    ${one.detail}`)
    .join('\n')
