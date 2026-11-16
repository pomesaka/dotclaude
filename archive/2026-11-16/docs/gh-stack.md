# GitHub Stacked PRs（gh stack）リファレンス

> **TL;DR**: 積んだPRは、作った直後に`gh stack link <下から順のPR番号>`でGitHubのStackとして登録する。jjでは`link`と、番号を渡す`merge`・`unstack`だけを使う。登録するとStackの途中のPRにもCIが走る。マージは下からしかできない。

2026-10-07に、公式ドキュメント（[About stacked pull requests](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)・[Roll out](https://docs.github.com/en/pull-requests/tutorials/roll-out-stacked-prs)）と`github/gh-stack`のREADME（main）を読み、ある案件のPR10本で試してまとめた。拡張はv0.2.0、`gh`は2.100.0。新しい拡張なので、コマンドは記憶で組まず`gh stack <command> --help`で確かめる。

各項目の末尾に、自分で確かめたものは「実測」、資料に書かれているだけのものは「資料」と付ける。

## 入れ方

```sh
gh extension install github/gh-stack
gh extension upgrade stack
```

リポジトリやOrganizationの側で有効にする手順は要らない（資料。自分の組織のリポジトリでは何も設定せずに登録できた・実測）。

## Stackとは

「各PRの向き先を1つ前のPRのブランチにする」だけでは、GitHubはそれをStackとして扱わない。Stackは別に登録するもので、登録するとPRのAPIに`stack`が付く（実測）。

```sh
gh api repos/<owner>/<repo>/pulls/<PR番号> --jq .stack
# {"base":{"ref":"main",...},"id":1832585,"number":40,"position":2,"size":10}
```

`number`はStackの番号で、`merge`と`unstack`に渡す。

## jjで使えるコマンド

`gh stack`の多くは、手元でgitのブランチをチェックアウトしている前提で動く。jjの作業コピーはブランチに乗っていないので、`gh stack view`は`failed to get current branch: git: not on any branch`で止まる（実測）。`init`・`add`・`sync`・`rebase`・`push`・`submit`・`up`/`down`も同じ前提なので使わない（資料から。個別には試していない）。

jjで使うのは次の3つ。どれも手元の追跡用の状態を作らない。

| コマンド | 働き |
|---|---|
| `gh stack link <PR番号かブランチ名>...` | 下から順に並べたPRをStackにする。READMEに「jjなどでブランチを管理する人向け」と書かれている |
| `gh stack merge <Stackの番号かPR番号>` | そのPRまでを下からまとめてマージする |
| `gh stack unstack <Stackの番号>` | Stackを解く。PRとブランチは残る |

rebaseとpushはjjでやる。下のPRを直すときは`jj new <rev>`で編集して`jj squash --into <rev>`し、上のPRが自動でrebaseされたあと`jj git push --all`する。

## 手順

1. jjで変更を積み、PRごとにブックマークを付けて`jj git push --all`する
2. PRを下から順に作る。向き先は1つ前のブランチにする（`gh pr create --base <前のブランチ> --head <ブランチ>`）
3. すぐに`gh stack link <下から順のPR番号>`を実行する
4. `gh api .../pulls/<番号> --jq .stack`で`position`と`size`を確かめる

`link`の挙動は次のとおり。

- 既にあるPRはそのまま使い、向き先がずれていれば直す（資料。実測では向き先が正しい10本に何も変えなかった）
- ブランチ名を渡すとpushしてPRも作る（資料）。本文を自分で書きたいので、PRを先に作って番号を渡す
- 追加しかしない。Stackに入っているPRを外すことはない（資料）
- **既にあるStackにPRを足すときは、Stackの番号を先頭に渡す**（`gh stack link <Stackの番号> <足すPR番号>`）。先端のPRと新しいPRだけを並べると`Cannot update stack: this would remove #30, ...`で断られる。マージ済みのPRまで全部並べ直すと、マージ済みの次のPRの向き先を消えたブランチへ戻そうとして422になり、Stackの更新も409で失敗する。どちらの失敗でもStackは元のまま残った（実測）
- `--open`を付けなければ、下書きのPRは下書きのまま（実測）

## CI

ワークフローが`on: pull_request: branches: [main]`のとき、次のようになる。

- **登録する前**: 向き先が`main`でないPRにはCIが走らない（実測）
- **登録した時点**: Stackの途中のPRにもCIが走る。10本を登録したら、向き先が`main`でない9本にすぐ走った（実測）。資料にも「既定ブランチ向けのPRで走るCIは、Stackの全PRで走る。設定の変更は要らない」とある
- **見落としやすい点**: 下のPRがマージされて向き先が`main`に付け替わっただけのPRには、CIが走らない。登録の前にマージが済んでいた1本は、登録してもCIが付かなかった（実測）。PRを作ったらマージの前に登録しておく

必須レビュー・必須チェック・CODEOWNERSは、Stackの全PRに対して、Stackの向き先（`main`）の規則で判定される（資料）。

## マージ

- 下からしかマージできない（資料）
- 全部、1本だけ、途中までのどれでもよい。merge commit・squash・rebaseの3つが使える（資料）
- 下のPRをマージすると、次のPRの向き先が`main`になる（実測）。資料には「残りのブランチは自動でrebaseされる」とあるが、**merge commitでマージしたときは、残りのブランチは書き換えられなかった**。先頭のコミットは手元と同じままで、`jj git fetch`するだけでよく、rebaseもpushも要らなかった（実測。2本続けてマージして同じ結果）。squashやrebaseでマージしたときは未確認
- マージ済みのPRはStackに残る。`size`は変わらず、残りのPRの`position`も詰まらない（実測）
- 向き先が`main`に変わったPRには、登録後のpushで走ったCIの結果がそのまま付いている。マージのたびにCIを待つ必要は無かった（実測）
- `gh stack merge`は、選んだPRまでを全部マージするか1本もマージしないかのどちらかになる。マージの条件を飛ばすことはできない（資料）
- 向き先にmerge queueがあれば、マージの代わりにキューへ入る（資料）

`gh stack merge`と`gh stack unstack`は取り消せない外向きの操作なので、ユーザーに言われたときだけ実行する。

## 制限

- 全ブランチが同じリポジトリにあること。フォークをまたげない（資料）
- 一直線のStackだけ。枝分かれは作れない（資料）
- GitHub Desktopは未対応（資料）
- PRの数の上限は資料に書かれていない。10本は登録できた（実測）

## 登録したあとの修正

下のPRを直して`jj git push --all`で全ブランチを書き換えても、Stackは保たれる。pushのたびに、Stackの全PRでCIが走る（実測。登録後に4回書き換えた）。

## まだ確かめていないこと

- squashやrebaseでマージしたときに、残りのブランチがどう書き換えられ、手元のjjのブックマークとどう食い違うか
- エージェント向けのスキル（`gh skill install github/gh-stack`）の中身
