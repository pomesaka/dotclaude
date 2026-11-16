# Next.jsの規約と罠

> **TL;DR**: Next.js App Routerのページ、Server Action、Suspenseを書くときとレビューするときに読む。層の決めごと（featuresのViewとの境界、ルーティング）、Suspenseのfallbackが出る条件、ビルドと実行時に実際に踏んだ罠をまとめてある。Reactの規約は`react.md`にある。

整理する前の版は`archive/2026-11-16/docs/nextjs.md`にある。

## 規約

- **hooksを使うファイルの先頭には`"use client";`を書く**。CCのimportの連鎖の中にあれば省いても動くが、lintでは分からず、後でimportの順が変わると壊れる。
  <!-- mentions: 1 | first-seen: 2026-05 -->
- URLのパラメータとクエリは`page.tsx`で処理し、中身のコンポーネントへpropsで渡す。
- フォームのmutationはServer Actionsで書き、バリデーションはconformで行う。フォームの書き方は`react.md`にある。
- **`packages/features`のViewが受けるpropsは、ドメインの型にする**。`(formData: FormData) => void`でなく`(templateId: string, values: Record<string, string>) => void`。FormDataのパースはViewの中で済ませ、呼び出し側が`_templateId`のような内部のキーを知らなくてよい形にする。Server ActionはJSから呼ぶなら任意の引数を取れる。
  <!-- mentions: 1 | first-seen: 2026-05 -->
- **`packages/features`のViewにcallbackを渡すときは、app層に`"use client"`のWrapperを置く**（async SCで取得、Wrapperがcallbackを用意、Viewが表示）。Server Actionはそのまま渡せるので、Wrapperは要らない。
  <!-- mentions: 1 | first-seen: 2026-05 -->
- **Server Actionが失敗しても入力を残したいときは、stateに入力値を入れて返し（`return { error, email }`）、`defaultValue={state?.email}`で戻す**。失敗するとフォームは`defaultValue`に戻る。passwordは戻さない。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- リソースのルートは`/{resource}/`（一覧）、`/{resource}/new`（新規作成）、`/{resource}/[id]/`（詳細）、`/{resource}/[id]/edit`（編集）に揃える。
- `redirect()`はtry/catchの外で呼ぶ。中で例外を投げるので、catchに捕まると遷移しない。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- `router.refresh()`はSCのデータを取り直すが、CCのstateは残る。
  <!-- mentions: 1 | first-seen: 2026-05 -->

## ローディング

- **`<Suspense>`のfallbackが出るのは、直接の子がasyncのSCか、`use(promise)`を読むCCのときだけ**。`useState`や`useRouter`だけのCCを包んでも出ない。`useQuery`に`initialData`を渡したCCも、すぐsuccessになるので出ない。asyncのSCを直接の子に置けば、その下のCCが`initialData`を持っていても、SCのawaitの間はfallbackが出る。判断基準は「Suspenseの直接の子はSCかCCか」。
- **境界は、データに依る部分だけを囲む**。`loading.tsx`はルートのセグメント全体を包むので、固定のヘッダーや操作のボタンまでskeletonになる。静的な部分があるページでは、`loading.tsx`を置かず、`page.tsx`をasyncでない関数にし、取得を子のasync SCに出して`<Suspense fallback={<Skeleton />}>`で包む。

<!-- mentions: 4 | first-seen: 2026-05 -->

- **Skeletonは、データが来るまで決まらない部分（一覧、本文、利用者ごとの値）だけを置き換える**。ボタン、ラベル、タイトルは実物を出す。実際の中身の形（カード、一覧の構造）をまね、高さを揃えて、切り替えで位置が動かないようにする。Skeletonは対応するコンポーネントと同じファイルに置く。
- モックアップでは`setTimeout`で待ち時間を作り、Skeletonが出るところまで見せる。

## 実際に踏んだ罠

- **route paramsは、percent-encodeされたまま届く**（Next.js 15で確認）。`/invoice/[id]`に`merge:C300`を載せると、`params.id`は`merge%3AC300`になる。`startsWith("merge:")`の判定を通らず、別の分岐でUUIDのクエリに渡って実行時エラーになる。typecheckでは分からない。英数字と`-`以外を含みうる値を載せるなら、`page.tsx`で`decodeURIComponent`してから分岐する。同じrouteに別のprefixを足すときは、既存のprefixにも同じ不具合が無いかを見る。
  <!-- mentions: 1 | first-seen: 2026-07 -->
- **searchParamsとroute paramsの日付のキーは、形だけでなく暦として正しいかまで確かめてからDBに渡す**。`/^\d{4}-\d{2}-01$/`は「2026-13-01」を通し、Postgresの`date field value out of range`でSSRが500になる。クエリ文字列を変えるだけで誰でも起こせる。月は`(0[1-9]|1[0-2])`、日付の全体なら実際のDateへの往復で確かめる。検証の関数はSCとCCの両方が使うので、`_lib/`の1か所に置く。判断基準は「この文字列は、DBの型つきの列（date、uuid、int）に届くか」。
  <!-- mentions: 1 | first-seen: 2026-07 -->
- **検証つきのenvをモジュールのトップレベルで`parse`すると、`next build`が落ちる**。`export const env = schema.parse(process.env)`は、ビルドの時点には無い実行時のenv（コンテナが起動のときに入れる値）を求める。落ちるのは2か所で、「Collecting page data」がrouteのモジュールをimportしてトップレベルの副作用（envのparse、DBクライアントの生成、authの初期化）を走らせるときと、認証つきのページを静的にプリレンダーするとき。env、db、authを、最初のプロパティ参照まで初期化を遅らせるProxyで包み、認証のセグメントのlayoutに`export const dynamic = "force-dynamic"`を付ける。このProxyのtargetの型付けには`as`が要る。`as`を使わない決めごとの、利用者が認めた例外だ。Dockerfileでビルド用の仮のenvを渡す方法より、importの副作用が無く、実行時の検証も残る。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- **Nodeのコアモジュールに依るファイルを、CCがimportするバレルからvalueでre-exportしない**。devのTurbopackはtree-shakeをしないので、`export * from`をたどって「the chunking context does not support external modules (request: node:fs)」で落ちる。AWS SDK、DBクライアント、LLMのproviderのような、中でnodeのコアを使うserver専用の依存も同じ。server専用のシンボルは、`package.json`の`exports`に足したサブパス（`"./agent"`）からimportさせる。`export type`は消えるので問題ない。
  <!-- mentions: 2 | first-seen: 2026-05 -->
- **SSRで同じ重い取得が2つの経路から要るときは、解決する前のPromiseを渡して共有する**。並べて走らせると同じ計算が2回走り、片方をawaitしてから渡すと逐次になる。`const p = heavyFetch(key)`をawaitせずに作り、片方の関数へ`preloadedX: { key, promise }`として渡し、もう片方は`Promise.all([fnA({ preloadedX }), p])`で同じPromiseを待つ。受け取る側は、keyが同じかを確かめてから使う。
  <!-- mentions: 1 | first-seen: 2026-07 -->
- **モックのstorageは、モジュールのスコープのMapをasyncの関数で包んで作る**（sessionStorageを使わない）。SCで`await`でき、`consumeXxx`（getとdeleteを一度に行う）で1回きりの読み出しを保証でき、本番にするときはDBのクエリに差し替えるだけで呼び出し側が変わらない。判断基準は「このstorageの関数は、SCでawaitできるか」。
  <!-- mentions: 2 | first-seen: 2026-06 -->
- **`server-only`パッケージは単独でimportできない**。`import "server-only"`はNext.jsの内部にバンドルされているが、`bun add server-only`してから直接importしようとすると、モジュールの解決でエラーになる。代わりに、ファイルの冒頭のWHYコメントに「SCとServer Actionの専用」と書き、CCから誤ってimportしたときにビルドのエラーで気づけるよう型で守る（`async`の関数はそのままではCCで直接呼べない、という制約を使う）。
  <!-- mentions: 1 | first-seen: 2026-06 -->
