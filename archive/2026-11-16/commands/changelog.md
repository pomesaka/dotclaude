## Change log Generation
$ARGUMENTSの期間のdevブランチのcommit履歴から、markdown形式のCHANGELOGを作成してください。
commitの内容を確認し、適切にまとめた日本語のサマリにしてください。
その他、下記情報を含めてください
- その変更が機能追加なのか、バグ修正なのか、リファクタリングなのかなどのtype
- どのPRで変更されたのか
- いつdevに取り込まれたのか(日にち)

typeごとに章をまとめてください。

format:
```md
<type>
- <commit summary> #<PR number> @<date>
  - <detail if needed>
- ...
```

```bash
# Get commit in dev bookmarks within 7days
jj log -r '..dev & committer_date(after:"1 week ago")' --color=always

# Get commit details
jj show -s -r <revision>
```
