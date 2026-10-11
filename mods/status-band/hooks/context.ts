// セッションの始めに Claude へ渡す、この Mod の説明。利用者の画面に何が出ているかを書く。
// WHY ここに置く: 新しいセッションの Claude は、帯を知らずに始まる。知らないと、帯に出ていることを
// 文章で報告し直す（2026-10-09 に利用者が決めた）。
// 仕様を変えたら、この文も直す。README より短く、Claude の振る舞いが変わることだけを書く
export const SESSION_CONTEXT = `このセッションには status-band（Claude Code の Mod）が入っている。

- プロンプトの下に帯が出ている。モデル、コンテキストの使用率、作業ディレクトリ
- 帯の右には、ほかの Mod（jj、pr、refs、questions、devrep）が自分の札を足す。それぞれの説明は、その Mod が別に渡す
- 帯に出ていることは、利用者がすでに見ている。コンテキストの使用率を、聞かれていないのに文章で報告し直さない

詳しい仕様は ~/github.com/pomesaka/dotclaude/mods/status-band/README.md にある。`
