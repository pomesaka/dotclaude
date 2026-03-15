---
name: jjcommit
description: jj commit で現在の変更をコミットする。/jjcommit で呼び出す。
disable-model-invocation: true
allowed-tools: Bash(jj *)
---

# Jujutsu Commit

現在の変更をコミットして新しい空のリビジョンを作成する。

## 最近のログ

!`jj log --limit 3`

## 手順

### 1. 変更内容を確認

`jj diffu` を実行して現在のリビジョンの変更内容を確認する。

### 2. WHYを会話ヒストリーから収集

**最重要。** diffからはWHAT/HOWしか読み取れない。WHY（なぜ変えたか）は会話ヒストリーにしかない。
以下を特定する:

- **課題・動機**: 何を解決しようとしていたか
- **設計判断の理由**: なぜこのアプローチか、却下した代替案とその理由
- **背景情報**: バグの根本原因、制約、要件

### 3. コミットメッセージを作成・実行

WHY（Step 2）とWHAT（Step 1）からメッセージを作成し、`jj commit` で実行する。

```bash
jj commit -m "$(cat <<'EOF'
<タイトル (50文字以内)>

<WHY - 背景と動機>
- なぜこの変更が必要だったか
- 選んだアプローチとその理由

<WHAT - 主要な変更内容>
- 変更点の説明

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### 4. 確認

`jj log --limit 2` でコミットを確認。

## ガイドライン

- コードベースの言語に合わせる（日本語のコメント/ドキュメントなら日本語）
- WHYを主軸にする（WHATはdiffから読める）
- メッセージだけで変更の意図が理解できるレベルの具体性
