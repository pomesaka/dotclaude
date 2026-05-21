# React a11y + Biome a11y ルール

> **TL;DR**: Biome の a11y ルールは「セマンティック HTML を使え」の自動強制。`<div>` に role/aria を付ける前にセマンティックタグを検討する。aria-live は常時 DOM に存在させ、フェーズごとに固有メッセージを割り当てる。

## Biome a11y ルール早見表

| Biome rule | NG パターン | 正しい代替 |
|---|---|---|
| `useAriaPropsSupportedByRole` | `<div aria-label>` | `<section>` または `role="region"` |
| `noRedundantRoles` | `<ol role="list">` | `<ol>`（role 省略） |
| `noNoninteractiveTabindex` | `role="tabpanel" tabIndex={0}` | `// biome-ignore … WAI-ARIA tabpanel パターン` |
| `useSemanticElements` (group) | `<div role="group" aria-label>` | `<fieldset>` + `<legend className="sr-only">` ※`aria-label` は付けない |
| `useSemanticElements` (radio) | `<button role="radio" aria-checked>` | `<button aria-pressed>` （toggle button パターン） |
| `noRedundantRoles` (list) | `<ul role="list">` | `<ul>`（role 省略。`list-none` + `aria-label` で意味論を担保） |

`<fieldset>` のデフォルトスタイルは `className="border-0 p-0 m-0"` でリセットする。本物のラジオグループが必要なら `<input type="radio">` + `<label>` を CSS でスタイリングする。

## aria-live region

**常時 DOM に存在させる**: `{condition && <div aria-live>}` のように条件付きマウントすると NVDA 等の AT が登録できない。常時置いて content を切り替える。

**フェーズごとに固有メッセージを割り当てる**: `aria-atomic="true"` の AT は DOM content が同一の場合に再読み上げをスキップするため、隣接フェーズに同じ文字列を使うとフェーズ変化を検知できない。

```tsx
const PHASE_MESSAGES: Partial<Record<Phase, string>> = {
  step1: "ステップ1を処理中",
  step2: "ステップ2を処理中",
  done:  "処理が完了しました",
};

// 常時 DOM に存在
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {PHASE_MESSAGES[phase] ?? ""}
</div>
```

出力テキスト本体を live region に流してはいけない（AT が差分ごとに全文読み上げを試みる）。

**Skeleton と aria-live の分離**: `role="status"` 内に `<Skeleton>` を動的追加すると各バーが読み上げられる。テキストアナウンスと視覚的 Skeleton を分離する:
```tsx
<div role="status">
  <p className="sr-only">読み込み中</p>
  <div aria-hidden="true">  {/* Skeleton 群は aria-hidden で隠す */}
    <Skeleton />
  </div>
</div>
```

**`aria-busy` は role を持つ要素に**: `<div>`（暗黙 role: generic）の `aria-busy` はサポート外の AT がある。`<section>`・`<main>`・`<article>` 等のランドマーク要素に付ける。`aria-busy={isLoading || undefined}` とすると false 時に属性が DOM から消える。

## その他の ARIA パターン

- **`<main>` は1ページに1つ**: AppLayout がすでに `<main>` を持つ場合、ページコンポーネントでは `<section aria-label="...">` を使う
- **`<a>` 内に `<button>` は HTML 仕様違反**: `<Link><Button>` ネストは不可。`asChild` パターン（`<Button asChild><Link>...</Link></Button>`）か `variant="link"` で解決
- **カードリンクの accessible name**: `<Link aria-labelledby={headingId}>` + `<h3 id={headingId}>` で読み上げ内容を見出しに絞る
- **`<fieldset aria-label>` + `<legend>` は二重アクセシブル名**: `<legend className="sr-only">` だけ使い `aria-label` は付けない
- **WCAG 2.5.3 Label in Name**: visible text と `aria-label` のミスマッチは違反。accessible name には visible text を含める
- **`role="status"` は動的コンテナのみ**: 静的な空状態 `<div>` に付けない（「ここは更新されるエリア」と宣言することになる）
