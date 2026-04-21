---
name: gotcha
description: 気づいた落とし穴・失敗パターンを関連スキルのGotchasセクションに追記する。
when_to_use: 「これgotchaに残して」「失敗パターンを記録して」「このミスをスキルに追記して」と言われたとき。作業中に想定外の挙動・罠を発見したとき。
argument-hint: "[スキル名] [失敗パターンの説明]"
allowed-tools: Read, Edit, Glob
model: haiku
---

# Gotcha 追記

`$ARGUMENTS` の内容を適切なスキルの Gotchas セクションに追記する。

## 手順

### Step 1: 対象スキルを特定

`$ARGUMENTS` にスキル名が明示されていれば、それを使う。なければ会話の文脈から推定する。

スキルファイルのパス: `~/.claude/skills/<skill-name>/SKILL.md`

### Step 2: Gotchas エントリを作成

以下の形式で 1 行エントリを作る:

```
- **[落とし穴の名前]**: 具体的な症状と対処法
```

- 名前: 検索しやすい短いキーワード（例: `空のdiff`, `絶対パス`, `allowed-tools漏れ`）
- 本文: 「〜すると〜になる。〜で解決」の形で症状→原因→対処をコンパクトに書く

### Step 3: Gotchas セクションに追記

**セクションが存在する場合**: 既存エントリの末尾に追加する。

```markdown
## Gotchas

- **既存エントリ**: ...
- **新エントリ**: ...  ← ここに追加
```

**セクションが存在しない場合**: ファイル末尾に追加する。

```markdown

## Gotchas

- **新エントリ**: ...
```

## Gotchas

- **`!` precommand でのコマンド置換**: `!` precommand 内で `$(...)` を使うと "Contains command_substitution" エラーで弾かれる。複雑な処理はスクリプトに移して `!bash /path/to/script.sh` で呼ぶ。
- **スクリプト呼び出しに `allowed-tools` が必要**: `settings.json` に権限を追加するだけでは不十分。スクリプトを `!` precommand や Bash ツールで呼ぶ SKILL.md 側にも `allowed-tools: Bash(bash /path/to/script.sh *)` が必要。

---

### Step 4: 確認

追記後にエントリが正しく挿入されたことを確認してユーザーに報告する。

```
✓ [skill-name]/SKILL.md の Gotchas に追記しました:
- **[名前]**: [内容]
```
