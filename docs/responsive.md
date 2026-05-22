# Responsive Design レビュー観点

Tailwind CSS（mobile-first）を前提とした実装・レビュー観点。

---

## 基本原則

**Mobile-first**: プレフィックスなしのスタイルは全幅に適用される。大きい画面向けの上書きだけをブレークポイント付きで書く。

```tsx
// 正: モバイル基底 → lg で上書き
<div className="p-4 lg:p-8">

// 誤: デスクトップスタイルを基底にしてしまっている（hidden で消す必要が生じる）
<div className="p-8">
```

---

## ブレークポイント戦略

| Tailwind 接頭辞 | 幅 | 典型ユースケース |
|---|---|---|
| なし | 全幅（モバイル基底） | デフォルトスタイル |
| `sm:` | ≥640px | タブレット縦・スマートフォン横 |
| `lg:` | ≥1024px | デスクトップ（BtoB の主要ターゲット） |
| `md:` `xl:` `2xl:` | — | 特別な理由がある場合のみ |

**1プロパティあたり最大2段階**。`sm:md:lg:xl:` の4段階チェーンは可読性が崩壊するため禁止。

```tsx
// 良い: 2段階
className="text-sm lg:text-base"

// 悪い: 4段階（過剰）
className="text-xs sm:text-sm md:text-base lg:text-lg"
```

---

## レイアウトパターン

### サイドバー

`lg:` を境界にして切り替える。

```tsx
{/* デスクトップ: 固定表示 */}
<div className="hidden lg:block">{sidebar}</div>

{/* モバイル: ヘッダーバー + Drawer */}
<div className="flex items-center lg:hidden px-4 py-3 border-b">
  <button aria-label="メニューを開く" onClick={() => setOpen(true)}>
    <Menu className="size-5" aria-hidden="true" />
  </button>
</div>
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent side="left">{sidebar}</SheetContent>
</Sheet>
```

`lg:hidden` / `hidden lg:block` のペアを確認する。片方だけ書いて両方表示・両方非表示になるミスが頻発する。

### グリッド

```tsx
// 機能カード・ダッシュボード（3列）
grid-cols-1 sm:grid-cols-2 lg:grid-cols-3

// フォームフィールド（2列）
grid-cols-1 lg:grid-cols-2

// フォーム本体（1列固定でよい）
max-w-lg   ← グリッド不要
```

### テーブル

テーブルは `min-w-full` を維持したまま `overflow-x-auto` でラップする。縮小させない。

```tsx
<div className="overflow-x-auto">
  <table className="min-w-full">...</table>
</div>
```

---

## タイポグラフィ

ページタイトル（`h1`）のみスケールを変える。本文・ラベルは変更不要。

```tsx
<h1 className="text-2xl lg:text-4xl font-black">...</h1>
```

`text-3xl` 以上を無条件に使っているものはレスポンシブ対応漏れを疑う。

---

## タッチターゲット

タップ可能な要素は最小 **44×44px**（Tailwind: `min-h-11` = 44px）を確保する。

```tsx
// ボタン: デスクトップは 36px、モバイルは 44px
<button className="min-h-11 lg:min-h-9 px-4">...</button>

// ナビリンク: 縦パディングで高さを稼ぐ
<Link className="py-3 lg:py-2 px-3">...</Link>
```

`py-1` `py-0.5` 等の極小パディングがインタラクティブ要素に付いていたら指摘する。

---

## よくある実装ミス

| ミス | 正しい修正 |
|---|---|
| `p-8` 固定 | `p-4 lg:p-8` |
| `grid-cols-3` 固定 | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| `text-4xl` 固定 | `text-2xl lg:text-4xl` |
| `w-60` のサイドバーが常時表示 | `hidden lg:block` でラップ |
| テーブルに `overflow-x-auto` なし | `<div className="overflow-x-auto">` でラップ |
| `flex` + 固定幅の組み合わせ | `flex-1 min-w-0` で overflow を防ぐ |

---

## PDF 印刷対応（Tailwind `print:` バリアント）

AppLayout が `overflow-hidden h-screen` を使っている場合、PDF 印刷時にコンテンツが切れる。`print:` バリアントで印刷レイアウトを別途定義する。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

```tsx
// AppLayout コンテナ: print 時は高さ制限・overflow を解除
<div className="h-screen overflow-hidden print:block print:h-auto print:overflow-visible">

// サイドバー: 印刷不要なナビゲーション要素を非表示
<aside className="lg:block print:hidden">

// スクロール可能なコンテンツ領域: overflow を解除して全コンテンツを表示
<div className="overflow-y-auto h-full print:overflow-visible print:h-auto">
```

**チェックポイント**: `overflow-hidden` / `overflow-y-auto` / `h-screen` / `h-full` を使っているコンテナが print 時にも同様の制約を持ち続けないか確認する。

---

## Tailwind spacing Gotchas

- **`space-y-*` の隣接値変更は視覚的に判別しにくい**: `space-y-6 → space-y-8`（24px → 32px）は差分が 8px しかなく画面上で気づきにくい。特定 sibling 間だけ余白を増やしたい場合は、対象要素に直接 `mb-*` や `mt-*` を付ける方が意図が明確で視覚的にも判別しやすい。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`p-0 m-0` の fieldset と親の `space-y-*` は競合しない**: `m-0` は fieldset 自身のマージンをゼロにするだけで、親の `space-y-*` が次 sibling に付ける `margin-top` には影響しない。ただし `p-0` と同じ要素に `pb-*` を追加する場合、Tailwind の CSS 出力順によっては `p-0` が上書きする可能性がある。安全策: `p-0` を `pt-0` に分解してから `pb-*` を追加する。
  <!-- importance: low | mentions: 1 | first-seen: 2026-05 -->

---

## レビューチェックリスト

UI を含む変更差分を見るときは以下を確認する:

- [ ] グリッドにブレークポイントがあるか（`grid-cols-*` 固定ではないか）
- [ ] ページタイトルが responsive か（`text-2xl lg:text-4xl` 等）
- [ ] パディング・マージンがモバイル考慮されているか
- [ ] サイドバー系の変更で `hidden lg:block` / `lg:hidden` が適切か
- [ ] テーブルに `overflow-x-auto` があるか
- [ ] タッチターゲットが `min-h-11` 以上か（インタラクティブ要素）
- [ ] `lg:hidden` と `hidden lg:block` のペアが揃っているか
- [ ] PDF 出力が必要なページで `print:` バリアントが必要か
