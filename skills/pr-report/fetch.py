#!/usr/bin/env python3
"""
PR・Issue データを GitHub API から取得して ~/.claude/tmp/pr_report_raw/ に保存する。

Usage: python3 fetch.py <from_date> <to_date>
  from_date: YYYY-MM-DD
  to_date:   YYYY-MM-DD
"""
import json
import subprocess
import sys
import os
from datetime import date, datetime

REPOS = ["ADeT", "ADeT-AI", "ADeT-infra", "ADeT-genapp"]
ORG = "Accel-Hack"


def current_half_year():
    today = date.today()
    if 4 <= today.month <= 9:
        return f"{today.year}-04-01", f"{today.year}-09-30"
    elif today.month >= 10:
        return f"{today.year}-10-01", f"{today.year + 1}-03-31"
    else:  # 1-3月
        return f"{today.year - 1}-10-01", f"{today.year}-03-31"


def parse_args():
    if len(sys.argv) >= 3:
        from_date = sys.argv[1]
        to_date = sys.argv[2]
    else:
        from_date, to_date = current_half_year()
        print(f"引数省略: {from_date} 〜 {to_date} を対象にします", file=sys.stderr)
    return from_date, to_date


def gh_list(repo_full, kind, from_dt, to_dt, limit=1000):
    """gh pr list / gh issue list を実行してフィルタ済みリストを返す。"""
    cmd = [
        "gh", kind, "list",
        "--repo", repo_full,
        "--state", "merged" if kind == "pr" else "closed",
        "--limit", str(limit),
        "--json", "number,title,author,createdAt,mergedAt,closedAt,additions,deletions,comments,url,labels"
        if kind == "pr" else
        "number,title,author,assignees,closedAt,url,labels",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  [WARN] {repo_full} {kind}: {result.stderr.strip()}", file=sys.stderr)
        return []

    items = json.loads(result.stdout)

    # 日付フィルタ
    from_iso = from_dt + "T00:00:00Z"
    to_iso   = to_dt   + "T23:59:59Z"
    date_key = "mergedAt" if kind == "pr" else "closedAt"
    if len(items) >= limit:
        print(f"  [WARN] {repo_full} {kind}: 取得件数が上限({limit})に達しました。欠損の可能性があります", file=sys.stderr)

    filtered = [
        item for item in items
        if item.get(date_key) and from_iso <= item[date_key] <= to_iso
    ]
    return filtered


def main():
    from_date, to_date = parse_args()

    out_dir = os.path.expanduser("~/.claude/tmp/pr_report_raw")
    os.makedirs(out_dir, exist_ok=True)

    all_prs = []
    all_issues = []

    for repo in REPOS:
        repo_full = f"{ORG}/{repo}"
        print(f"Fetching {repo_full} ...", file=sys.stderr)

        prs = gh_list(repo_full, "pr", from_date, to_date)
        for p in prs:
            p["repo"] = repo
        print(f"  PRs: {len(prs)}", file=sys.stderr)

        issues = gh_list(repo_full, "issue", from_date, to_date)
        for i in issues:
            i["repo"] = repo
        print(f"  Issues: {len(issues)}", file=sys.stderr)

        # リポジトリ別ファイル保存
        with open(f"{out_dir}/prs_{repo}.json", "w") as f:
            json.dump(prs, f, ensure_ascii=False, indent=2)
        with open(f"{out_dir}/issues_{repo}.json", "w") as f:
            json.dump(issues, f, ensure_ascii=False, indent=2)

        all_prs.extend(prs)
        all_issues.extend(issues)

    # 全体結合ファイル
    with open(f"{out_dir}/prs_all.json", "w") as f:
        json.dump(all_prs, f, ensure_ascii=False, indent=2)
    with open(f"{out_dir}/issues_all.json", "w") as f:
        json.dump(all_issues, f, ensure_ascii=False, indent=2)

    print(f"\n完了: PR {len(all_prs)}件 / Issue {len(all_issues)}件", file=sys.stderr)
    print(f"保存先: {out_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
