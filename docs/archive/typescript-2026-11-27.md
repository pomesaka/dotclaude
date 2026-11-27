# typescript.md から退避した項目（2026-11-27）

`typescript.md`を整理したときに、文書から消えた元の文を置く。いま有効な規則は`../typescript.md`にある。

## 1. regexp-global-lastindex

残した原則: なし。JavaScriptの一般的な知識として消した。

- **`g`フラグ付きのRegExpをモジュールの定数にして`exec()`や`test()`で使うと、`lastIndex`が呼び出しをまたいで残り、2回目から結果がずれる**。毎回新しいRegExpを返す関数にする。`replace()`と`matchAll()`は定数のままでよい（node 22で確認）。
