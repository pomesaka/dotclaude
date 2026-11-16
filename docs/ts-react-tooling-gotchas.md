# TypeScriptとReactの道具の罠

> **TL;DR**: TypeScriptとReactを書いている途中で、Bun、Biome、Next.jsの開発環境が思ったとおりに動かないときに読む。差分には現れない道具の癖だけを集めてあり、レビューの基準には使わない。規約は`typescript.md`と`react.md`にある。

整理する前の版は`archive/2026-11-16/docs/`の`typescript-gotchas.md`、`react.md`、`nextjs.md`にある。項目を足すときは、ライブラリの名前と版、確かめた年月を書く。

## Bunとテスト

- **`import.meta.dir`はTypeScriptの`ImportMeta`に無く、typecheckでエラーになる**。`dirname(fileURLToPath(import.meta.url))`を使う。
  <!-- mentions: 1 | first-seen: 2026-05 -->
- **`import.meta.glob`（Viteがビルド時に変換する）を評価するモジュールは、`bun test`からimportするとロードの時点で落ちる**。純粋な関数を別のモジュールに出し、型は`import type`だけで取り込む（実行時には消える）。実データを既定の引数で束ねた版はglobの側に置く。テストは合成したデータを渡す。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- **`bun:test`の`mock.module`は、テストファイルをまたいで残る**。bun testは複数のファイルを1つのプロセスで走らせるので、モックしたモジュール自身のテスト（`dep.test.ts`）が、実装でなくモックを読んで落ちる。落ちるのはほかのファイルなので、全体を走らせるまで気づかない。判断基準は「モックしたいモジュールに、自分のテストファイルがあるか」。あるなら、モジュールを差し替えず、対象の関数に依存を引数で渡す（`fn(config, deps = { git, gh })`）。
  <!-- mentions: 1 | first-seen: 2026-08 -->
- **`spyOn(globalThis, "fetch")`はグローバルを書き換えるので、`afterEach`で`mockRestore()`する**。戻さないと、同じファイルの後のテストへモックが漏れる。ローカルのオブジェクトへの`spyOn`は戻さなくてよい。
  <!-- mentions: 1 | first-seen: 2026-06 -->

## Biome

- **`noArrayIndexKey`は、JSXの中の`key={i}`を拒否する**。内容から作ったkeyを使う。静的な配列で全要素が一意なら、値をkeyにする。`key={item.key}`のようなプロパティは対象にならない。`// biome-ignore`は、`key={i}`が開始タグと別の行にあると効かないので、`.map()`をJSXの外の変数に出してからコメントを付ける。
  <!-- mentions: 3 | first-seen: 2026-05 -->
- **使わなくなった関数は、`_`を付けずに削除する**。Biomeの`noUnusedVariables`は`_`で通るが、`noUnusedLocals`のTS6133は残る。Biomeが`_`に書き換えたら、本当に使うつもりかを考え直す。
- **EditのたびにBiomeのauto-fixを走らせるhookがある環境では、importを足すEditと、それを使うEditを分けない**。`noUnusedImports`が、使う箇所を書く前のimportを消す。
  <!-- mentions: 2 | first-seen: 2026-06 -->

## Next.jsの開発環境

- **ルートグループ`(name)`を含むパスへのimportを、LSPが「Cannot find module」と誤って報告することがある**。`tsc --noEmit`が通っていれば無視する。これを消すためにファイルを動かさない。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- **PlaywrightでNext.jsのdevサーバーを確かめるとき、`getByRole("alert")`はdev overlayと重なる**。画面の隅の「1 Issue」のバッジが`role="alert"`に当たる要素を持ち、複数にマッチしてstrict modeがthrowする。`.catch(() => false)`で受けていると、エラー表示があるのに無いと判定する。`getByRole("alert", { name: ... })`か`form.getByRole(...)`で絞るか、`next build`と`next start`で確かめる。
  <!-- mentions: 2 | first-seen: 2026-06 -->
