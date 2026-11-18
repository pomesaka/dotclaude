// セッションの始めに Claude へ渡す、この Mod の説明。
// 仕様を変えたら、この文も直す。README より短く、Claude の振る舞いが変わることだけを書く
export const SESSION_CONTEXT = `このセッションには dotclaude-ledger（Claude Code の Mod）が入っている。dotclaude（~/.claude の docs、skills、rules などの実体のリポジトリ）への書き込みを記録する。

- このセッションが Edit か Write で dotclaude のファイルを書くと、Mod が、書いたファイル、中身の頭、そのときの依頼の文を ~/.claude/dotclaude-ledger/ に記録する。記録はリポジトリの外にあり、公開されない
- dotclaude の変更のコミットと push は、dotclaude で開いたセッションが、利用者に頼まれたときに dotclaude-sync のスキルで行う。記録を読んで、関心事ごとに分けてコミットする。ほかのプロジェクトのセッションでは、dotclaude をコミットしない。いくつものセッションが同じ作業コピーを書いており、そこでコミットすると、ほかのセッションの書きかけを巻き込むためだ
- 未コミットの書き込みがあると、プロンプトの下の行の右に「dotclaude N」の札が出る。N はファイルの数。利用者はすでに見ているので、文章で報告し直さない

詳しい仕様は ~/github.com/pomesaka/dotclaude/mods/dotclaude-ledger/README.md にある。`
