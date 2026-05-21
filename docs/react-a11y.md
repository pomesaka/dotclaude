# React a11y + Biome a11y ルール

> **TL;DR**: Biome の a11y ルールは「セマンティック HTML を使え」の自動強制。`<div>` に role/aria を付ける前にセマンティックタグを検討する。aria-live は常時 DOM に存在させ、フェーズごとに固有メッセージを割り当てる。

## Biome a11y ルール早見表

| Biome rule | NG パターン | 正しい代替 |
|---|---|---|
| `useAriaPropsSupportedByRole` | `<div aria-label>` / `<div aria-labelledby>` | `<section aria-labelledby={id}>` — `role="region"` はさらに `useSemanticElements` に弾かれるため `<section>` を使う |
| `useSemanticElements` (region) | `<div role="region" aria-labelledby>` | `<section aria-labelledby={id}>` |
| `noRedundantRoles` | `<ol role="list">` | `<ol>`（role 省略） |
| `noNoninteractiveTabindex` | `role="tabpanel" tabIndex={0}` | `// biome-ignore … WAI-ARIA tabpanel パターン` |
| `useSemanticElements` (group) | `<div role="group" aria-label>` | `<fieldset>` + `<legend className="sr-only">` ※`aria-label` は付けない |
| `useSemanticElements` (radio) | `<button role="radio" aria-checked>` | `<button aria-pressed>` （toggle button パターン） |
| `noRedundantRoles` (list) | `<ul role="list">` | `<ul>`（role 省略。`list-none` + `aria-label` で意味論を担保） |

`<fieldset>` のデフォルトスタイルは `className="border-0 p-0 m-0"` でリセットする。本物のラジオグループが必要なら `<input type="radio">` + `<label>` を CSS でスタイリングする。

### 条件付き `role` + `aria-*` は Biome が静的に弾く

`role={cond ? "tabpanel" : undefined}` と `aria-labelledby={cond ? id : undefined}` を同じ要素に並べると、Biome の `useAriaPropsSupportedByRole` が「role のない div に aria-labelledby がある」と判定してエラーにする（条件が同一であっても静的解析では安全性を証明できない）。

修正パターン: 要素ごと三項で分岐する。

```tsx
// NG
<div
  role={isAdmin ? "tabpanel" : undefined}
  aria-labelledby={isAdmin ? id : undefined}
>...</div>

// OK
{isAdmin ? (
  <div role="tabpanel" aria-labelledby={id}>...</div>
) : (
  <div>...</div>
)}
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

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
- **タブは `aria-current="page"` ではなく `aria-selected`**: `aria-current="page"` はページネーション・サイトマップで「現在のページ」を示す。タブコンテキストでは WAI-ARIA Tabs パターン（`<div role="tablist">` + `<button role="tab" aria-selected={...}>`）または単に `aria-selected={isActive}` を使う
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **WAI-ARIA Tabs: roving tabindex だけでは不十分。矢印キーナビゲーションが必須**: `role="tablist"` を使う場合、`tabIndex={active ? 0 : -1}` の roving tabindex に加えて `onKeyDown` で ArrowLeft/ArrowRight によるフォーカス移動を実装すること。WAI-ARIA Tabs パターンの仕様要件。
  ```tsx
  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") {
      const next = (index + 1) % TABS.length;
      const nextTab = TABS[next];
      if (nextTab) { setTab(nextTab); tabRefs.current[next]?.focus(); }
    } else if (e.key === "ArrowLeft") {
      const prev = (index - 1 + TABS.length) % TABS.length;
      const prevTab = TABS[prev];
      if (prevTab) { setTab(prevTab); tabRefs.current[prev]?.focus(); }
    }
  };
  ```
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`<Link>` の無効化には `tabIndex={-1}` + `aria-disabled` + `pointer-events-none` の3点セットが必要**: `aria-disabled` だけでは Tab でフォーカスして Enter でリンクを起動できてしまう。`tabIndex={-1}` でフォーカスを外すことで初めてキーボードからも無効化できる。
  ```tsx
  <Link
    href={href}
    aria-disabled={isPending}
    tabIndex={isPending ? -1 : undefined}
    className={`...${isPending ? " pointer-events-none opacity-50" : ""}`}
  >
    キャンセル
  </Link>
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **Biome の `useAriaPropsSupportedByRole` が条件付き aria props を静的に拒否**: `aria-labelledby={condition ? "id-a" : "id-b"}` のような式を Biome が静的解析で拒否する。対処: JSX ternary で2つのコンポーネントに分岐させ、それぞれに固定の文字列を渡す。
  ```tsx
  // ❌ Biome に弾かれる
  <div role="tabpanel" aria-labelledby={`tab-${activeTab}`} />
  // ✅ JSX ternary で分岐
  {activeTab === "a"
    ? <div role="tabpanel" aria-labelledby="tab-a" />
    : <div role="tabpanel" aria-labelledby="tab-b" />}
  ```
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`role="link"` on `<div>` も Biome `useSemanticElements` が拒否**: disabled なナビゲーション項目を `<div role="link" aria-disabled>` で表現するとBiome エラー。`<button type="button" disabled>` が正しい代替（ナビ操作ではなくアクションとして扱い、 disabled でインタラクション不可を表現）。`<a>` を使いたい場合は `href` 省略 + `aria-disabled` が必要だがBiome の `useSemanticElements` が `href` なし `<a>` に対して `<span>` 推奨を出すことがある。`<button disabled>` が最も安全。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **Biome `useSemanticElements` が `role="radio"` on `<button>` を拒否**: 単一選択グループをボタン＋`role="radio"` で実装すると Biome がエラー。ネイティブの `<input type="radio" className="sr-only">` を `<label>` で包み、ラベル要素にカード状のスタイルを適用する。これで Biome・a11y・キーボード操作すべてが正しく動く。`aria-pressed` はボタンのトグル（複数選択を示唆）なので単一選択に使ってはいけない。
  ```tsx
  <label className={cn("flex-1 border px-3 py-2.5 cursor-pointer", isSelected ? "border-primary bg-primary" : "border-border")}>
    <input type="radio" name="group-name" value={opt.value} checked={isSelected}
      onChange={() => onSelect(opt.value)} className="sr-only" />
    {opt.label}
  </label>
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
