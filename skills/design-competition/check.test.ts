import { describe, expect, test } from 'bun:test'
import { caseSlug, expandCases, type Manifest, parseManifest, type Shot, summarize } from './check'

const base = {
  title: '日報の作り直し',
  mocks: [{ key: 'a', name: '問いと便箋' }, { key: 'b', name: '台帳' }],
  params: {
    screen: { label: '画面', values: [{ value: 'daily', label: '日報' }, { value: 'backlog', label: 'バックログ' }] },
    state: { label: '時間帯', values: [{ value: 'morning', label: '朝' }, { value: 'evening', label: '夕' }, { value: 'done', label: '後' }] },
  },
  widths: [390, 1280],
}
const manifest = (over: Record<string, unknown> = {}): Manifest => ({ ...base, ...over }) as Manifest

// シードを渡せる小さな乱数（mulberry32）。決まりを確かめるテストを毎回同じ入力で走らせる
const rng = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('parseManifest', () => {
  test.each([
    ['書いた値をそのまま返す', { ...base, cases: [{ screen: 'daily', state: 'morning' }] }, { ...base, cases: [{ screen: 'daily', state: 'morning' }] }],
    ['widths を省くと [390, 1280]', { ...base, widths: undefined }, { ...base }],
    ['cases を省くと cases が無い', { ...base }, { ...base }],
    ['params が0個でもよい', { ...base, params: {} }, { ...base, params: {} }],
    ['params を省くと0個', { title: base.title, mocks: base.mocks }, { title: base.title, mocks: base.mocks, params: {}, widths: [390, 1280] }],
    ['幅 1 は正の整数', { ...base, widths: [1] }, { ...base, widths: [1] }],
  ])('%s', (_, input, expected) => {
    const r = parseManifest(JSON.parse(JSON.stringify(input)))
    expect(r).toEqual({ ok: true, manifest: expected as Manifest })
  })

  // 各行: 入力、errors の件数、各誤りの文に含まれるはずの場所と値
  test.each<[string, unknown, number, string[]]>([
    ['null', null, 1, ['manifest', 'null']],
    ['配列', [], 1, ['manifest', '[]']],
    ['文字列', 'x', 1, ['manifest', '"x"']],
    ['title が空', { ...base, title: '' }, 1, ['manifest.title', '""']],
    ['mocks が0件', { ...base, mocks: [] }, 1, ['manifest.mocks', '[]']],
    ['key が大文字', { ...base, mocks: [{ key: 'A', name: 'x' }] }, 1, ['mocks[0].key', '"A"']],
    ['key がパス', { ...base, mocks: [{ key: '../x', name: 'x' }] }, 1, ['mocks[0].key', '"../x"']],
    ['key が空', { ...base, mocks: [{ key: '', name: 'x' }] }, 1, ['mocks[0].key', '""']],
    ['key が重なる', { ...base, mocks: [{ key: 'a', name: 'x' }, { key: 'a', name: 'y' }] }, 1, ['mocks[1].key', '"a"']],
    ['name が空', { ...base, mocks: [{ key: 'a', name: '' }] }, 1, ['mocks[0].name', '""']],
    ['引数の名前が規則外', { ...base, params: { Screen: base.params.screen } }, 1, ['params.Screen', '"Screen"']],
    ['values が0件', { ...base, params: { screen: { label: '画面', values: [] } } }, 1, ['params.screen.values', '[]']],
    ['value が重なる', { ...base, params: { screen: { label: '画面', values: [{ value: 'daily', label: 'x' }, { value: 'daily', label: 'y' }] } } }, 1, ['params.screen.values[1].value', '"daily"']],
    ['value が規則外', { ...base, params: { screen: { label: '画面', values: [{ value: 'Daily', label: 'x' }] } } }, 1, ['params.screen.values[0].value', '"Daily"']],
    ['引数の label が空', { ...base, params: { screen: { label: '', values: [{ value: 'd', label: 'x' }] } } }, 1, ['params.screen.label', '""']],
    ['値の label が空', { ...base, params: { screen: { label: '画面', values: [{ value: 'd', label: '' }] } } }, 1, ['params.screen.values[0].label', '""']],
    ['widths が0件', { ...base, widths: [] }, 1, ['manifest.widths', '[]']],
    ['幅が0', { ...base, widths: [0] }, 1, ['widths[0]', '0']],
    ['幅が負', { ...base, widths: [-1] }, 1, ['widths[0]', '-1']],
    ['幅が小数', { ...base, widths: [390.5] }, 1, ['widths[0]', '390.5']],
    ['幅が文字列', { ...base, widths: ['390'] }, 1, ['widths[0]', '"390"']],
    ['幅が重なる', { ...base, widths: [390, 390] }, 1, ['widths[1]', '390']],
    ['知らないキー', { ...base, width: [390] }, 1, ['manifest.width', '"width"']],
    ['case に無い引数', { ...base, cases: [{ mode: 'x' }] }, 1, ['cases[0].mode', '"mode"']],
    ['case の値が values に無い', { ...base, cases: [{ screen: 'weekly' }] }, 1, ['cases[0].screen', '"weekly"']],
    ['cases が空', { ...base, cases: [] }, 1, ['manifest.cases', '[]']],
    ['既定で埋めると重なる case', { ...base, cases: [{ screen: 'daily' }, { screen: 'daily', state: 'morning' }] }, 1, ['cases[1]']],
  ])('%s は誤り', (_, input, count, parts) => {
    const r = parseManifest(input)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toHaveLength(count)
    for (const p of parts) expect(r.errors[0]).toContain(p)
  })

  test('誤りは最初の1つで止めずに全部返し、それぞれ場所と値を示す', () => {
    const r = parseManifest({ ...base, mocks: [{ key: 'a', name: 'x' }, { key: 'a', name: 'y' }], widths: [0], cases: [{ screen: 'weekly' }] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toHaveLength(3)
    expect(r.errors.find((e) => e.includes('mocks[1].key'))).toContain('"a"')
    expect(r.errors.find((e) => e.includes('widths[0]'))).toContain('0')
    expect(r.errors.find((e) => e.includes('cases[0].screen'))).toContain('"weekly"')
  })
})

describe('expandCases', () => {
  const p1 = { x: { label: 'x', values: [{ value: 'one', label: '1' }] } }
  test.each<[string, Manifest, Record<string, string>[]]>([
    ['引数が0個なら空の組み合わせ1つ', manifest({ params: {} }), [{}]],
    ['引数1個・値1件', manifest({ params: p1 }), [{ x: 'one' }]],
    ['先頭の引数を外側にした直積', manifest(), [
      { screen: 'daily', state: 'morning' }, { screen: 'daily', state: 'evening' }, { screen: 'daily', state: 'done' },
      { screen: 'backlog', state: 'morning' }, { screen: 'backlog', state: 'evening' }, { screen: 'backlog', state: 'done' },
    ]],
    ['cases があればそれだけ', manifest({ cases: [{ screen: 'backlog', state: 'done' }] }), [{ screen: 'backlog', state: 'done' }]],
    ['case に無い引数を先頭の値で埋める', manifest({ cases: [{ state: 'done' }, {}] }), [{ screen: 'daily', state: 'done' }, { screen: 'daily', state: 'morning' }]],
  ])('%s', (_, m, expected) => {
    expect(expandCases(m)).toEqual(expected)
  })

  test('キーは params を書いた順に全部並ぶ', () => {
    const [c] = expandCases(manifest({ cases: [{ state: 'done', screen: 'backlog' }] }))
    expect(Object.keys(c ?? {})).toEqual(['screen', 'state'])
  })

  test('直積は積の件数で、重なりが無く、値は values にある', () => {
    const rand = rng(42)
    for (let n = 0; n < 200; n++) {
      const params: Manifest['params'] = {}
      const count = Math.floor(rand() * 5)
      for (let i = 0; i < count; i++) {
        const k = 1 + Math.floor(rand() * 4)
        params[`p${i}`] = { label: `p${i}`, values: Array.from({ length: k }, (_, j) => ({ value: `v${j}`, label: `v${j}` })) }
      }
      const out = expandCases(manifest({ params }))
      expect(out).toHaveLength(Object.values(params).reduce((a, d) => a * d.values.length, 1))
      expect(new Set(out.map((c) => JSON.stringify(c))).size).toBe(out.length)
      for (const c of out) for (const [k, v] of Object.entries(c)) expect(params[k]?.values.some((x) => x.value === v)).toBe(true)
    }
  })
})

describe('caseSlug', () => {
  test.each<[string, [Record<string, string>, number], [Record<string, string>, number], boolean]>([
    ['キーの並びだけ違えば同じ', [{ screen: 'daily', state: 'done' }, 390], [{ state: 'done', screen: 'daily' }, 390], true],
    ['幅だけ違えば違う', [{ screen: 'daily' }, 390], [{ screen: 'daily' }, 1280], false],
    ['区切りをまたいで入れ替わっても違う', [{ a: 'b-c' }, 390], [{ 'a-b': 'c' }, 390], false],
    ['値と幅の境目がずれても違う', [{ a: '1' }, 390], [{ a: '13' }, 90], false],
    ['大文字と小文字だけの違いも違う', [{ a: 'A' }, 390], [{ a: 'a' }, 390], false],
  ])('%s', (_, [c1, w1], [c2, w2], same) => {
    const a = caseSlug(c1, w1)
    const b = caseSlug(c2, w2)
    expect(a === b).toBe(same)
    if (!same) expect(a.toLowerCase() === b.toLowerCase()).toBe(false)
  })

  test.each([
    ['空の組み合わせ', {}],
    ['使えない文字を含む値', { a: 'x/y\\z:w?v*u t..s' }],
  ])('%s でもファイル名に使える', (_, c) => {
    const slug = caseSlug(c, 390)
    expect(slug.length).toBeGreaterThan(0)
    expect(slug).toMatch(/^[A-Za-z0-9._~-]+$/)
    expect(slug).not.toContain('..')
  })

  test('違う入力は違う名前になり、使えない文字を含まない', () => {
    const rand = rng(7)
    const chars = 'ab-01/\\:?* .~_=&%Aé'
    const pick = (n: number) => Array.from({ length: n }, () => chars[Math.floor(rand() * chars.length)]).join('')
    const seen = new Map<string, string>()
    for (let n = 0; n < 3000; n++) {
      const c = { k: pick(1 + Math.floor(rand() * 4)) }
      const w = 1 + Math.floor(rand() * 2000)
      const input = JSON.stringify([c, w])
      const slug = caseSlug(c, w)
      expect(slug).toMatch(/^[A-Za-z0-9._~-]+$/)
      const key = slug.toLowerCase()
      if (seen.has(key)) expect(seen.get(key)).toBe(input)
      seen.set(key, input)
    }
  })
})

describe('summarize', () => {
  const shot = (mock: string, c: Record<string, string>, width: number, over: Partial<Shot> = {}): Shot =>
    ({ mock, case: c, width, overflowX: 0, height: 1000, errors: [], file: `${mock}.png`, ...over })
  const one = manifest({ mocks: [{ key: 'a', name: '問いと便箋' }], params: { s: { label: 's', values: [{ value: 'x', label: 'x' }] } }, widths: [390, 1280] })

  test.each<[string, Manifest, Shot[], number, string[], string[]]>([
    ['問題の無い案は1行', one, [shot('a', { s: 'x' }, 390), shot('a', { s: 'x' }, 1280)], 0, ['a「問いと便箋」: 2 枚、問題なし'], ['横あふれ']],
    ['横あふれは組み合わせと幅と px', one, [shot('a', { s: 'x' }, 390, { overflowX: 1 })], 0, ['横あふれ 1 枚', '横あふれ 1px: s=x 390px'], []],
    ['エラーの文がそのまま出る', one, [shot('a', { s: 'x' }, 390, { errors: ['TypeError: boom'] })], 0, ['エラー「TypeError: boom」: s=x 390px'], []],
    ['remaining が1なら続きの指示', one, [], 1, ['撮れていない: 1 枚', 'もう一度走らせる'], []],
    ['remaining が0なら指示は無い', one, [shot('a', { s: 'x' }, 390)], 0, [], ['撮れていない']],
  ])('%s', (_, m, shots, remaining, has, hasNot) => {
    const out = summarize(m, shots, remaining)
    for (const h of has) expect(out).toContain(h)
    for (const h of hasNot) expect(out).not.toContain(h)
  })

  test('問題は案ごとに束ねられ、ほかの案に混ざらない', () => {
    const m = manifest({ mocks: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }, { key: 'c', name: 'C' }], params: {}, widths: [390] })
    const out = summarize(m, [shot('a', {}, 390, { overflowX: 5 }), shot('b', {}, 390), shot('c', {}, 390, { errors: ['boom'] })], 0)
    const lines = out.split('\n')
    const at = (h: string) => lines.findIndex((l) => l.startsWith(h))
    const [a, b, c] = [at('a「A」'), at('b「B」'), at('c「C」')]
    expect(lines.slice(a, b).join('\n')).toContain('横あふれ 5px')
    expect(lines[b]).toContain('問題なし')
    expect(lines.slice(c).join('\n')).toContain('boom')
    expect(lines.slice(a, c).join('\n')).not.toContain('boom')
  })

  test('丈の表の形', () => {
    const m = manifest({
      title: 'T',
      mocks: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
      params: { s: { label: 's', values: [{ value: 'x', label: 'x' }, { value: 'y', label: 'y' }] } },
      widths: [390, 1280],
    })
    const shots = [shot('a', { s: 'x' }, 390, { height: 1 }), shot('a', { s: 'x' }, 1280, { height: 2 }), shot('b', { s: 'x' }, 390, { height: 3 }), shot('a', { s: 'y' }, 390, { height: 4 })]
    expect(summarize(m, shots, 0)).toBe(
      [
        'T: 4 枚を撮った（2 案 × 2 組み合わせ × 2 幅）',
        'a「A」: 3 枚、問題なし',
        'b「B」: 1 枚、問題なし',
        '',
        'ページの丈（px）',
        '| 組み合わせ | a 390 | a 1280 | b 390 | b 1280 |',
        '|---|---:|---:|---:|---:|',
        '| s=x | 1 | 2 | 3 | — |',
        '| s=y | 4 | — | — | — |',
      ].join('\n'),
    )
  })
})
