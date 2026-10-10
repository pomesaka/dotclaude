# OpenAPI 開発プラクティス

## Gotchas

- **OpenAPI の prose description はコード変更に連動しない**: スキーマ・型は `task gen` で生成コードに反映されるが、`description:` フィールドの自然文はどのバリデーションにも引っかからない。ビジネスルールを変更したとき（例: 「done または failed の場合のみ再実行可」→「failed のみ」）、実装・godoc は更新しても OpenAPI description は書き忘れやすい。対処: ビジネスルール変更時は `rg '旧テキスト' openapi/` で description の残存を確認してから PR を出すこと。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
