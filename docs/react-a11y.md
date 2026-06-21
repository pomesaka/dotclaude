# React a11y + Biome a11y ルール

> **TL;DR**: Biome の a11y ルールは「セマンティック HTML を使え」の自動強制。`<div>` に role/aria を付ける前にセマンティックタグを検討する。aria-live は常時 DOM に存在させ、フェーズごとに固有メッセージを割り当てる。

## Biome a11y ルール早見表

| Biome rule | NG パターン | 正しい代替 |
|---|---|---|
| `useAriaPropsSupportedByRole` | `<div aria-label>` / `<div aria-labelledby>` | `<section aria-labelledby={id}>` — `role="region"` はさらに `useSemanticElements` に弾かれるため `<section>` を使う |
| `useSemanticElements` (region) | `<div role="region" aria-labelledby>` | `<section aria-labelledby={id}>` |
| `noRedundantRoles` | `<ol role="list">` | `<ol>`（role 省略） |
| `noNoninteractiveTabindex` | `<span tabIndex={0}>` / `role="tabpanel" tabIndex={0}` | `<button type="button">` に置き換える（`<button>` はデフォルトで keyboard-focusable）。WAI-ARIA tabpanel パターンが必要な場合のみ `// biome-ignore` |
| `useSemanticElements` (group) | `<div role="group" aria-label>` | フォームのグループなら `<fieldset>` + `<legend className="sr-only">`。**フォーム以外（データテーブルの列グループ等）では `<fieldset>` は意味的に不適切** → `<section aria-label="...">` を使う（section は landmark role を持ち aria-label が有効に機能する）。`<fieldset>` の `aria-label` は付けない（`<legend>` で代替） |
| `useSemanticElements` (radio) | `<button role="radio" aria-checked>` | `<button aria-pressed>` （toggle button パターン） |
| `noRedundantRoles` (list) | `<ul role="list">` | `<ul>`（role 省略。`list-none` + `aria-label` で意味論を担保） |
| `noStaticElementInteractions` | `<div onClick>` / **`<div onMouseEnter>` / `<div onMouseLeave>`** | ハンドラを `<button>` 等の interactive 要素へ移す |

### `noStaticElementInteractions` は mouse enter/leave も弾く
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

`onClick` だけでなく **`onMouseEnter` / `onMouseLeave` を非 interactive 要素（`<div>` 等）に付けても弾かれる**（jsx-a11y の handler リストより広い）。ホバーで状態を変えるなら、ハンドラは行内の既存 `<button>` に集約する。「コンテナ全体の onMouseLeave で解除」したくなるが、それも div では弾かれるので、解除も近接の button の onMouseEnter で代替する（例: ハイライト解除は隣接行のボタンに `onMouseEnter={() => clear()}`）。

### 横幅いっぱいの `<button>` オーバーレイはクリックで横スクロールが飛ぶ
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

横スクロール領域内に「トラック幅いっぱいの透明 `<button>`」（ガントのバー行クリック領域など）を置くと、**クリック時にフォーカスが移り、ブラウザがその幅広要素を可視域へスクロールして横スクロール位置が飛ぶ**。対処: `onMouseDown={(e) => e.preventDefault()}` でクリック時のフォーカス移動だけ抑止する（`onClick` は発火し続け、Tab キーでのフォーカスも残る＝ a11y を壊さない）。`tabIndex={-1}` では解決しない（クリックフォーカスは残る）。

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
<!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->

**スケルトン内のインタラクティブ要素に `inert` を使う**: `pointer-events-none` + `aria-hidden` だけではキーボードフォーカスが通り抜けてしまう。React 19 では `inert` を boolean prop として使える:
```tsx
<div className="pointer-events-none" aria-hidden="true" inert>
  {/* フォーム・ボタン等のスケルトン */}
</div>
```
`inert` はポインタ・キーボード・AT の全アクセスを遮断する。`pointer-events-none` と `aria-hidden` は冗長になるが意図を明示するため残してよい。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

**`aria-live` をインタラクティブ要素（`<button>` 等）の内部に置いてはいけない**: AT がインタラクティブ要素内の live region を正しく処理しないことがある。コピー完了通知やフォーム送信結果などは、ボタンの**外側**に `sr-only` span を置き、そちらでアナウンスする。
```tsx
// ❌ ボタン内の aria-live は AT が無視することがある
<button onClick={handleCopy}>
  <span aria-live="polite">{copied ? "コピーしました" : ""}</span>
  コピー
</button>

// ✅ ボタン外の sr-only span でアナウンス
<span role="status" aria-live="polite" className="sr-only">
  {copied ? "クリップボードにコピーしました" : ""}
</span>
<button onClick={handleCopy}>コピー</button>
```
<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

**動的ステップリスト全体を live region に入れない**: `role="status"` をリストコンテナに付けると AT がリスト変化のたびに全ステップを読み上げようとする。現在実行中のステップのみを `sr-only` span でアナウンスする:
```tsx
{/* sr-only span だけが live region — リストコンテナには付けない */}
<span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
  {steps.find((s) => s.status === "running")?.label
    ? `${steps.find((s) => s.status === "running")?.label} を処理中`
    : ""}
</span>
<div className="border border-border">{/* ← role="status" は付けない */}
  {steps.map(step => <StepRow key={step.id} step={step} />)}
</div>
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## その他の ARIA パターン

- **`<main>` は1ページに1つ**: AppLayout がすでに `<main>` を持つ場合、ページコンポーネントでは `<section aria-label="...">` を使う
- **`<a>` 内に `<button>` は HTML 仕様違反**: `<Link><Button>` ネストは不可。`asChild` パターン（`<Button asChild><Link>...</Link></Button>`）か `variant="link"` で解決
- **Radix `PopoverTrigger asChild` + `Button` の内部にインタラクティブ要素を置くと `<button>` inside `<button>` になる**: `PopoverTrigger asChild` は children を button としてレンダリングするため、内部に chips の削除ボタン等を置くと HTML 仕様違反になり Next.js が hydration エラーを報告する。対処: 内部のインタラクティブ要素は `<button>` ではなく `<span role="button" tabIndex={0} onKeyDown={...}>` で実装する。
  ```tsx
  // ❌ button > button — hydration error
  <PopoverTrigger asChild>
    <Button>
      <button onClick={handleUnselect}>✕</button>  {/* 内側の <button> が違反 */}
    </Button>
  </PopoverTrigger>

  // ✅ span role="button" で代替
  <PopoverTrigger asChild>
    <Button>
      <span role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); handleUnselect(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleUnselect(); } }}>✕</span>
    </Button>
  </PopoverTrigger>
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
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
- **`aria-required` は `radiogroup` に付けられない**: WAI-ARIA 1.2 の `radiogroup` ロールの許可属性に `aria-required` は含まれない。「このフィールドは必須」を伝えたい場合は各 `<input type="radio">` に `required` 属性を付けるか、ブラウザの form バリデーションに任せる。Biome はこれを静的に検出しないことがあるが、AT（スクリーンリーダー）は無視するため実害も伝達もない — ならば付けない方が正確。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **ネイティブ `<button disabled>` に `aria-disabled` を重複させない**: `disabled` 属性があれば AT は自動的に「無効」と認識する。`aria-disabled` を追加すると二重アナウンスになるスクリーンリーダーが存在する。`aria-disabled` が必要なのは `disabled` を付けずにフォーカスを保持したいとき（e.g. フォーカスリングを残してユーザーにエラーを気づかせる UX）のみ。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **WCAG SC 2.5.3 (Label in Name): `aria-label` は可視テキストを包含しなければならない**: `aria-label` が AT のアクセシブル名を上書きするため、音声操作ユーザーが可視テキストを読んでコマンドを発話しても一致しない。fix パターン: (a) `aria-label` を削除して可視テキストそのままをアクセシブル名にする、(b) 可視テキストを完全に含む文字列に `aria-label` を変更する。例: ボタン内テキスト「ドラッグ&ドロップ または クリックして選択」に対して `aria-label="ファイルをドラッグアンドドロップ、またはクリックして選択"` → 違反。解決策 (a): `aria-label` を削除するだけ。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **Biome `useSemanticElements` が `role="radio"` on `<button>` を拒否**: 単一選択グループをボタン＋`role="radio"` で実装すると Biome がエラー。ネイティブの `<input type="radio" className="sr-only">` を `<label>` で包み、ラベル要素にカード状のスタイルを適用する。これで Biome・a11y・キーボード操作すべてが正しく動く。`aria-pressed` はボタンのトグル（複数選択を示唆）なので単一選択に使ってはいけない。
  ```tsx
  <label className={cn("flex-1 border px-3 py-2.5 cursor-pointer", isSelected ? "border-primary bg-primary" : "border-border")}>
    <input type="radio" name="group-name" value={opt.value} checked={isSelected}
      onChange={() => onSelect(opt.value)} className="sr-only" />
    {opt.label}
  </label>
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **`<section aria-label>` を `<div>` に変えるとランドマーク情報が消える**: `<section>` は暗黙的に `role="region"` を持つためスクリーンリーダーがランドマークとして認識する。`<div>` に変更すると `aria-label` が残っていても機能しない（plain `<div>` に `aria-label` を付けても AT は無視する）。`<div>` に移行する場合は `role="region" aria-label="..."` を明示すること。逆に「ランドマーク過剰」と感じるなら `<section>` ごと削除し `aria-label` も削除するのが一貫している。**判断基準**: 独立した機能単位（フォームエリア・ユーザーセクション等）は `<section>` または `<div role="region">` でランドマーク化する。装飾的グルーピングにはランドマーク不要。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **カスタムダイアログ（`<dialog>` / Radix UI 非使用）はフォーカス管理を手動で行う**: ネイティブ `<dialog>` や Radix `Dialog` を使わないカスタムオーバーレイは開時のフォーカス移動・Escape キーを自前で実装する。`tabIndex={-1}` を付けた内側コンテナに `useRef` でフォーカスを当て (`dialogRef.current?.focus()`)、外側コンテナに `onKeyDown` で Escape を捕捉する。
  ```tsx
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) dialogRef.current?.focus(); }, [open]);

  <div role="dialog" aria-modal="true" aria-labelledby="title-id"
    onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
    <div ref={dialogRef} tabIndex={-1} className="... focus:outline-none">
      ...
    </div>
  </div>
  ```
  `focus:outline-none` を忘れるとフォーカスリングが意図しない場所に出る。Radix/headlessui が使えるならそちらが正解（フォーカストラップも含む）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **ランドマーク設計は LLM レビュアー間で判断が揺れやすい**: `<section>` vs `role="region"` vs `<div>` の選択は複数の正当な答えが存在し、レビュアーラウンドをまたいで「追加→削除→再追加」という矛盾が起きうる。実装時点で確認する基準: そのエリアがページナビゲーション目的で独立したセクションなら `<section aria-label>`（AT がランドマークとして提示する）、UI グルーピング目的のみなら `<div>`（ランドマーク不要）。曖昧なら `<section>` にしておく方が過剰でも安全。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **可視の警告テキストがある場合、`aria-label` に副作用テキストを重複させるより `aria-describedby` で参照する**: ボタンの隣に「この操作は〇〇をリセットします」という visible な警告段落がある場合、`aria-label="差し替える（〇〇がリセットされます）"` のように副作用テキストを aria-label に詰め込むのは WCAG anti-pattern。スクリーンリーダーが label と可視テキストを両方読み上げ、情報が重複する（二度読み）。対処: 警告段落に `id="warning-id"` を付け、ボタンに `aria-label="<動詞>"` + `aria-describedby="warning-id"` を設定する。label は短いアクション名・describedby は可視の補足テキストを参照する形が WCAG の推奨パターン。
  ```tsx
  <p id="replace-warning">操作の効果説明（可視テキスト）</p>
  <Button aria-label="差し替える" aria-describedby="replace-warning">差し替える</Button>
  ```
  実例: issue 224 の差し替えボタンで長い aria-label から `aria-describedby="replace-warning"` パターンに修正（PR #180 Round 2 quality reviewer 指摘）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
