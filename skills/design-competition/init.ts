// デザインコンペのフォルダの雛形を作る。
//
//   bun init.ts <コンペのフォルダ>
//
// 比較ページ（index.html）はこのスキルの compare.html の写しで、毎回上書きする（直す所が無いため）。
// manifest.json と BRIEF.md は、無いときだけ雛形を置く。中身はコーディネーターが埋める。
import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const here = dirname(realpathSync(import.meta.path))
const dir = process.argv[2]
if (!dir) {
  console.error('使い方: bun init.ts <コンペのフォルダ>')
  process.exit(2)
}
const root = resolve(dir)
mkdirSync(join(root, 'shared'), { recursive: true })
copyFileSync(join(here, 'compare.html'), join(root, 'index.html'))

const made: string[] = ['index.html（比較ページ）']
const manifest = join(root, 'manifest.json')
if (!existsSync(manifest)) {
  const sample = {
    title: '<対象の画面>',
    mocks: [{ key: 'a', name: '<案Aの名前>' }, { key: 'b', name: '<案Bの名前>' }, { key: 'c', name: '<案Cの名前>' }],
    params: {
      state: { label: '状態', values: [{ value: 'empty', label: '空' }, { value: 'many', label: '多い' }] },
    },
    widths: [390, 1280],
  }
  writeFileSync(manifest, `${JSON.stringify(sample, null, 2)}\n`)
  made.push('manifest.json（雛形）')
}
const brief = join(root, 'BRIEF.md')
if (!existsSync(brief)) {
  copyFileSync(join(here, 'brief.md'), brief)
  made.push('BRIEF.md（雛形）')
}

console.log(`${root} に ${made.join('、')} を置いた。shared/ に共通の CSS とデータを置き、manifest.json と BRIEF.md を埋める`)
