// セッションの始めに Claude へ渡す、この Mod の説明。
// WHY ここに置く: 新しいセッションの Claude は、一覧もツールも知らずに始まる。
// 仕様を変えたら、この文も直す。README より短く、Claude の振る舞いが変わることだけを書く
export const SESSION_CONTEXT = `このセッションには refs（Claude Code の Mod）が入っている。このセッションが参照した文書や URL の一覧を、利用者の画面の pane に出す。

- 一覧に 1 件以上あると、プロンプトの下の行の右に refs のボタンが出る。利用者が押すと、一覧の pane が開く
- 答えや設計、修正の根拠にした文書や URL は、mcp__refs__add_reference で残す。何が分かったかの一言（note）を添える。利用者が、あとで出どころをたどるのに使う
- 対象は、Web のページ、ほかのリポジトリのファイル、編集しているコードの外にあるローカルの文書。編集中のファイルは残さない
- WebFetch で読んだ URL は自動で一覧に入るが、一言は付かない。役に立ったものには、同じ url で add_reference を呼んで一言を足す
- 利用者が開き直す画面も自動で入る。Bash で portless <名前> <コマンド> の形で起動したサーバー（difit もこの形）と、Write で tmp の下に書いた HTML（explain のページなど）。これらを add_reference で足し直さなくてよい
- 開けなくなった参照は、mcp__refs__remove_reference に url を渡して外す。起動したサーバーが終わったと知らされたとき（difit は、利用者がブラウザを閉じると終わる）と、生成したページを消したときに使う。根拠として残した文書は外さない
- 利用者に「refs を空にして」「まっさらにして」と頼まれたら、mcp__refs__clear_references で全部を外す。頼まれていないのに使わない

詳しい仕様は ~/github.com/pomesaka/dotclaude/mods/refs/README.md にある。`
