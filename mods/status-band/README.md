# status-band

プロンプトの下の行に、ステータス行の代わりになる帯を出すMod。モデル、コンテキストの使用率、場所を1行にまとめる。

```
opus   ━━━━━───── 47%   ~/…/dotclaude                 ● 14 ↑ 1  commit  log  #14 #13  pr  refs  pending 2
```

このModが描くのは左の3つだけ。右に並ぶ件数と札は、ほかのMod（`jj`、`pr`、`refs`、`questions`）が足している。

古いステータス行があった場所と同じ、プロンプトの下に出る。その行に元から出ている表示（`manual mode on`や`esc to interrupt`）は消さずに、帯の下に並べる。

## 読み込み

マーケットプレイス`dotclaude`から入れる。手順は`mods/README.md`にある。

## 出す項目

| 項目 | 中身 | 取り方 |
|---|---|---|
| モデル | `/model`に出る名前 | `$.session.model()` |
| 棒と`47%` | コンテキストの使用率。75%から橙、90%から赤 | `$.session.usage()` |
| 場所 | 作業ディレクトリ。ホームは`~`。40桁を超えたら途中を省き、末尾を収まるだけ残す | `$.session.cwd()` |

色は、自動のcompactionが近づいたことを知らせるためのもの。境目の75%と90%は目安で、測って決めた値ではない。

120桁より狭いと場所を出さない。

## 更新のタイミング

- セッションの開始時
- ツールの呼び出しの後
- 番の終わり

ステータス行と違い、きっかけが無いあいだは更新されない。

## ほかのModの札

この行は、複数のModが重ねて描ける。外側のModは、帯を受け取ってその右に自分の札を並べる。帯は行の幅いっぱいに取ってあり、札が足されると、その分だけ縮む。

| Mod | 足すもの |
|---|---|
| `jj` | 未コミットと未pushの件数、`commit`、`log` |
| `pr` | このセッションのPRの番号、`pr` |
| `refs` | `refs` |
| `questions` | `pending N` |

並ぶ順は、`settings.json`の`enabledPlugins`に書いた順で決まる。先に書いたModが外側（右）になる。`mods/README.md`に書き方がある。このModを入れていないときも、ほかのModの札は、エンジンの元の表示の右に出る。

## Claudeへの説明

セッションの始めに、このModの説明をClaudeへ渡す。知らないと、帯に出ていることを文章で報告し直すからだ。渡すのは`hooks/context.ts`の`SESSION_CONTEXT`。起動、再開、fork、`/clear`、compactのたびに渡す。サブエージェントには渡さない。

**仕様を変えたら、`SESSION_CONTEXT`も直す。**

## 開発

```bash
claude plugin validate mods/status-band
claude plugin test mods/status-band
```
