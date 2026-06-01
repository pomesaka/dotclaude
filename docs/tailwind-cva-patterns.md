# Tailwind + CVA パターン集

> **TL;DR**: Tailwind v4 では `bg-*` クラス競合に注意（`[&.active]:bg-X` で回避）。`dark:` クラスはデザイントークン設計ミスのシグナル — `dark:` が必要な場面では `--muted`・`--warning` 等のセマンティックトークンに切り替える。アクション用トークン（`--primary`）はレイアウト背景に転用しない。

## bg クラス競合回避（Tailwind v4）

### 問題

Tailwind v4 では、同一要素に `bg-A` と `bg-B` が両方存在するとき、どちらが勝つかは **HTML クラス属性の順序ではなく生成 CSS のソース順** で決まる。

CVA で `theme` バリアントに `bg-primary` を持たせ、compound variant で `bg-transparent` を上書きしようとしても、ビルド後の CSS で `bg-primary` が後に定義されていれば `bg-transparent` が無効になる。

実際の症状: `variant="outline" theme="destructive"` のボタンに薄い赤背景（`bg-destructive` が残る）が見えた。

### 解決策

**`bg-{color}` を `theme` バリアントに直接置かない。**  
代わりに `{variant: "default", theme: "primary"}` のような compound variant に移す。こうすることで、`variant="outline"` との組み合わせでは compound variant が発火せず、背景色クラスが存在しない状態になる。

```ts
// ❌ Bad: theme に bg を直接持つと outline との組み合わせで競合する
theme: {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
},
compoundVariants: [
  { variant: "outline", theme: "primary", class: "bg-transparent text-primary" },
  // → bg-primary vs bg-transparent で CSS cascade 依存になる
],

// ✅ Good: bg は compound variant で variant=default 専用に限定する
theme: {
  primary: "",  // bg なし
},
compoundVariants: [
  { variant: "default", theme: "primary", class: "bg-primary text-primary-foreground hover:bg-primary-hover" },
  { variant: "outline", theme: "primary", class: "text-primary hover:bg-primary/10" },
  // → outline 時に bg-primary が存在しないため競合なし
],
```

### 適用範囲

- CVA + Tailwind v4 の組み合わせ全般
- 特に `theme` × `variant` の 2 軸で bg が変化するボタン・カードコンポーネント

<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

---

## compound variant の `bg-transparent` 重複を避ける

`variant: "outline"` のベースクラスにすでに `bg-transparent` が含まれている場合、compound variant で `bg-transparent` を再度追加しても無意味で読み手を混乱させる。

```ts
// ❌ 重複
{ variant: "outline", theme: "destructive", class: "border-destructive text-destructive hover:bg-destructive/10 bg-transparent" }

// ✅ シンプル
{ variant: "outline", theme: "destructive", class: "border-destructive text-destructive hover:bg-destructive/10" }
```

<!-- importance: low | mentions: 1 | first-seen: 2026-05 -->

---

## `--accent` は `--muted` と視覚的に区別できる値にする

### 問題

IDE サイドバーのような `bg-muted` 背景を持つ領域に `hover:bg-accent` を使うと、`--accent` ≈ `--muted` のときホバーが視覚的に無効化される。  
Tailwind v4 ではデフォルト値として `accent` と `muted` に同じかほぼ同じ値が設定されていることがあり、**ホバーフィードバックが消える**。

### 解決策

`--accent` を `--muted` より確実に明暗が異なる値に設定する。

| モード | 原則 |
|--------|------|
| Light | `--accent` は `--muted` より暗く（より高い彩度または低い輝度） |
| Dark | `--accent` は `--muted` より明るく（輝度を高めに） |

```css
/* ✅ Light: muted=95.5%, accent=91% — 十分な差がある */
--muted: hsl(210 20% 95.5%);
--accent: hsl(210 20% 91%);

/* ✅ Dark: muted=16%, accent=23% — 明るさの差が視認できる */
--muted: hsl(222 12% 16%);
--accent: hsl(222 12% 23%);
```

### 発見のきっかけ

TreeItem の `hover:bg-accent` が IDE サイドバー（`bg-muted` 背景）上で消えていた。`--accent` = `--muted` が原因で、accent を差別化することで解決。

<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

---

## `dark:` クラスはトークン設計ミスのシグナル

コンポーネント内に `dark:text-xxx`・`dark:bg-xxx` のようなクラスがある場合、それは **セマンティックトークンの設計失敗**を意味する。

### 原則

- Light/Dark の切り替えはトークン定義（`globals.css` の `@media (prefers-color-scheme: dark)` または `dark:` CSS class セレクタ）だけで完結させる
- コンポーネントは常にセマンティックトークン（`text-destructive`、`bg-accent` 等）を参照するだけでよく、モードを意識しない
- `dark:text-blue-300` のようなパレット直書きがあれば、そのトークン（例: `--info`）の Dark 値が不適切な証拠

### 典型的な誤り

```tsx
// ❌ トークンの Dark 値が足りないため component で補っている
<span className="text-teal-600 dark:text-teal-300">typename</span>
<button className="bg-destructive dark:font-bold">削除</button>

// ✅ Dark 値をトークン側で調整し、component は semantic token のみ
<span className="text-graphql-typename">typename</span>  // globals.css で Dark 値を定義済み
<button className="bg-destructive font-semibold">削除</button>  // --destructive lightness を Dark で引き上げ
```

### 対処フロー

1. `dark:` クラスを見つけたら「このトークンの Dark 値が低コントラストなのでは？」と疑う
2. `globals.css` の Dark セクションでそのトークンの lightness / saturation を調整する
3. `dark:` クラスを削除し、component が single semantic token だけを参照するよう戻す

<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

---

## アクション用トークンをレイアウト背景に転用しない

`--secondary` / `--primary` / `--destructive` はボタン等の **操作要素用**トークン。テーブルヘッダー・セクション区切り・IDE ツールバーなど **構造的なレイアウト背景**に使ってはいけない。

```tsx
// ❌ secondary はボタン背景用トークン — レイアウトに使うとセマンティクスがずれる
<TableRow className="bg-secondary">
<div className="bg-secondary">Section header</div>

// ✅ 補助的な背景には bg-muted を使う
<TableRow className="bg-muted">
<div className="bg-muted">Section header</div>
```

**判断基準**: 「ここにボタンを置いても違和感がないか？」— Yes なら action token でよい。No ならレイアウトトークン（`muted`・`card`・`background`）を選ぶ。

<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

---

## CSS Grid 固定幅列に `size="icon"` Button を置くとオーバーフロー

`size="icon"` は `h-9 w-9`（36×36px）に展開される。列幅が 16px や 24px の grid に入れると要素が大幅にはみ出し、隣の列を押しのける。`padding` の調整だけでは直らない（ボタン自体が 36px）。

対処: `size` prop を使わず `className="size-X p-0"` で列幅に合わせたサイズを直接指定する。

```tsx
// ❌ grid-cols-[16px_...] の中に size="icon" (=w-9=36px) → 20px オーバーフロー
<SortableDragHandle size="icon" className="p-1">
  <GripIcon />
</SortableDragHandle>

// ✅ 列幅に合わせた size-4 (=16px) を直接指定
<SortableDragHandle className="size-4 p-0">
  <GripIcon className="size-4" />
</SortableDragHandle>
```

**判断基準**: グリッド列幅 < 36px ならば `size="icon"` は禁止。列幅 === `size` の値を直接 `className` で指定する。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

---

## 背景を「濃く」したいとき `bg-X/N` の opacity を下げると逆効果

### 問題

白背景上で `bg-muted/90` は `bg-muted`（不透明）より**明るく（薄く）**なる。opacity modifier は白が透けるため、下げるほど白に近づく。

「もう少し濃くしたい」つもりで `/80` → `/60` とすると期待と逆に薄くなる。

### 解決策

背景を濃くしたいなら、**より暗いトークンに切り替える**。opacity は下げない。

```tsx
// ❌ 逆効果: bg-muted/80 は bg-muted より薄い（白が透ける）
<TableRow className="even:bg-muted/80" />

// ✅ bg-accent は bg-muted より暗いトークン
<TableRow className="even:bg-accent" />

// ✅ 中間が欲しいなら bg-accent に opacity を載せる
<TableRow className="even:bg-accent/50" />
```

<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
