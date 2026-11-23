# 見積と、タスクの大きさの測り方

> **TL;DR**: AIでコードを書く時間は縮むが、決める、確かめる、待つ時間は縮まず、全体が速くなるとは限らない。工数でなく、タスクの性質（影響範囲、不確かさ、確かめにくさ、戻しにくさ、待ち）で測り、順番を決めるのに使う。「いくらで、いつまでに」には、見積でなく固定の器（人と時間を決め、中身を入れ替える）で答える。不確かさは、見積の精度でなく小さな試しで減らす。

工数や期間を聞かれたとき、計画や契約の器を決めるとき、タスクの順番を決めるときに読む。出典は末尾にあり、本文を読んだものと、検索結果の要約しか見ていないものを分けてある。出典の無い判断は「この環境の判断」と書いた。

## 時間がかかる所

タスクの時間は、書く、決める（仕様の調整、折衝、判断待ち）、確かめる（動かして見る、回帰、実機、レビュー）、待つ（外部の手続き、他社の作業、環境やアクセス権）、責任を持つ（差分を読んで出してよいと判断する）に分かれる。AIが縮めるのは主に書く時間だ。

書く時間は、AIの前から全体の一部だった。Brooksは日程の目安を計画1/3、コーディング1/6、テスト1/2とし、見積もりやすいコーディングに1/6しか割かないと書いた。

AIで全体が速くなるかは、調査で結果が割れている。

- METRの2025年前半のRCT（熟練したOSSの開発者16人、課題246件）では、AIを使うと完了までの時間が19%延びた。開発者は24%縮むと予想し、終わった後も20%縮んだと感じていた。使っている間は、書く時間と調べる時間が減り、AIの出力を読む、指示を書く、生成を待つ時間が増えた
- GoogleのRCT（社員96人）では、1つの課題の時間が約21%縮んだ（信頼区間は広い）
- METRの2026年2月の続報では、2025年後半の道具で18%と4%の高速化と推定したが、AI無しで働くのを嫌う人が参加を辞退する偏りが大きく、信頼できる値ではないとしている
- DORAの2025年の報告（約5000人）では、AIの採用はスループットと正の関係にあるが、届ける変更の安定性とは負の関係にある。強い自動テストや速いフィードバックが無いまま変更の量が増えると、不安定になる
- Faros AIの2025年の報告（1,255チーム）では、AIを多く使う人は完了したタスクが21%、マージしたPRが98%多かったが、PRのレビューの時間は91%延び、会社の単位では改善との相関が無かった（ツールを売る会社のデータ）

使えるのは、「書く速さは上がるが、全体の時間は、確かめる仕組みと決める速さで決まる」までだ。「AIで遅くなる」も「AIで何割速くなる」も、条件が違う調査を1つ選んで言い切ることになる。開発者の体感は当てにならない（METRの予想と実測の食い違い）。

## 工数でなく、タスクの性質で測る

工数を1つの数字で出すと、書く時間の縮みと、決める、確かめる、待つ時間が混ざって読めなくなる。次の5つの軸で測り、順番と、先に潰す不確かさを決めるのに使う。軸の組み合わせ方はこの環境の判断で、各軸の考え方に出典がある。

| 軸 | 測り方 | 考え方の出典 |
|---|---|---|
| 影響範囲 | 触るファイル、表、画面の数。コードから数えられる | この環境の判断 |
| 不確かさ | 未決の点と、確かめていない前提の数 | Cynefinの複雑な領域。予測でなく、安全に失敗できる試しで探る |
| 確かめにくさ | 機械で比べられる／人が見れば分かる／解釈が要る、の3段 | DORAの「確かめる仕組みが弱いと、変更の量が不安定さになる」 |
| 戻しにくさ | 一方通行か、両開きか | Bezosのone-way door／two-way door。戻せない決定は慎重に、戻せる決定は早く小さな集団で決める |
| 待ち | 外の判断、手続き、他社の作業を待つか | Magennisの「作業の時間と、届くまでの時間は違う」 |

確かめにくさを下げる手段にも重さの移り先がある。新旧の出力を比べるゴールデンテストや、性質を乱数の入力で確かめるテストは、比べる作業を一瞬にするが、重さは入力のデータ（本番のデータを使えるか、架空のデータを作れるか）と、人の目が要る判断（帳票の見た目など）に移る（この環境の判断）。

## ストーリーポイントを時間に換算しない

ストーリーポイントは、時間が当たらないので比べて大きさを付ける、という考えで使われる。ただ、考案者とされるRon Jeffriesによると、元はXPで「邪魔が入らなければペアでかかる日数」に負荷係数を掛けたもので、後から名前を変えたものだ。Jeffriesは、チームの見積やベロシティを比べることは有害だと書き、ポイントを作ったことを詫びている。Mike Cohnのサイトも、ポイントを決まった時間に換算するのは悪い考えだとしている。

換算の圧力は、契約と予算が時間で書かれるところから来る（この環境の判断）。だから、見積の単位を変えても、時間で答える場面が残る限り換算は起きる。換算が現場でどれだけ多いかの量のデータは見つからなかった。

見積そのものを減らす議論（#NoEstimates）もある。Woody Zuillは、見積に代わるやり方を探る話題の名前だとしている。Jeffriesは、見積がプログラマを急がせる棍棒として使われることが多いと書いている。

## 「いくらで、いつまでに」には器で答える

「いくらで、いつまでに」と聞かれたら、中身を見積もって足し上げるのでなく、器を決めて答える。月に出す人と時間を固定し、その中で入れる中身を入れ替える。BasecampのShape Upは、これをappetite（見積でなく、かけたい時間）と呼び、「見積は設計から始まり数字で終わる。appetiteは数字から始まり設計で終わる」と対比している。原則は、時間を固定し、範囲を変えることだ。

期日の予測が要るなら、ポイントの足し上げでなく、過去のスループット（期間あたりに終えた件数）から確率で出す（MagennisとVacantiのモンテカルロでの予測）。1つの日付を確実なものとして出さない。

出した帯は予測でなく予算として扱い、区切りごとに引き直す（この環境の判断）。

## 不確かさは、見積の精度でなく試しで減らす

不確かさの大きいタスクは、見積を細かくしても当たらない。1日から数日の試し（spike）で潰してから見積もる。XPのspikeは、技術の問題のリスクを下げるか、見積を確かにするために書く、捨てる前提の最小のコードだ。計画の手間は失敗のリスクに見合う量にし、リスクを並べて優先順位を付け、手を打ち、どれだけ下がったかを見る（Fairbanksのリスク駆動のモデル。元はBoehmのスパイラルモデル）。

## 人を足す前に

遅れたプロジェクトに人を足すと、もっと遅れる（Brooksの法則）。足した人の立ち上がりは分けられず、全員が互いにすり合わせる作業なら、手間はn(n-1)/2で増える。

AIで書くのが速くなった今は、詰まりが決める、確かめる、待つに移っている。人やエージェントを足すと、すり合わせと、差分を読む手間が増える。足すのは、独立した作業を並べられるときだけにする。決める人が1人のプロジェクトでは、その人の決める速さがいちばん効く。選択肢、推す案、根拠を揃えて出し、決めるのにかかる時間を縮める（この段落はこの環境の判断）。

## 出典

調べたのは2026-11-24。

本文を読んだもの（調べたエージェントがWebFetchかPDFの抽出で確かめた）:

- Frederick P. Brooks『The Mythical Man-Month』第2章（1975）。日程の配分、Brooksの法則、n(n-1)/2
- Ron Jeffries「[Story Points Revisited](https://ronjeffries.com/articles/019-01ff/story-points/Index.html)」（2019）、「[The #NoEstimates Movement](https://ronjeffries.com/xprog/articles/the-noestimates-movement/)」（2013）
- Mountain Goat Software「[Don't Equate Story Points to Hours](https://mountaingoatsoftware.com/blog/dont-equate-story-points-to-hours)」（2024）
- Woody Zuill「[The NoEstimates Hashtag](https://zuill.us/WoodyZuill/2013/05/17/the-noestimates-hashtag/)」（2013）
- David J. Snowden, Mary E. Boone「[A Leader's Framework for Decision Making](https://hbr.org/2007/11/a-leaders-framework-for-decision-making)」HBR（2007）。複雑な領域のprobe-sense-respond
- Jeff Bezos「[2015年の株主への手紙](https://www.sec.gov/Archives/edgar/data/1018724/000119312516530910/d168744dex991.htm)」。one-way door／two-way door
- Ryan Singer『[Shape Up](https://basecamp.com/shapeup/1.2-chapter-03)』第3章（2019）。appetite
- c2 wiki「[Spike Solution](https://c2.com/xp/SpikeSolution.html)」
- George Fairbanks「[A Risk-Driven Model for Agile Software Architecture](https://www.methodsandtools.com/archive/agilearchi.html)」
- Troy Magennis『[Lean Forecasting](https://leanpub.com/LeanForecasting)』と、Daniel Vacanti『[When Will It Be Done?](https://leanpub.com/whenwillitbedone)』の説明のページ（本の本文は読んでいない）。John Coleman「[Sizing and Forecasting in Scrum](https://www.infoq.com/articles/sizing-forecasting-scrum)」InfoQ（2022）
- METR「[Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity](https://arxiv.org/abs/2507.09089)」（2025）、「[uplift update](https://metr.org/blog/2026-02-24-uplift-update/)」（2026-02）
- Paradisほか「[How much does AI impact development speed?](https://arxiv.org/abs/2410.12944)」ICSE 2025（要旨のページ）
- DORA「[2025年の報告の発表](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)」（報告書の本体は開いていない）
- Faros AI「[The AI Productivity Paradox Report 2025](https://www.faros.ai/blog/ai-productivity-paradox-report-2025)」

検索結果の要約しか見ていないもの:

- Barry Boehm「A Spiral Model of Software Development and Enhancement」IEEE Computer（1988）
- Kent Beck『Extreme Programming Explained』のspikeの記述
- Vasco Duarte『NoEstimates』、Martin Fowler「StoryCounting」（ポイントで見積もっても、件数を数えても、予測の力は変わらないという主張）
- ストーリーポイントの時間への換算を、最も多いアンチパターンと呼ぶScrum.orgの実務家の記事
