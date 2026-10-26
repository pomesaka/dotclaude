# PRにしてマージする

担当のセッションが変更を仕上げたら、PMがPRにする。PMは自分のjjワークスペースから操作する。

## 手順

1. `jj git fetch`
2. 変更が担当の作業コピー（`@`）かを見る

   ```
   jj log -r <変更> --no-graph -T 'commit_id.short(8) ++ " " ++ if(conflict, "conflict", "ok") ++ " " ++ working_copies ++ "\n"'
   ```

3. 担当の作業コピーでなければ、`main`に載せ直して衝突を見る。`jj rebase -r <変更> -d main@origin`（列なら`-s`）
   - 作業コピーなら載せ直さない。GitHubのrebaseのマージに任せ、本文に「どの`main`の上で検査したか」を書く
4. 衝突したら、自分の作業コピーを`jj new <変更>`で載せて直し、`jj squash`で入れる。直したら`jj new main@origin`で外へ出る
5. `jj bookmark create <種類>/<内容> -r <変更>`、`jj git push -b <ブックマーク> --allow-new`
6. `gh pr create --base main --head <ブックマーク> --title … --body …`
7. `bash ${CLAUDE_SKILL_DIR}/scripts/wait-checks.sh <リポジトリ> <PR番号>`を裏で走らせる
8. 終わりの通知が来たら、`gh pr view <N> --json mergeable`を見て、`gh pr merge <N> --rebase --delete-branch`

本文には、何を直したか、なぜか、どう確かめたか（検査、照合の件数、レビューの回数と指摘の片付け方）を書く。照合が落ちた組があれば、その組の名前と、変更と関係ないと言える理由を書く。

## ほかのワークスペースの作業コピーを動かすとき

PMが担当の変更を載せ直すと、担当の作業コピーもjjが一緒に動かす。担当が編集の最中なら、作業コピーがstaleになり、`update-stale`の後に変更IDが分岐する。

- 載せ直してよいのは、担当が「待機した」と書いた報告のあとだけ。「続けて次に入る」のあとは載せ直さない。その場合は、変更の写し（`jj duplicate`）にブックマークを付ける
- 載せ直したら、担当に`jj workspace update-stale`を頼む
- 担当の作業コピーの祖先を書き換える操作は、`jj -R <相手のワークスペース>`で相手の側から行う
- 分岐ができたら、`jj diff --from <片方> --to <もう片方> --stat`で中身が同じかを見てから、作業コピーでないほうを捨てる
- push前に`jj diff -r <変更> --stat`を見る。生成物（`target/`、`node_modules/`）を巻き込んでいないかを確かめる

## 積んだ変更

2つの変更が上下に積まれていても、PRは両方`main`に向ける。下のPRのブランチに上のPRを向けると、下を`--delete-branch`でマージしたときにGitHubが上を閉じ、向き先を戻せない。マージの条件が同じもの（どちらも同じ利用者の答えを待つ、など）は、1つのPRにまとめてもよい。
