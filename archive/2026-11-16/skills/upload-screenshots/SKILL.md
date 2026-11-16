---
name: upload-screenshots
description: スクショをPRに貼る、画像・動画をIssueやPRに添付する依頼で使う。ghの--attachで正式なGitHub添付URLへアップロードする。
metadata:
  short-description: GitHubへスクショ・動画を正式添付
---

# upload-screenshots

Claude CodeとCodexで共通の手順。GitHub CLIの `--attach` を使い、release assetやリポジトリ内画像を経由せず、画像・動画を添付する。

## 対象を確認

ユーザー指定のIssue/PRを使う。未指定なら `jj bookmark list` と `gh pr list --head <bookmark-name>` で確認する。
「PRにスクショ」は通常、既存本文を更新する。コメント投稿を指定された場合は、そのコメントへ添付する。

## 添付

`gh` 2.99.0以降が対応する。その環境の対象コマンドの `--help` に `--attach` があることを確認する。

    gh pr edit <NUMBER> --attach './home.jpg#Homeの画面'
    gh pr comment <NUMBER> --attach './home.jpg#Homeの画面'
    gh issue comment <NUMBER> --attach './demo.mp4'

- 本文を整理するならMarkdownをファイルへ保存し、`--body-file` を使う。本文の `![説明](./home.jpg)` と同じパスを `--attach` に渡すと、CLIが正式な添付URLへ置き換える。
- 画像のalt textはファイルパスの `#` 以降に指定できる。動画にはalt textを付けない。
- 対応形式はPNG/JPEG/GIF/WebP/SVG、MP4/MOV/WebM。実際のファイル形式と拡張子を一致させる。
- 現在は1コマンド50ファイルまで。画像/GIFは10MB、動画はFreeで10MB、有料プランで100MBまで。
- 一部が成功した場合、現状の本文を確認し、未成功の添付だけを再実行する。失敗した追記を新規コメント投稿へ黙って切り替えない。

## 確認と後片付け

`gh pr view <NUMBER> --json body`（Issueは `gh issue view`）で、ローカル参照がGitHub添付URLへ置き換わり、必要な枚数があることを確認する。ブラウザ確認が可能なら画像が表示されることも確認する。

正式添付後は自分が作成した一時ファイル・重複画像を整理する。ユーザーの成果物や他の作業のファイル、既存releaseを自動削除しない。

共有の正本はdotclaude。Codexは `~/.agents/skills/upload-screenshots/SKILL.md`、Claude Codeは `~/.claude/skills/upload-screenshots/SKILL.md` から同じ定義を読む。

GitHubの手順: https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli
