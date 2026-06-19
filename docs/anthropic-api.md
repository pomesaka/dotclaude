# Anthropic API — Gotchas と制約

> **TL;DR**: Anthropic API の制約と落とし穴。構造化出力で `oneOf`（Valibot `v.variant`）は非対応 → フラット構造に畳んで後段で判別。`cache_control` ブレークポイントは 1 リクエスト最大 4 件 → `system` のみ `cachedText` を使い `message` は plain `text` のまま toolRunner に委ねる。PDF + structured output で vision を使うには **画像ラスタライズ経路に正規化する必要あり**（`application/pdf` の file part は text-extraction-only モード／citations は structured output と非互換／pdfium WASM は CJK サイレント脱落 → `pdf-to-img` / pdfjs-dist を使う）。

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

## PDF 入力で Vision を使う

### `application/pdf` の file part は **text-extraction-only モード**（citations 無効時）

Bedrock Converse（`@ai-sdk/amazon-bedrock` 経由含む）で `application/pdf` を file part として渡すと、citations を有効化しない限り [text-extraction-only モードに落ちる](https://platform.claude.com/docs/en/build-with-claude/pdf-support)。テキスト層からの抽出だけが行われ、ページ画像はモデルに渡らない。

実害: 日本語高密度の請求書・伝票・スキャン PDF で商品名（漢字）が**サイレントに `商品1`/`商品2` 等のプレースホルダになる**。エラーは出ず構造化出力の `name` フィールドが埋まるため、下流の照合まで気付けない。

```typescript
// NG: vision が効かず CJK 高密度ページで name がプレースホルダ化
await agent.run({ data: pdfBase64, mediaType: 'application/pdf' });
```

### citations は **structured output と公式非互換**

「じゃあ citations を有効化すれば？」は使えない。Anthropic 公式が [Citations docs](https://platform.claude.com/docs/en/build-with-claude/citations) で `"Citations and Structured Outputs are incompatible"` と明言している。`runAgentObject` / Constrained Decoding（forced tool use）と citations は同時に使えない。

**対処**: structured output を保ったまま vision を効かせる経路は「**全ページを画像にラスタライズして image file part として渡す**」のみ。

```typescript
// OK: PDF を全ページ PNG 化し、image/png file part で渡す
const pages = await rasterizePdfPagesToPng(pdfBase64, 3); // scale=3
await agent.run({ data: pages[0], mediaType: 'image/png' });
```

スケールは Claude vision の長辺 ~1568px に対し「源画像は target より大きく与える」のがセオリー（公式 [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision) "Ensure text is clear and legible"）。A4 landscape (841×595pt) を scale=3 で 2523×1785px にすると、CJK 13 列伝票の商品名が判読可能。scale=2 では文字エッジが潰れる。
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

### PDF→画像ラスタライザは pdfjs 系（CMap bundle 付き）を使う — `@hyzyla/pdfium` の WASM は CJK サイレント脱落

PDF を画像化するラスタライザの選定で罠を踏みやすい。**`@hyzyla/pdfium` の WASM ビルドは日本語 subset Type0/CIDFont をサイレントに描画スキップする**（pdfium WASM が標準 CJK フォントへのフォールバックを持たないため）。生成 PNG では数字・Latin は出るが、商品名・vendor 名・「請求書」タイトル等 CJK が全抜けする。エラーは出ない。

`pdf-to-img` (pdfjs-dist ラッパー) は CMap data を bundle しており標準 CIDFont を解決できる。実機検証 (2026-06-19) で日本語請求書 PDF の漢字が全て描画されることを確認した。

```typescript
// NG: @hyzyla/pdfium WASM は CJK を描画しない（エラーは出ない）
import { PDFiumLibrary } from '@hyzyla/pdfium';

// OK: pdf-to-img (pdfjs-dist) は CMap bundle で CJK 解決
import { pdf as pdfToImg } from 'pdf-to-img';
const document = await pdfToImg(buffer, { scale: 3 });
for await (const pageBuffer of document) { /* PNG buffer */ }
```

**デバッグ姿勢の教訓**: 生成画像が「想定と違って見える」（CJK が抜けている・縦書きが崩れている等）とき、**原データを疑う前にレンダラを疑う**。「元 PDF に商品名列が無いのでは？」と原データ側に仮説を伸ばすと診断が逸れる。原 PDF を別ツール（ブラウザ・Preview.app）で開いて目視確認するのが最短ルート。
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
