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

## 禁止パターン

- Pages Router の混在（App Router に統一）
- `getServerSideProps` / `getStaticProps`（App Router では使わない）
- クライアントコンポーネントでの直接 DB アクセス
