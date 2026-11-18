// Bash で jj bookmark create を打ったときに、Claude へ渡す知らせ。
// WHY: Claude は jj bookmark create の後に jj git push を別に打つ並びを繰り返していた（会話の記録で 8〜10 セッション、2026-11-18 に数えた）。
// 新しいブックマークの push は jj git push --named <名前>=@ の 1 手で済み、tracking のエラーも出ない。
// WHY 止めない: ローカルだけで使うブックマークを作ることもある。
// WHY NOT jj bookmark set: 既存のブックマークを動かす正当な使い方が多い

// jj bookmark create と、その短い形（jj b c）。jj と bookmark のあいだのグローバルなフラグも許す
const CREATE = /\bjj\s+(?:-\S+\s+)*(?:bookmark|b)\s+(?:create|c)\b/

export const pushHintOf = (command: string): string | null => {
  if (!CREATE.test(command)) return null
  return [
    'jj の Mod からの知らせ: 新しいブックマークを push するなら、jj bookmark create と jj git push を別に打たずに、`jj git push --named <名前>=@` の 1 手で済む。作成と追跡（tracking）も同時に行うので、tracking のエラーも出ない。',
    'PR まで作るなら、create-pr スキルの `~/.claude/skills/create-pr/pr-push.sh` を使う。',
    'ローカルだけで使うブックマークなら、この知らせは無視してよい。',
  ].join('\n')
}
