# Anthropic API — Gotchas と制約

> **TL;DR**: Anthropic API の制約と落とし穴。構造化出力で `oneOf`（Valibot `v.variant`）は非対応 → フラット構造に畳んで後段で判別。`cache_control` ブレークポイントは 1 リクエスト最大 4 件 → `system` のみ `cachedText` を使い `message` は plain `text` のまま toolRunner に委ねる。

## Constrained Decoding（構造化出力）

### `oneOf` は非対応

Anthropic の `output_config.format.schema` は JSON Schema の `oneOf` をサポートしない。
Valibot の `v.variant(...)` は内部で `oneOf` を生成するため、これを `resultSchema` に
渡すと 400 エラーになる。

```
error: 400 {"type":"error","error":{"type":"invalid_request_error",
"message":"output_config.format.schema: Schema type 'oneOf' is not supported"}}
```

**対処**: 判別 union を使いたい場合は、フラットな構造（判別フィールドごとに別の
オプション配列を並べるなど）に畳み、後段のコードで判別する。

```typescript
// NG: v.variant → oneOf → 400
const schema = v.strictObject({
  services: v.array(v.variant('type', [FooSchema, BarSchema])),
});

// OK: フラット構造にして後段で判別
const schema = v.strictObject({
  foo_items: v.array(FooItemSchema),  // 存在しないとき空配列
  bar_items: v.array(BarItemSchema),
});
```
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

## プロンプトキャッシュ（cache_control）

### 1 リクエストあたりキャッシュブレークポイントは最大 4 件

`system` ブロックと `messages` ブロックを合算して 4 件まで。`ai.toolRunner` は
tool-use ループの各ターンで末尾 message に自動で cache_control を付与するため、
呼び出し側で `cachedText` を多用するとすぐに上限を超える。

```
error: 400 {"error":{"message":"A maximum of 4 blocks with cache_control may be provided. Found 5."}}
```

**対処**: `system` にのみ `cachedText` を使い、`message` は `text` のまま toolRunner の
自動付与に委ねる。`message` を `cachedText` にしたい場合は `system` の `cachedText`
ブロック数と合算して 4 以内に収める。

```typescript
// NG: system(1) + message(2) + toolRunner auto(1以上) で超過しやすい
system: [cachedText(SYSTEM)],
message: [cachedText(MSG1), cachedText(MSG2)],

// OK: system のみ cachedText、message は text
system: [cachedText(SYSTEM)],
message: [text(MSG1), text(MSG2)],
```
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
