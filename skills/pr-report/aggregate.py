#!/usr/bin/env python3
"""
~/.claude/tmp/pr_report_raw/ のデータを集計してMarkdownレポートを生成する。

Usage: python3 aggregate.py <from_date> <to_date>
"""
import json
import os
import statistics
import sys
from collections import defaultdict
from datetime import datetime, date

BUCKETS = [
    ("XS (1-9行)",     1,    9),
    ("S  (10-49行)",   10,   49),
    ("M  (50-199行)",  50,  199),
    ("L  (200-499行)", 200, 499),
    ("XL (500-999行)", 500, 999),
    ("XXL(1000行+)",  1000, 10**9),
]


def parse_args():
    if len(sys.argv) >= 3:
        return sys.argv[1], sys.argv[2]
    # 引数省略時は fetch.py と同じロジックで半期を判定
    today = date.today()
    if 4 <= today.month <= 9:
        return f"{today.year}-04-01", f"{today.year}-09-30"
    elif today.month >= 10:
        return f"{today.year}-10-01", f"{today.year + 1}-03-31"
    else:
        return f"{today.year - 1}-10-01", f"{today.year}-03-31"


def load_data(raw_dir):
    with open(f"{raw_dir}/prs_all.json") as f:
        prs = json.load(f)
    with open(f"{raw_dir}/issues_all.json") as f:
        issues = json.load(f)
    return prs, issues


def enrich_prs(prs):
    for pr in prs:
        if pr.get("createdAt") and pr.get("mergedAt"):
            c = datetime.fromisoformat(pr["createdAt"].replace("Z", "+00:00"))
            m = datetime.fromisoformat(pr["mergedAt"].replace("Z", "+00:00"))
            pr["hours_to_merge"] = (m - c).total_seconds() / 3600
        else:
            pr["hours_to_merge"] = None
        pr["changed"] = pr.get("additions", 0) + pr.get("deletions", 0)
        pr["comment_count"] = len(pr.get("comments", []))
        pr["month"] = (pr.get("mergedAt") or "")[:7]
        pr["is_bot"] = pr.get("author", {}).get("is_bot", False)
    return prs


def author_pr_stats(prs):
    """著者別PR統計を返す（bot除外）"""
    human_prs = [p for p in prs if not p["is_bot"]]
    by_author = defaultdict(list)
    for pr in human_prs:
        by_author[pr["author"]["login"]].append(pr)

    rows = []
    for login, items in by_author.items():
        hours = [p["hours_to_merge"] for p in items if p["hours_to_merge"] is not None]
        rows.append({
            "author": login,
            "total": len(items),
            "by_repo": {
                repo: sum(1 for p in items if p["repo"] == repo)
                for repo in ["ADeT", "ADeT-AI", "ADeT-infra", "ADeT-genapp"]
            },
            "additions": sum(p.get("additions", 0) for p in items),
            "deletions": sum(p.get("deletions", 0) for p in items),
            "avg_hours": round(statistics.mean(hours), 1) if hours else None,
            "median_hours": round(statistics.median(hours), 1) if hours else None,
            "avg_comments": round(statistics.mean(p["comment_count"] for p in items), 1),
            "avg_changed": round(statistics.mean(p["changed"] for p in items)),
            "self_merge_count": sum(1 for p in items if p["hours_to_merge"] is not None and p["hours_to_merge"] < 1),
        })
    rows.sort(key=lambda x: -x["total"])
    return rows


def monthly_breakdown(prs):
    """著者×月別PR数"""
    human_prs = [p for p in prs if not p["is_bot"]]
    months = sorted({p["month"] for p in human_prs if p["month"]})
    by_author = defaultdict(lambda: defaultdict(int))
    for pr in human_prs:
        by_author[pr["author"]["login"]][pr["month"]] += 1
    authors = sorted(by_author, key=lambda a: -sum(by_author[a].values()))
    return authors, months, by_author


def bucket_stats(prs):
    """変更行数バケット別集計"""
    human_prs = [p for p in prs if not p["is_bot"]]
    total = len(human_prs)

    overall = []
    for label, lo, hi in BUCKETS:
        count = sum(1 for p in human_prs if lo <= p["changed"] <= hi)
        overall.append((label, count, count / total * 100 if total else 0))

    by_author = defaultdict(lambda: {label: 0 for label, _, _ in BUCKETS})
    for pr in human_prs:
        login = pr["author"]["login"]
        for label, lo, hi in BUCKETS:
            if lo <= pr["changed"] <= hi:
                by_author[login][label] += 1
                break

    author_order = sorted(by_author, key=lambda a: -sum(by_author[a].values()))
    return overall, by_author, author_order


def issue_stats(issues):
    by_author = defaultdict(int)
    for issue in issues:
        login = issue.get("author", {}).get("login", "unknown")
        by_author[login] += 1
    return sorted(by_author.items(), key=lambda x: -x[1])


def repo_stats(prs):
    """リポジトリ別マージ時間"""
    human_prs = [p for p in prs if not p["is_bot"]]
    by_repo = defaultdict(list)
    for p in human_prs:
        if p["hours_to_merge"] is not None:
            by_repo[p["repo"]].append(p["hours_to_merge"])
    rows = []
    for repo in ["ADeT", "ADeT-AI", "ADeT-infra", "ADeT-genapp"]:
        vals = by_repo[repo]
        if vals:
            rows.append((repo, len(vals), round(statistics.mean(vals), 1), round(statistics.median(vals), 1)))
    return rows


def generate_report(from_date, to_date, prs, issues):
    today = date.today().strftime("%Y/%m/%d")
    human_prs = [p for p in prs if not p["is_bot"]]
    bot_prs   = [p for p in prs if p["is_bot"]]

    stats = author_pr_stats(prs)
    authors, months, monthly = monthly_breakdown(prs)
    bucket_overall, bucket_by_author, bucket_authors = bucket_stats(prs)
    issue_rows = issue_stats(issues)
    repo_rows  = repo_stats(prs)

    lines = []
    a = lines.append

    a(f"# PR・Issue 集計レポート")
    a(f"")
    a(f"**対象期間**: {from_date} 〜 {to_date}  ")
    a(f"**対象リポジトリ**: ADeT / ADeT-AI / ADeT-infra / ADeT-genapp (Accel-Hack Org.)  ")
    a(f"**集計日**: {today}")
    a(f"")
    a(f"---")
    a(f"")
    a(f"## サマリー")
    a(f"")
    a(f"| 指標 | 件数 |")
    a(f"|------|------|")
    a(f"| マージ済みPR 総数 (bot除く) | {len(human_prs)} |")
    a(f"| マージ済みPR 総数 (bot含む) | {len(prs)} |")
    a(f"| クローズ済みIssue 総数 | {len(issues)} |")
    a(f"| 参加メンバー (人間) | {len(stats)}名 |")
    a(f"")
    a(f"---")
    a(f"")
    a(f"## PR集計 (メンバー別)")
    a(f"")
    a(f"| Author | 総PR数 | +additions | -deletions | ADeT | ADeT-AI | ADeT-infra | ADeT-genapp |")
    a(f"|--------|--------|-----------|-----------|------|---------|-----------|------------|")
    for r in stats:
        def rcount(r, repo): return str(r["by_repo"][repo]) if r["by_repo"][repo] else "-"
        a(f"| {r['author']} | {r['total']} | +{r['additions']:,} | -{r['deletions']:,} | {rcount(r, 'ADeT')} | {rcount(r, 'ADeT-AI')} | {rcount(r, 'ADeT-infra')} | {rcount(r, 'ADeT-genapp')} |")
    a(f"")
    a(f"※ bot (dependabot, copilot-swe-agent 等) は除外")
    a(f"")
    a(f"---")
    a(f"")
    a(f"## PR月別推移")
    a(f"")
    header = "| Author |" + "".join(f" {m} |" for m in months)
    sep    = "|--------|" + "".join("---------|" for _ in months)
    a(header)
    a(sep)
    for author in authors:
        row = f"| {author} |"
        for m in months:
            cnt = monthly[author].get(m, 0)
            row += f" {cnt if cnt else '-'} |"
        a(row)
    a(f"")
    a(f"---")
    a(f"")
    a(f"## マージ時間・コメント数統計")
    a(f"")
    a(f"| Author | PR数 | 平均マージ時間 | 中央値マージ時間 | 平均コメント数 | 平均変更行数 | セルフマージ率 |")
    a(f"|--------|------|------------|--------------|------------|-----------|------------|")
    for r in stats:
        avg_h = f"{r['avg_hours']}h" if r['avg_hours'] is not None else "-"
        med_h = f"{r['median_hours']}h" if r['median_hours'] is not None else "-"
        self_rate = f"{r['self_merge_count']}/{r['total']} ({r['self_merge_count']*100//r['total']}%)" if r['total'] else "-"
        a(f"| {r['author']} | {r['total']} | {avg_h} | {med_h} | {r['avg_comments']} | {r['avg_changed']:,} | {self_rate} |")
    a(f"")
    a(f"### リポジトリ別マージ時間")
    a(f"")
    a(f"| リポジトリ | PR数 | 平均マージ時間 | 中央値マージ時間 |")
    a(f"|-----------|------|------------|--------------|")
    for repo, cnt, avg, med in repo_rows:
        a(f"| {repo} | {cnt} | {avg}h | {med}h |")
    a(f"")
    a(f"---")
    a(f"")
    a(f"## 変更行数バケット別 PR分布")
    a(f"")
    a(f"### 全体")
    a(f"")
    a(f"| バケット | PR数 | 割合 |")
    a(f"|--------|------|------|")
    for label, count, pct in bucket_overall:
        a(f"| {label} | {count} | {pct:.1f}% |")
    a(f"")
    a(f"### 著者別バケット分布")
    a(f"")
    labels_short = ["XS", "S", "M", "L", "XL", "XXL"]
    a(f"| Author |" + "".join(f" {l} |" for l in labels_short))
    a(f"|--------|" + "".join("-----|" for _ in labels_short))
    for author in bucket_authors:
        row = f"| {author} |"
        for label, _, _ in BUCKETS:
            row += f" {bucket_by_author[author][label]} |"
        a(row)
    a(f"")
    a(f"---")
    a(f"")
    a(f"## Issue集計 (作成者別・クローズ済み)")
    a(f"")
    a(f"| Author | クローズ済みIssue数 |")
    a(f"|--------|-----------------|")
    for login, cnt in issue_rows:
        a(f"| {login} | {cnt} |")
    a(f"")
    a(f"---")
    a(f"")
    a(f"## データファイル")
    a(f"")
    raw_dir = os.path.expanduser("~/.claude/tmp/pr_report_raw")
    a(f"生データ: `{raw_dir}/`")
    a(f"")

    return "\n".join(lines)


def main():
    from_date, to_date = parse_args()
    raw_dir = os.path.expanduser("~/.claude/tmp/pr_report_raw")

    prs, issues = load_data(raw_dir)
    prs = enrich_prs(prs)

    report = generate_report(from_date, to_date, prs, issues)

    from_slug = from_date.replace("-", "")
    to_slug   = to_date.replace("-", "")
    out_path  = os.path.expanduser(f"~/.claude/tmp/pr_report_{from_slug}_{to_slug}.md")

    with open(out_path, "w") as f:
        f.write(report)

    print(out_path)


if __name__ == "__main__":
    main()
