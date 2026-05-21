# Tailwind + CVA パターン集

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
