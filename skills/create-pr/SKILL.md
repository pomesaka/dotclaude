---
name: create-pr
description: jj + gh を使って新しい PR を作成する。
when_to_use: 「PRを作って」「プルリクを出して」「push して PR を作成して」と言われたとき。既存 PR の更新は update-pr を使う。
disable-model-invocation: false
argument-hint: "[base-branch]"
allowed-tools: Bash(jj *), Bash(gh *), Bash(task *), Bash(bun *), Read, Glob
model: haiku
---

# Create Pull Request

baseブランチに向けてPRを作成する。baseブランチは `$ARGUMENTS` で指定、未指定時は `main`。
`jj diffu` は git diff形式でdiffを表示するカスタムコマンド（`jj diff` と同じオプション）。

## 手順

### 1. ログ確認・description設定

```bash
jj log --limit 5
```

現在のリビジョン（`@`）の description が空（`(no description set)`）の場合、PR作成前に設定する:

1. `jj diffu` で変更内容を確認
2. 会話ヒストリーからWHY（動機・設計判断の理由）を収集
3. `jj desc -m '...'` で description を設定（`/jjdesc` スキルと同じフォーマット）

description が既に設定されている場合はスキップ。

### 2. base branchとのdiffを確認

```bash
jj diffu -r '<base branch>..@'
```

### 3. WHYを会話ヒストリーから収集

**最重要。** diffからはWHAT/HOWしか読み取れない。WHY（なぜ変えたか）は会話ヒストリーにしかない。
以下を特定する:

- **課題・動機**: 何を解決しようとしていたか
- **設計判断の理由**: なぜこのアプローチか、却下した代替案とその理由
- **背景情報**: バグの根本原因、制約、要件
- **アウトカム**: このPRがマージされたら何ができるようになるか（ユーザー目線 / 開発者目線）。「結局これマージしたら何できるんだっけ？」に1行で答えられるレベル

### 4. ブックマーク作成・プッシュ

`--named <name>=@` を使う。bookmark create + track + push を1コマンドで行い、新規ブックマークの tracking エラーを回避できる。

```bash
jj git push --named <name>=@
```

### 5. 動作検証

PR作成前に変更の正しさを確認する:

- ビルド・型チェック
- Linter/Formatter
- 必要に応じてテスト

検証コマンドはプロジェクトの `CLAUDE.md` や `package.json` を参照して判断する。
失敗した場合はPR作成前に修正すること。

### 6. PR作成

PRボディの「動作検証」セクションには、レビュアーが**手元で再現・確認できる具体的な手順**を書く。

**動作検証の書き方:**

- **前提条件**: 環境変数・外部サービスの設定手順（具体的に）
- **セットアップ**: 準備コマンド
- **静的検証**: 型チェック・lint等のコマンドと期待結果
- **動作確認**: ステップバイステップで「何をしたら何が起きるか」
- **確認ポイント**: 正常系・エラー系で何を確認すべきか

抽象的な記述（「動作確認する」）ではなく、コピペで再現できるレベルの具体性。

**`gh pr create` が stdout に出力するURLが正しいPRのURL。**
`jj git push` が出力する `pull/new/...` URLは使わないこと。

```bash
PR_URL=$(gh pr create --base <base branch> --head <name> --title '適切なタイトル' --body "$(cat <<'EOF'
issue: #<番号>（PR が解決する issue。無ければ「なし（経緯を1行で）」）
related: #<番号>, #<番号>（参考になる関連 issue / PR。無ければ省略可）

## 背景・動機
なぜこの変更が必要だったか。課題や問題の説明。

## 概要
何をしたか・なぜそのアプローチを選んだか。設計に触れる場合は概念レベルに止める（ファイル名・関数名の列挙は diff を見れば分かるので書かない）。

## アウトカム
このPRがマージされると何ができるようになるか。時間が経って見返したときに「結局何ができるんだっけ」が一目で分かるように書く。

- **ユーザー目線**: 利用者から見て何が変わるか（できなかったことができる / 操作が変わる / 表示が変わる）。内部向け変更でユーザー影響がないなら「影響なし（内部変更のみ）」と書く
- **開発者目線**: 後続の開発で何ができるようになるか（呼べるようになるAPI/関数、書けるようになるテスト、依存できる新しい抽象、踏める次のステップ）

## 動作検証

### 前提条件
必要な環境変数・外部サービスの設定手順

### 静的検証
```bash
コマンド   # 期待結果
```

### 動作確認手順
1. 具体的なステップ → 期待される結果

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)")
echo "$PR_URL"
```

## Gotchas

- **PR ボディの冒頭に `issue:` / `related:` を必ず載せる**: PR に直接対応する issue があれば `issue: #N`、参考になる関連 issue/PR があれば `related: #N, #M` を概要の一番上に書く。対応 issue が無い場合は `issue: なし（起点を1行で）` と明示する。理由: 数ヶ月後に PR を遡るとき、issue リンクが無いと「なぜこの変更があったか」を会話ログから掘り起こす必要があり追跡コストが高い。`gh issue view` で背景を即座に辿れる状態にする。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **`PR_URL=$(gh pr create ... --body "$(cat <<'EOF' ...)")` の heredoc 入れ子は zsh で parse error になることがある**: テンプレート通りのコマンド置換 + heredoc 入れ子が `parse error near 'PR_URL=$(gh pr creat...'` で落ちるケースがある（Claude Code の Bash ツール経由・zsh 環境で確認 2026-06-10）。対処: PR ボディを先に `cat > /tmp/pr_body.txt << 'EOF'` で一時ファイルに書き出し、`gh pr create --body "$(cat /tmp/pr_body.txt)"` の 2 段に分ける。最初から 2 段方式で書けばリトライが不要。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **実機検証のエビデンス（スクショ・録画・実行ログ）が手元にあれば PR に含める**: /verify 等で動作検証した結果のスクリーンショットが /tmp 等に残っている場合、`upload-screenshots` スキルで PR ボディの「動作検証」セクションに埋め込む。画像の下に「何を確認した画像か」の注記（観測ポイント）を添える。レビュアーが手元で再現しなくても検証結果を確認できる状態にするのが目的。テキストの検証結果（レスポンスボディ・カウント等）も同セクションに書く。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
