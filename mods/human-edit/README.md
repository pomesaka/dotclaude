# human-edit

エージェントがユーザー本人にファイルを編集してもらうための`human_edit`ツールを追加するClaude Code Mod。tmuxのpaneを分割してeditorでファイルを開き、editorが終了するまでtool callを返さない。

```
human_edit({ path: ".env", instructions: "OPENAI_API_KEYを設定してください" })
→ {"status":"completed","path":".env","changed":true}
```

結果にファイルの内容は含めない。内容が必要ならエージェントが続けてReadする。

## 読み込み

マーケットプレイス`dotclaude`から入れる。手順は`mods/README.md`にある。Claude Codeはtmuxの中で起動する。

## 挙動

| 状況 | 結果 |
|---|---|
| editorが終了コード0で終わった | `{"status":"completed","path","changed"}` |
| ユーザーがpaneを閉じた、tool callが中断された | `{"status":"cancelled","path"}` |
| editorが0以外で終わった | tool error |
| プロジェクトルート外のパス（`..`、絶対パス、ルート外を指すsymlink） | tool error |
| 親ディレクトリが無いパス | tool error。editorは開かない。ディレクトリは作らないので、呼び出し側が作るか、パスを直す |
| tmuxの外で起動している | tool error |
| 別の`human_edit`が進行中 | tool error |

- `instructions`を渡すと、pane内に表示してEnterを待ってからeditorを開く
- `line`を渡すと、その行にカーソルを置いて開く（`$editor +N file`）。`+N`が通じるeditor（nvim、vim、viなど）を前提にしている
- 編集しているあいだ、Claude Codeのプロンプトの上の帯に、ファイルと`instructions`を出し続ける。editorが開くとpane内の指示は隠れるので、何を書けばよいかを編集中も見られるようにしている。editorを閉じると帯は消える
- editorは`HUMAN_EDIT_EDITOR`、`VISUAL`、`EDITOR`の順に探し、どれも無ければnvim、vim、viの順に探す
- `changed`は前後の内容のハッシュ（SHA-256）で判定する。4MiBを超えるファイルはsizeとmtimeで判定する
- tool callを中断すると、最大1.5秒ほどでpaneを閉じて`cancelled`を返す

## 開発

```bash
claude plugin validate mods/human-edit
claude plugin test mods/human-edit
```

`hooks/backend.ts`の`HumanEditBackend`を実装すれば、tmux以外の編集手段に差し替えられる。
