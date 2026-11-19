// デザインコンペの案を、manifest.json の組み合わせと幅ごとに開いて撮り、
// 横あふれ、JS のエラー、ページの丈を案ごとにまとめる。
//
//   bun check.ts <コンペのフォルダ> [--mocks a,b] [--budget 100] [--fresh]
//
// 撮った画像と結果は <フォルダ>/_check/ に置く。2回目からは、ファイルが変わっていない
// 案を撮り直さないので、時間切れで残った分は、同じコマンドをもう一度走らせれば続きから撮る。
// 判断はしない。どの案を直すか、比較表に何を書くかは、出力を読んだエージェントが決める。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

export type ParamDef = { label: string; values: { value: string; label: string }[] }
export type Manifest = {
  title: string
  mocks: { key: string; name: string }[]
  params: Record<string, ParamDef>
  widths: number[]
  cases?: Record<string, string>[]
}
export type Shot = { mock: string; case: Record<string, string>; width: number; overflowX: number; height: number; errors: string[]; file: string }

const NAME = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_WIDTHS = [390, 1280]

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const show = (v: unknown) => JSON.stringify(v) ?? String(v)
const unknownKeys = (obj: Record<string, unknown>, allowed: string[], path: string) =>
  Object.keys(obj)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${path}.${k}: 知らないキーです（${show(k)}）。使えるのは ${allowed.join('、')} です。綴りを確かめてください`)

// 誤りは最初の1つで止めずに全部集める。直す人が1回で全部直せるように、場所と値と許される形を書く
export const parseManifest = (json: unknown): { ok: true; manifest: Manifest } | { ok: false; errors: string[] } => {
  if (!isObject(json)) return { ok: false, errors: [`manifest: オブジェクトではありません（${show(json)}）。{ "title", "mocks", "params", "widths", "cases" } の形で書いてください`] }
  const errors: string[] = unknownKeys(json, ['title', 'mocks', 'params', 'widths', 'cases'], 'manifest')

  const title = json.title
  if (typeof title !== 'string' || title.trim() === '') errors.push(`manifest.title: 空でない文字列にしてください（${show(title)}）`)

  const mocks: Manifest['mocks'] = []
  if (!Array.isArray(json.mocks) || json.mocks.length === 0) {
    errors.push(`manifest.mocks: 案を1件以上の配列で書いてください（${show(json.mocks)}）`)
  } else {
    const seen = new Set<string>()
    json.mocks.forEach((m, i) => {
      const path = `mocks[${i}]`
      if (!isObject(m)) return errors.push(`${path}: { "key", "name" } の形にしてください（${show(m)}）`)
      errors.push(...unknownKeys(m, ['key', 'name'], path))
      const key = m.key
      if (typeof key !== 'string' || !NAME.test(key)) errors.push(`${path}.key: 小文字の英数字とハイフンにしてください（${show(key)}）。案のディレクトリ名になります`)
      else if (seen.has(key)) errors.push(`${path}.key: ほかの案と重なっています（${show(key)}）。案ごとに違う key にしてください`)
      else seen.add(key)
      if (typeof m.name !== 'string' || m.name.trim() === '') errors.push(`${path}.name: 空でない文字列にしてください（${show(m.name)}）`)
      if (typeof key === 'string' && typeof m.name === 'string') mocks.push({ key, name: m.name })
    })
  }

  const params: Record<string, ParamDef> = {}
  if (json.params !== undefined && !isObject(json.params)) {
    errors.push(`manifest.params: { "<名前>": { "label", "values" } } の形にしてください（${show(json.params)}）`)
  } else {
    for (const [name, def] of Object.entries(json.params ?? {})) {
      const path = `params.${name}`
      if (!NAME.test(name)) errors.push(`${path}: 引数の名前は小文字の英数字とハイフンにしてください（${show(name)}）`)
      if (!isObject(def)) {
        errors.push(`${path}: { "label", "values" } の形にしてください（${show(def)}）`)
        continue
      }
      errors.push(...unknownKeys(def, ['label', 'values'], path))
      if (typeof def.label !== 'string' || def.label.trim() === '') errors.push(`${path}.label: 空でない文字列にしてください（${show(def.label)}）`)
      if (!Array.isArray(def.values) || def.values.length === 0) {
        errors.push(`${path}.values: 値を1件以上の配列で書いてください（${show(def.values)}）`)
        continue
      }
      const values: ParamDef['values'] = []
      const seen = new Set<string>()
      def.values.forEach((v, j) => {
        const vpath = `${path}.values[${j}]`
        if (!isObject(v)) return errors.push(`${vpath}: { "value", "label" } の形にしてください（${show(v)}）`)
        errors.push(...unknownKeys(v, ['value', 'label'], vpath))
        if (typeof v.value !== 'string' || !NAME.test(v.value)) errors.push(`${vpath}.value: 小文字の英数字とハイフンにしてください（${show(v.value)}）。URL の引数と画像のファイル名に入ります`)
        else if (seen.has(v.value)) errors.push(`${vpath}.value: 同じ引数の中で重なっています（${show(v.value)}）`)
        else seen.add(v.value)
        if (typeof v.label !== 'string' || v.label.trim() === '') errors.push(`${vpath}.label: 空でない文字列にしてください（${show(v.label)}）`)
        if (typeof v.value === 'string' && typeof v.label === 'string') values.push({ value: v.value, label: v.label })
      })
      params[name] = { label: typeof def.label === 'string' ? def.label : '', values }
    }
  }

  let widths = DEFAULT_WIDTHS
  if (json.widths !== undefined) {
    if (!Array.isArray(json.widths) || json.widths.length === 0) errors.push(`manifest.widths: 1件以上の正の整数の配列にしてください（${show(json.widths)}）。省くと [390, 1280] です`)
    else {
      const seen = new Set<number>()
      json.widths.forEach((w, i) => {
        if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) errors.push(`widths[${i}]: 正の整数にしてください（${show(w)}）`)
        else if (seen.has(w)) errors.push(`widths[${i}]: ほかの幅と重なっています（${show(w)}）`)
        else seen.add(w)
      })
      widths = json.widths as number[]
    }
  }

  let cases: Record<string, string>[] | undefined
  if (json.cases !== undefined) {
    if (!Array.isArray(json.cases) || json.cases.length === 0) {
      errors.push(`manifest.cases: 1件以上の配列にしてください（${show(json.cases)}）。全部の組み合わせを撮るなら、cases ごと省いてください`)
    } else {
      cases = []
      const seen = new Set<string>()
      json.cases.forEach((c, i) => {
        const path = `cases[${i}]`
        if (!isObject(c)) return errors.push(`${path}: { "<引数>": "<値>" } の形にしてください（${show(c)}）`)
        for (const [name, value] of Object.entries(c)) {
          const def = params[name]
          if (!def) errors.push(`${path}.${name}: params に無い引数です（${show(name)}）。使えるのは ${Object.keys(params).join('、') || '（引数なし）'} です`)
          else if (!def.values.some((v) => v.value === value)) errors.push(`${path}.${name}: params.${name}.values に無い値です（${show(value)}）。使えるのは ${def.values.map((v) => v.value).join('、')} です`)
        }
        const filled = fill(params, c as Record<string, string>)
        const id = JSON.stringify(filled)
        if (seen.has(id)) errors.push(`${path}: 既定で埋めると、前の組み合わせと同じになります（${show(c)}）`)
        seen.add(id)
        cases?.push(c as Record<string, string>)
      })
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  const manifest: Manifest = { title: title as string, mocks, params, widths }
  if (cases) manifest.cases = cases
  return { ok: true, manifest }
}

// case に無い引数を、その引数の先頭の値で埋める。キーは params を書いた順に並べる
const fill = (params: Record<string, ParamDef>, c: Record<string, string>) =>
  Object.fromEntries(Object.entries(params).map(([name, def]) => [name, c[name] ?? def.values[0]?.value ?? '']))

export const expandCases = (m: Manifest): Record<string, string>[] => {
  if (m.cases) return m.cases.map((c) => fill(m.params, c))
  // 先頭の引数を外側のループにする（daily×morning, daily×evening, backlog×morning, …）
  return Object.entries(m.params).reduce<Record<string, string>[]>(
    (acc, [name, def]) => acc.flatMap((c) => def.values.map((v) => ({ ...c, [name]: v.value }))),
    [{}],
  )
}

// 名前に使ってよい文字だけを通し、ほかは ~ と16進で表す。~ も表すので、違う入力は違う名前になる。
// 大文字は必ず ~XX になるので、大文字と小文字を区別しないディスクでも重ならない
const encode = (s: string) =>
  Array.from(new TextEncoder().encode(s))
    .map((b) => {
      const ch = String.fromCharCode(b)
      return /[a-z0-9-]/.test(ch) ? ch : `~${b.toString(16).toUpperCase().padStart(2, '0')}`
    })
    .join('')

export const caseSlug = (c: Record<string, string>, width: number): string => {
  const pairs = Object.keys(c)
    .sort()
    .map((k) => `${encode(k)}.${encode(c[k] ?? '')}`)
  return [...pairs, `w${width}`].join('_')
}

const caseLabel = (c: Record<string, string>) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ') || '（引数なし）'

export const summarize = (m: Manifest, shots: Shot[], remaining: number): string => {
  const lines: string[] = []
  const cases = expandCases(m)
  lines.push(`${m.title}: ${shots.length} 枚を撮った（${m.mocks.length} 案 × ${cases.length} 組み合わせ × ${m.widths.length} 幅）`)
  for (const mock of m.mocks) {
    const mine = shots.filter((s) => s.mock === mock.key)
    const over = mine.filter((s) => s.overflowX > 0)
    const errors = new Map<string, string[]>()
    for (const s of mine) for (const e of s.errors) errors.set(e, [...(errors.get(e) ?? []), `${caseLabel(s.case)} ${s.width}px`])
    const head = `${mock.key}「${mock.name}」: ${mine.length} 枚`
    if (over.length === 0 && errors.size === 0) {
      lines.push(`${head}、問題なし`)
      continue
    }
    lines.push(`${head}、横あふれ ${over.length} 枚、エラー ${errors.size} 種`)
    for (const s of over) lines.push(`  横あふれ ${s.overflowX}px: ${caseLabel(s.case)} ${s.width}px`)
    for (const [e, where] of errors) lines.push(`  エラー「${e}」: ${where.join('、')}`)
  }

  // 丈の表。行が組み合わせ、列が案と幅。撮れていないセルは — にする
  const cols = m.mocks.flatMap((mk) => m.widths.map((w) => ({ mock: mk.key, width: w })))
  lines.push('', 'ページの丈（px）', `| 組み合わせ | ${cols.map((c) => `${c.mock} ${c.width}`).join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`)
  for (const c of cases) {
    const id = JSON.stringify(c)
    const cells = cols.map((col) => shots.find((s) => s.mock === col.mock && s.width === col.width && JSON.stringify(s.case) === id)?.height ?? '—')
    lines.push(`| ${caseLabel(c)} | ${cells.join(' | ')} |`)
  }
  if (remaining > 0) lines.push('', `撮れていない: ${remaining} 枚（時間切れ）。同じコマンドをもう一度走らせると、撮った分を飛ばして続きから撮ります`)
  return lines.join('\n')
}

// ── ここから下は、ブラウザとファイルを触る入口 ─────────────────────

type Report = { stamps: Record<string, number>; shots: Shot[] }

// 案のディレクトリと shared/ の中で、いちばん新しい更新の時刻。変わっていなければ撮り直さない
const stampOf = (dir: string, mock: string): number => {
  const walk = (p: string): number => {
    if (!existsSync(p)) return 0
    const st = statSync(p)
    if (!st.isDirectory()) return st.mtimeMs
    return Math.max(st.mtimeMs, ...readdirSync(p).map((n) => walk(join(p, n))))
  }
  return Math.max(walk(join(dir, mock)), walk(join(dir, 'shared')))
}

const findPlaywright = () => {
  const bases = [join(process.cwd(), 'package.json'), import.meta.path]
  try {
    const cli = execFileSync('which', ['playwright-cli'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0]?.trim()
    if (cli) bases.push(realpathSync(cli))
  } catch {}
  for (const base of bases) {
    try {
      return createRequire(base)('playwright')
    } catch {}
  }
  return null
}

const main = async () => {
  const args = process.argv.slice(2)
  const opt = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
  }
  const dir = args.find((a, i) => !a.startsWith('--') && !['--mocks', '--budget'].includes(args[i - 1] ?? ''))
  if (!dir) {
    console.error('使い方: bun check.ts <コンペのフォルダ> [--mocks a,b] [--budget 100] [--fresh]')
    process.exit(2)
  }
  const root = resolve(dir)
  const file = join(root, 'manifest.json')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`${file} を読めません: ${(e as Error).message}\nbun init.ts <フォルダ> で雛形を作るか、JSON の書き方を直してください`)
    process.exit(1)
  }
  const parsed = parseManifest(raw)
  if (!parsed.ok) {
    console.error(`${file} に誤りがあります:\n${parsed.errors.map((e) => `- ${e}`).join('\n')}`)
    process.exit(1)
  }
  const m = parsed.manifest
  const only = opt('mocks')?.split(',')
  const targets = m.mocks.filter((mk) => !only || only.includes(mk.key))
  const missing = targets.filter((mk) => !existsSync(join(root, mk.key, 'index.html')))
  if (missing.length > 0) {
    console.error(`案の index.html がありません: ${missing.map((mk) => `${mk.key}/index.html`).join('、')}`)
    process.exit(1)
  }
  const budgetMs = Number(opt('budget') ?? 100) * 1000

  const pw = findPlaywright()
  if (!pw) {
    console.error('Playwright が見つかりません。Playwright の入ったプロジェクトのディレクトリで走らせるか、playwright-cli を入れてください')
    process.exit(1)
  }
  const outDir = join(root, '_check')
  const reportFile = join(outDir, 'report.json')
  const prev: Report = !args.includes('--fresh') && existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : { stamps: {}, shots: [] }
  const report: Report = { stamps: { ...prev.stamps }, shots: [] }
  const fresh = new Set(targets.filter((mk) => prev.stamps[mk.key] !== stampOf(root, mk.key)).map((mk) => mk.key))
  // 変わっていない案の結果は前回のものを使う
  report.shots = prev.shots.filter((s) => m.mocks.some((mk) => mk.key === s.mock) && !fresh.has(s.mock))

  const { startServer } = await import('./server')
  const server = startServer(root, 0)
  let browser
  try {
    browser = await pw.chromium.launch()
  } catch {
    browser = await pw.chromium.launch({ channel: 'chrome' })
  }
  const started = Date.now()
  const cases = expandCases(m)
  const todo = targets.flatMap((mk) => m.widths.flatMap((w) => cases.map((c) => ({ mock: mk.key, width: w, case: c }))))
    .filter((t) => !report.shots.some((s) => s.mock === t.mock && s.width === t.width && JSON.stringify(s.case) === JSON.stringify(t.case)))
  let done = 0
  try {
    for (const mk of targets) {
      for (const width of m.widths) {
        const mine = todo.filter((t) => t.mock === mk.key && t.width === width)
        if (mine.length === 0) continue
        const page = await browser.newPage({ viewport: { width, height: 900 } })
        let errors: string[] = []
        page.on('pageerror', (e: Error) => errors.push(e.message))
        page.on('console', (msg: { type(): string; text(): string }) => msg.type() === 'error' && errors.push(msg.text()))
        for (const t of mine) {
          if (Date.now() - started > budgetMs) break
          errors = []
          await page.goto(`http://127.0.0.1:${server.port}/${mk.key}/index.html?${new URLSearchParams(t.case)}`, { waitUntil: 'load' })
          await page.waitForTimeout(300)
          // ブラウザの中で計る。このリポジトリの型は DOM を持たないので、式を文字列で渡す
          const r: { overflowX: number; height: number } = await page.evaluate('({ overflowX: document.documentElement.scrollWidth - innerWidth, height: document.documentElement.scrollHeight })')
          const shot = join(outDir, mk.key, `${caseSlug(t.case, width)}.png`)
          mkdirSync(join(outDir, mk.key), { recursive: true })
          await page.screenshot({ path: shot, fullPage: true })
          report.shots.push({ mock: mk.key, case: t.case, width, overflowX: Math.max(0, r.overflowX), height: r.height, errors: [...new Set(errors)], file: shot })
          done++
          console.error(`撮った ${done}/${todo.length}: ${mk.key} ${width}px ${new URLSearchParams(t.case)}`)
        }
        await page.close()
      }
      if (todo.filter((t) => t.mock === mk.key).every((t) => report.shots.some((s) => s.mock === t.mock && s.width === t.width && JSON.stringify(s.case) === JSON.stringify(t.case)))) {
        report.stamps[mk.key] = stampOf(root, mk.key)
      }
    }
  } finally {
    await browser.close()
    server.stop(true)
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(reportFile, JSON.stringify(report, null, 2))
  const shown = report.shots.filter((s) => targets.some((mk) => mk.key === s.mock))
  console.log(summarize({ ...m, mocks: targets }, shown, todo.length - done))
  console.log(`\n画像: ${outDir}/<案>/<組み合わせ>.png`)
}

if (import.meta.main) await main()
