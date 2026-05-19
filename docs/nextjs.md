# Next.js レビュー観点

React の観点に加え、以下の観点でレビューする。

## App Router

- `page.tsx` はサーバーコンポーネントを基本とする。クライアント側の処理は子コンポーネントに分離する
- `"use client"` の適用範囲を最小限にする（ツリーの末端に近いコンポーネントのみ）
- URLパラメータ・クエリパラメータの処理は `page.tsx` で行い、コンテンツコンポーネントに props で渡す

## データフェッチ

- サーバーコンポーネントでのフェッチ vs クライアントでの React Query を意識して使い分ける
- `useEffect` でのデータフェッチは禁止（React Query または サーバーコンポーネントを使う）

## Server Actions

- フォームの mutation は Server Actions を使う
- Server Actions のバリデーションは conform で行う

## ルーティング規約

リソースのルートは以下のパターンに統一する:

```
/{resource}/           # 一覧
/{resource}/new        # 新規作成
/{resource}/[id]/      # 詳細
/{resource}/[id]/edit  # 編集
```

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

## 禁止パターン

- Pages Router の混在（App Router に統一）
- `getServerSideProps` / `getStaticProps`（App Router では使わない）
- クライアントコンポーネントでの直接 DB アクセス
- データフェッチのある SC に Suspense / Skeleton を用意しない
- SC から CC に関数 props を直接渡そうとする（→ ClientWrapper パターンを使う）
