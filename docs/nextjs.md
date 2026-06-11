# Next.js レビュー観点

> **TL;DR**: `<Suspense>` の直接の子が CC なら fallback は永遠に発火しない（dead Suspense）。async SC を子に置く SC Fetcher パターンで解決する。`useQuery(initialData)` は即 success だが、SC Fetcher の await 中に Suspense が発火するので dead にならない。Skeleton は動的コンテンツだけが対象（タイトル・機能コード・説明文は実テキスト表示）。SC から CC へ関数 props を渡すには `"use client"` ClientWrapper を挟む。

React の観点に加え、以下の観点でレビューする。

## App Router

- `page.tsx` はサーバーコンポーネントを基本とする。クライアント側の処理は子コンポーネントに分離する
- `"use client"` の適用範囲を最小限にする（ツリーの末端に近いコンポーネントのみ）
- **`useState` 等の React hooks を使うファイルは必ず `"use client"` を明示する**: CC のインポートチェーン内にあっても省略できない。CC ツリー内で動作するため実害が出ないケースがあるが、Biome や React の lint ルールが検知できず、後から `import` 順が変わった際に壊れる。hooks を使うコンポーネントファイルは常に先頭に `"use client";` を書く。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- URLパラメータ・クエリパラメータの処理は `page.tsx` で行い、コンテンツコンポーネントに props で渡す

## データフェッチ

- サーバーコンポーネントでのフェッチ vs クライアントでの React Query を意識して使い分ける
- `useEffect` でのデータフェッチは禁止（React Query または サーバーコンポーネントを使う）

## Server Actions

- フォームの mutation は Server Actions を使う
- Server Actions のバリデーションは conform で行う
- **`useFormStatus()` は form の子コンポーネントに置く**: 同じコンポーネント内の `<form>` の pending を `useFormStatus()` で読もうとしても、常に `{ pending: false }` が返る。送信ボタンを別コンポーネントに切り出すことで正しく動作する。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
  ```tsx
  // ❌ form と同一コンポーネントで使う → pending が取れない
  function MyForm() {
    const { pending } = useFormStatus(); // 常に false
    return <form action={...}><button disabled={pending}>送信</button></form>;
  }
  // ✅ 子コンポーネントに切り出す
  function SubmitButton() {
    const { pending } = useFormStatus(); // 正しく動く
    return <button type="submit" disabled={pending}>送信</button>;
  }
  function MyForm() {
    return <form action={...}><SubmitButton /></form>;
  }
  ```
- **Server Action を `action` prop として受け取る features View のラッパーは SC のままで良い**: Client Component に関数を渡すと通常 ClientWrapper が必要になるが、Server Action（`"use server"` 関数）はシリアライズ可能なため SC から CC へ直接渡せる。`"use client"` は features の View 自体に付けるだけで足りる。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **コンポーネントライブラリの境界にはドメイン型を使う（transport 型を露出しない）**: `packages/features` の View が Server Action を props として受け取る場合、`(formData: FormData) => void` ではなく `(templateId: string, values: Record<string, string>) => void` のように **ドメイン型のシグネチャ** にする。FormData のパースは View 内部で完結させ、呼び出し側が `_templateId` のような内部キー名を知る必要をなくす。Server Action は JS から呼ぶ場合に任意の引数型を使えるため、FormData に縛られる必要はない。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **`redirect()` は try/catch の外で呼ぶ**: `redirect()` は内部的に `NEXT_REDIRECT` 例外を throw する。try ブロック内で呼ぶと catch に握り潰されてリダイレクトが発生しない。Server Action パターン: `try { await someAction() } catch(err) { /* handle */ throw err } redirect("/")` — redirect は try の外に出す。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **`useActionState` + `defaultValue` でフォームリセットを防ぐ**: Server Action が失敗すると React はフォームを `defaultValue` ベースにリセットする。エラー時に入力値（例: email）を保持したい場合は、state に入力値を含めて返し（`return { error, email }`）、input の `defaultValue={state?.email}` で制御する。password はセキュリティ上保持しない（毎回入力を促す）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`useActionState` の `isPending` を優先する（1フォーム+1アクションの場合）**: React 19 の `useActionState` は 3要素タプル `[state, formAction, isPending]` を返す。1フォーム+1アクションなら `isPending` を使う方がシンプル。`useFormStatus` は form の子コンポーネントに分離する必要があり、中間コンポーネント（`SubmitButton` / `FormContent` 等）が増える overhead がある。`useFormStatus` を使うべきケースは: ① form 内に複数の独立した送信領域（複数 button + 別 action）がある / ② 深いネストで pending を読みたい / ③ 単独の Server Action ではなく純粋な `<form action="...">` を扱う、の3つに限る。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## ルーティング規約

リソースのルートは以下のパターンに統一する:

```
/{resource}/           # 一覧
/{resource}/new        # 新規作成
/{resource}/[id]/      # 詳細
/{resource}/[id]/edit  # 編集
```

## UI 永続化パターン（localStorage vs Cookie）

サイドバー開閉・テーマ・ロケールなど「ページ間で保持したい UI 状態」を SSR と整合させる方法：

| 手法 | SSR で読める？ | 実装コスト | 向いている用途 |
|------|--------------|-----------|--------------|
| `localStorage` | ❌（クライアント専用） | `isLoaded` フラグ + hydration ガードが必要 | SPA・クライアント限定のキャッシュ |
| `Cookie` | ✅（`next/headers` で読める） | SC で読んで props で渡す | テーマ・サイドバー・ロケールなど SSR に影響する UI 状態 |

**Cookie パターン（推奨）**:

```ts
// lib/cookie/sidebar.ts  ("use server")
import { cookies } from "next/headers";
export async function getSidebarOpenCookie() {
  return (await cookies()).get("adet:sidebar-open")?.value !== "false";
}

// layout.tsx (Server Component)
const defaultSidebarOpen = await getSidebarOpenCookie();
<ModeSwitch defaultSidebarOpen={defaultSidebarOpen} />

// use-sidebar-open.ts ("use client")
// initialOpen はサーバーから渡された値 → isLoaded フラグ不要
export function useSidebarOpen(initialOpen: boolean) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API は非同期かつブラウザサポートが限定的
      document.cookie = `adet:sidebar-open=${next}; path=/; max-age=31536000; SameSite=Lax`;
      return next;
    });
  }, []);
  return { isOpen, toggle };
}
```

`localStorage` パターンは `isLoaded` フラグと SSR での初期値ミスマッチを避けるための `useEffect` が必要になり複雑化する。SSR で状態を読む必要がある場合は Cookie を選ぶ。

<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

## ローディングパターン

非同期処理（データフェッチ・mutation）を扱う場面では、必ずローディング状態をセットで設計する。「データを取ってくる」と「その間に何を見せるか」は一体の問題。

### SSR / Server Component での Suspense 境界

**`loading.tsx` vs `<Suspense>` の使い分け**:

- `loading.tsx` → ルートセグメント全体をブロックする。静的なヘッダーやナビも skeleton になる
- `<Suspense fallback={<Skeleton />}>` → 非同期 SC を部分的に包む。静的要素はすぐ表示

ページに固定ヘッダーや静的な操作ボタンがある場合は `<Suspense>` による部分ローディングを優先する:

```tsx
// page.tsx（non-async）
export default function Page() {
  return (
    <>
      <header>即時表示される静的ヘッダー</header>
      <Suspense fallback={<ListSkeleton />}>
        <DataFetcher />   {/* async SC — フェッチ完了まで fallback */}
      </Suspense>
    </>
  );
}
```

**Suspense が有効な条件**:
- async Server Component のストリーミング待機
- Client Component が `use(promise)` で Promise を読む場合

純粋な Client Component（`useState` / `useEffect` のみ）を `<Suspense>` で囲んでも fallback は表示されない。

**Skeleton の設計原則**:
- **動的コンテンツのみ対象**: ボタン・ラベル・タイトル等の静的要素は skeleton にしない。データが来るまで確定できない部分（リスト・本文・ユーザー依存の値）だけを skeleton で置き換える
- 実際のコンテンツの形・レイアウトを模倣する。ランダム幅のバーを並べるだけでなく、カード・リストの構造を再現する
- 実コンテンツと skeleton の高さを揃える（表示切替でレイアウトジャンプが起きない）
- Skeleton は対応コンポーネントと同一ファイルに co-locate する（conventions.md 規約 P）

### クライアントサイドの loading 管理

**TanStack Query の使い分け**:

| 状態 | 意味 | Skeleton 表示 |
|------|------|--------------|
| `isLoading` | 初回フェッチ中（キャッシュなし） | する |
| `isFetching` | 再フェッチ中（キャッシュあり） | しない（stale データを表示したまま） |
| `isPending` | mutation の送信中 | ボタンを disabled に |

初回表示は `isLoading` で Skeleton を出し、バックグラウンド再フェッチは `isFetching` の spinner 等で軽く示すか無視する。

**mutation 中のローディング**:
- 送信ボタンは `isPending` 中に `disabled` にして二重送信を防ぐ
- Optimistic update を使う場合はローディング表示自体を省略できる

**クライアントサイド非同期処理（`setTimeout` / API 呼び出し等）**:
- 処理開始時に `isProcessing: true` → UI をブロック
- 完了・エラー時に `isProcessing: false` → 結果を表示
- モックアップでは `setTimeout` でローディングをシミュレートし、Skeleton を必ず表示する

### よくある間違い

- **Suspense を純粋 CC に使う**: fallback が一切表示されない（無意味なラッパー）
- **loading.tsx で部分ローディングを実現しようとする**: ルート全体がブロックされる
- **Skeleton を省略する**: データが来るまで空白のままになり、ユーザーが壊れていると思う
- **`isFetching` で Skeleton を表示する**: キャッシュのあるデータを消してちらつきが起きる
- **Suspense 境界が CC 全体を包みすぎる**: CC 内部にタブバー・ページヘッダー等の静的要素がある場合、その CC ごと `<Suspense>` で包むと静的要素までスケルトン化される。Suspense はデータ依存部分だけを内側で囲み、静的要素は Suspense 外に置く。Skeleton は形状が正しくても境界が高すぎると別物が skeleton 化される。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

## SC → ClientWrapper → FeatureView パターン

Server Component（SC）は `packages/features` の Client Component に**関数 props を直接渡せない**。SC がデータをフェッチして FeatureView に callback（`onSubmit`・`onSummarize` 等）を渡したい場合は、app 層に "use client" の中間 Wrapper を挟む。

```
SomeFetcher (async SC)          → データ取得
  └── SomeClientWrapper ("use client")  → callback を提供
        └── SomeView (packages/features)       → UI
```

```tsx
// _components/some-fetcher.tsx（async SC）
export async function SomeFetcher() {
  const data = await fetchData();
  return <SomeClientWrapper data={data} />;  // 関数は渡さない
}

// _components/some-client-wrapper.tsx（"use client"）
export function SomeClientWrapper({ data }) {
  const onSubmit = useCallback(async (input) => {
    // アプリ固有の実装（API 呼び出し / モックなど）
    return await callApi(input);
  }, []);

  return <SomeView data={data} onSubmit={onSubmit} />;
}
```

**なぜ直接渡せないか**: SC はサーバーサイドで実行されるため、関数（クロージャ）をシリアライズして CC のツリーに渡すことができない。関数プロップを必要とする CC 境界は必ず app 層の "use client" Wrapper に持たせる。

## Gotchas

- **`server-only` パッケージは standalone import できない**: `import "server-only"` は Next.js 内部にバンドルされているが、`bun add server-only` してから `import "server-only"` で直接 import しようとするとモジュール解決エラーになる。代替: ファイル冒頭の WHY コメントに「このファイルは SC / Server Action 専用」と明記し、誤って CC から import した場合は TypeScript のビルドエラーで気づけるよう型設計で守る（例: `async` 関数はそのままでは CC で直接呼べない制約を利用する）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **mock の storage を async API で統一すると SC/CC 境界の選択が自由になる**: mock 段階で「sessionStorage など CC でしか読めない同期 API」を使うと、読み取り専用ページでも CC + useEffect を強いられ Convention C（SC fetch first）から外れる。代わりにモジュール scope の Map を async 関数（`async getDraftResult(id)`）でラップすれば、SC で `await` できて SC/CC 境界を妥協なく設計できる。本番化時も DB クエリに差し替えるだけで呼び出し側ゼロ変更。判断基準: 「この storage 関数は SC で await できるか？」できなければ本番非対応のシグネチャ。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **`consume`（取得+削除）one-shot パターンは server-side でないと確実に実装できない**: 「一度だけ復元する」（ブラウザバック・リロードで再復元されない）を sessionStorage で実装しようとすると、SSR/CSR の二重読み込み・タブ間共有・リロード race condition に対処する複雑さが出る。server-side Map + `consumeXxx`（get + delete をアトミックに）なら Next.js dev（単一 Node プロセス）では確実に one-shot を保証できる。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`useQuery + initialData` を渡すと Suspense が永遠に発火しない（ただし SC Fetcher パターンは例外）**: `initialData` を渡すとクエリは即 `success` 状態になる。CC を直接 `<Suspense>` で包んでいる場合、CC は絶対に suspend しないため fallback は表示されない（"dead Suspense"）。**例外**: async SC Fetcher が Suspense の内側にある場合、SC の await 中は Suspense が発火する。CC が `useSuspenseQuery(initialData)` を持っていても、SC の await 完了後に CC は即 success になるだけで dead Suspense にはならない。判断基準: Suspense の直接の子が SC か CC か。SC なら有効、CC なら dead。
  <!-- importance: high | mentions: 3 | first-seen: 2026-05 -->
- **`router.refresh()` は CC の state（useState 等）を保持する**: SC データを再取得するがクライアントツリーはアンマウントされない。「refresh したら state がリセットされる」という誤解が生じやすい。Next.js 公式: "The client will merge the updated RSC payload without losing unaffected client-side React state."
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **Node コアモジュール（`node:fs` 等）を参照するファイルをパッケージのバレルに含めると Turbopack がクライアントバンドルで検出してエラーになる**: dev モードの Turbopack は tree-shake をしないため、バレルの `export * from`／value re-export が Node.js コアモジュールを参照するファイルまで辿り "the chunking context does not support external modules (request: node:fs)" のエラーになる。**dev 専用 API（eval runner・ファイル操作スクリプト）だけでなく、server 専用の runtime 依存（AWS SDK・DB クライアント・LLM provider 等、内部で node コアを使う）も同じ**。対処: server 専用シンボルはパッケージのサブパス（`package.json exports` に `"./agent": "./src/agent/index.ts"` 等を追加）から import させ、Client Component が import する runtime バレルからは完全に切り離す。**型のみの re-export（`export type`）は erase されるので安全、value re-export だけが問題**。見極め: 「このバレルを `"use client"` のファイルが import するか？」が Yes なら server runtime を value re-export しない。発覚例: chat barrel が `createChatAgent`（→ `@aws-sdk/credential-providers` → `node:fs`）を value re-export しており、`@ai-sdk/amazon-bedrock`（aws4fetch でブラウザ安全）から `@aws-sdk/credential-providers`（node 依存）に変えた瞬間にビルドが壊れた。
  <!-- importance: high | mentions: 2 | first-seen: 2026-05 -->

- **ルートグループ `(name)` を含むパスは LSP が解決できず false positive になる**: Next.js App Router のルートグループ（`(auth)`, `(app)` 等）のように括弧を含むディレクトリに置かれたファイルへの import は、LSP（VS Code 等）が "Cannot find module" と誤検知することがある。`tsc --noEmit`（`bun run typecheck`）は正常通過するため false positive。対処: typecheck が通っていれば無視してよい。LSP の誤検知を修正しようとして不要なファイル移動をしないこと
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

- **Playwright で Next.js dev サーバーを検証するとき `getByRole("alert")` は dev overlay と衝突する**: Next.js の dev error indicator（画面隅の「1 Issue」バッジ）が `role="alert"` 相当の要素を持つため、アプリ側の alert 要素と合わせて複数マッチになり、Playwright strict mode が `isVisible()`/`textContent()` で throw する。`.catch(() => false)` で握っていると「エラー表示が描画されていない」という false negative になる（実例: エラーメッセージは DOM に存在したのに不在と誤判定）。対処: `page.locator("form").innerHTML()` 等で DOM を直接確認してから判断する・`getByRole("alert", { name: ... })` や scope 付き locator（`form.getByRole(...)`）で絞る・本番ビルド（`next build` + `next start`）で検証する。dev サーバー上の role ベース検証は overlay 由来の偽陽性/偽陰性を常に疑うこと。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->

- **検証付き env をモジュールのトップレベルで `parse` すると `next build` がビルド時にランタイム env を要求して落ちる**: `export const env = schema.parse(process.env)` のようにトップレベルで検証する設計は、`next build` の 2 つのフェーズでランタイム env（本番は ECS/コンテナが起動時に注入し、ビルド時には存在しない）を要求して `ZodError` でクラッシュする。(1) **"Collecting page data"**: route モジュールを import して static/dynamic 判定するため、import チェーン上のトップレベル副作用（env parse・DB クライアント生成・auth 初期化）が全て走る。(2) **静的プリレンダー（export）**: 認証付きページを build 時に render しようとし、render 中の `auth`/`db`（→env）参照で落ちる。NG: `export const env = schema.parse(process.env)` / `export const db = drizzle(postgres({host: env.DB_HOST}))`（トップレベル即生成）。OK: env/db/auth シングルトンを**初回プロパティアクセスまで初期化を遅延する Proxy**でラップして import を副作用フリーにする（`env.X`/`db.X`/`auth.api.*` の API は不変。Proxy の target に `as` が要る点だけ許容）＋ **認証セグメントの layout に `export const dynamic = "force-dynamic"`** を付けてビルド時プリレンダー自体を止める。見極め: 「runtime env がビルド時に不在（ECS/Secrets Manager 注入）」かつ「その env を参照するモジュールが route/page から import される」なら必ず踏む。ビルド時ダミー env を Dockerfile で渡す手もあるが、遅延化のほうが import 副作用ゼロ・ランタイム検証維持で筋が良い。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

## 禁止パターン

- Pages Router の混在（App Router に統一）
- `getServerSideProps` / `getStaticProps`（App Router では使わない）
- クライアントコンポーネントでの直接 DB アクセス
- データフェッチのある SC に Suspense / Skeleton を用意しない
- SC から CC に関数 props を直接渡そうとする（→ ClientWrapper パターンを使う）
