// 指示の文書（CLAUDE.md、docs/、スキルの SKILL.md）が、前回の整理から何割増えたかを測る。
// 2 割を超えたら curate-docs を勧める文を出す。整理が走らないと、広まっているやり方の調査も
// 原則へのまとめも行われないため（docs/prompt-engineering.md の「維持のしかた」）。
//
//   bun growth.ts mark    いまの文字数を、前回の整理の値として baseline.json に書く。整理の最後に走らせる
//   bun growth.ts check   前回の整理から 2 割を超えて増えていれば、勧める文を出す。増えていなければ何も出さない
//
// WHY baseline.json をリポジトリに置く: 整理のコミットと一緒に残り、どの機械から測っても同じ値と比べられる
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const GROWTH_AT = 0.2

export type Baseline = { chars: number; at: string }

// 測る文書。archive/ は整理で退避した物なので数えない
export const measuredFiles = (root: string): string[] => {
  const docs = readdirSync(join(root, 'docs'))
    .filter(name => name.endsWith('.md'))
    .map(name => join(root, 'docs', name))
  const skills = readdirSync(join(root, 'skills'))
    .map(name => join(root, 'skills', name, 'SKILL.md'))
    .filter(path => existsSync(path))
  return [join(root, 'CLAUDE.md'), ...docs, ...skills]
}

// 日本語の文書なので、バイトでなく文字で数える
export const charsOf = (texts: string[]): number => texts.reduce((sum, text) => sum + [...text].length, 0)

export const growthOf = (baseline: Baseline, now: number): number => (now - baseline.chars) / baseline.chars

// 2 割ちょうどは勧めない。超えたときだけ文を返す
export const noticeOf = (baseline: Baseline, now: number): string | null => {
  const growth = growthOf(baseline, now)
  if (growth <= GROWTH_AT) return null
  const percent = Math.round(growth * 100)
  return `指示の文書が、前回の整理（${baseline.at}）から ${percent}% 増えました（${baseline.chars} → ${now} 文字）。/curate-docs で整理し、まとめた原則ごとに広まっているやり方を調べることを、pomesaka に勧める`
}

export const parseBaseline = (json: unknown): Baseline | null => {
  if (typeof json !== 'object' || json === null) return null
  const chars = Reflect.get(json, 'chars')
  const at = Reflect.get(json, 'at')
  if (typeof chars !== 'number' || !Number.isInteger(chars) || chars <= 0 || typeof at !== 'string') return null
  return { chars, at }
}

// リポジトリの直下。このファイルは skills/curate-docs/ にある。~/.claude/skills のリンクから呼ばれても実体で数える
const root = dirname(dirname(dirname(realpathSync(import.meta.path))))
const baselinePath = join(dirname(realpathSync(import.meta.path)), 'baseline.json')

const measure = (): number => charsOf(measuredFiles(root).map(path => readFileSync(path, 'utf8')))

// sync.ts の push からも呼ぶ。基準が無いか壊れていれば、勧めずに黙る（整理の最後の mark で作られる）
export const growthNotice = (): string | null => {
  if (!existsSync(baselinePath)) return null
  const baseline = parseBaseline(JSON.parse(readFileSync(baselinePath, 'utf8')))
  return baseline === null ? null : noticeOf(baseline, measure())
}

if (import.meta.main) {
  const [command] = process.argv.slice(2)
  if (command === 'mark') {
    const baseline: Baseline = { chars: measure(), at: new Date().toISOString().slice(0, 10) }
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`前回の整理の値を ${baseline.chars} 文字（${baseline.at}）にした。baseline.json を整理と一緒にコミットする`)
  } else if (command === 'check') {
    const notice = growthNotice()
    if (notice !== null) console.log(notice)
  } else {
    console.error('使い方: bun growth.ts mark|check')
    process.exit(2)
  }
}
