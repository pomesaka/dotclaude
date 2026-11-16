# Anthropic API で踏んだ罠

> **TL;DR**: Anthropic API を使うアプリで実際に踏んだ罠（構造化出力の `oneOf`、`cache_control` の上限、PDF を vision で読ませる経路）。API の仕様そのものは、Claude Code 同梱の `claude-api` スキルで確かめる。

整理する前の版は `archive/2026-11-16/docs/anthropic-api.md` にある。コードの例に出る `ai.toolRunner`、`cachedText`、`runAgentObject`、`agent.run`、`rasterizePdfPagesToPng` は、ある案件の社内ラッパーの名前で、公式 SDK のものではない。

## 構造化出力: `oneOf` は非対応
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

`output_config.format.schema` は JSON Schema の `oneOf` を受けない。Valibot の `v.variant(...)` は内部で `oneOf` を生成するため、スキーマに渡すと 400 になる。

```
error: 400 {"type":"error","error":{"type":"invalid_request_error",
"message":"output_config.format.schema: Schema type 'oneOf' is not supported"}}
```

判別 union を使いたい場合は、フラットな構造に畳み、後段のコードで判別する。

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

`claude-api` スキルの対応一覧（2026-11-16 に確認）には `anyOf` がある。Valibot から `anyOf` で出せるかは試していない。

## プロンプトキャッシュ: `cache_control` のブレークポイントは 1 リクエストに最大 4 件
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

`system` ブロックと `messages` ブロックを合算して 4 件まで。案件のラッパー `ai.toolRunner` は、tool-use ループの各ターンで末尾の message に `cache_control` を自動で付けるため、呼び出し側で `cachedText`（`cache_control` を付けた text ブロック）を多用すると上限を超える。

```
error: 400 {"error":{"message":"A maximum of 4 blocks with cache_control may be provided. Found 5."}}
```

`system` にだけ `cachedText` を使い、`message` は `text` のままにして自動の付与に任せる。`message` を `cachedText` にするなら、`system` の分と合わせて 4 以内に収める。

## PDF を vision で読ませる
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

Bedrock Converse（`@ai-sdk/amazon-bedrock` 経由を含む）で `application/pdf` を file part として渡すと、citations を有効にしない限り [text-extraction-only モードになる](https://platform.claude.com/docs/en/build-with-claude/pdf-support)。テキスト層からの抽出だけが行われ、ページの画像はモデルに渡らない。日本語が詰まった請求書・伝票・スキャン PDF では、商品名（漢字）が `商品1`/`商品2` のようなプレースホルダになる。エラーは出ず、構造化出力の `name` は埋まるので、下流の照合まで気づけない。

citations を有効にする手は使えない。[Citations docs](https://platform.claude.com/docs/en/build-with-claude/citations) が `"Citations and Structured Outputs are incompatible"` と明言している。

構造化出力を保ったまま vision を効かせるには、全ページを画像にラスタライズして `image/png` の file part で渡す。

```typescript
const pages = await rasterizePdfPagesToPng(pdfBase64, 3); // scale=3
await agent.run({ data: pages[0], mediaType: 'image/png' });
```

Opus 4.7 以降と Sonnet 5 以降は、長辺 2576px までの画像を受ける（`claude-api` スキルの `shared/model-migration.md` で 2026-11-16 に確認。それより前のモデルは 1568px）。A4 landscape (841×595pt) を scale=3 にすると 2523×1785px で、CJK 13 列の伝票の商品名が読めた。scale=2 では文字のエッジが潰れた（2026-06 に、当時のモデルで確認）。

## PDF→画像のラスタライザは pdfjs 系（CMap bundle 付き）を使う
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

`@hyzyla/pdfium` の WASM ビルドは、日本語 subset の Type0/CIDFont をエラーを出さずに描画しない（標準 CJK フォントへのフォールバックを持たないため）。生成した PNG には数字と Latin は出るが、商品名・vendor 名・「請求書」のタイトルなどの CJK が全部抜ける。

`pdf-to-img`（pdfjs-dist のラッパー）は CMap data を bundle していて、標準の CIDFont を解決できる。日本語の請求書 PDF の漢字が全部描画されることを確かめた（2026-06-19）。

```typescript
import { pdf as pdfToImg } from 'pdf-to-img';
const document = await pdfToImg(buffer, { scale: 3 });
for await (const pageBuffer of document) { /* PNG buffer */ }
```

生成した画像が想定と違って見えたら、元のデータより先にレンダラを疑い、元の PDF を別のツール（ブラウザ、Preview.app）で開いて見る。
