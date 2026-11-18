#!/usr/bin/env python3
"""Claude Code の会話の記録から、セッションをまたいで繰り返している道具の呼び出しの並びを数える。

スクリプトや hook にできる手順の候補を出すためのもの。どれをスクリプトにするかは、
振り返り（/re）で人とエージェントが決める。このスクリプトは数えるだけで、判断しない。

使い方:
  python3 -I count.py [--days 30] [--min-sessions 3] [--top 30] [--max-len 4]

出力は、並びの長さが長い順、同じ長さの中ではセッション数の多い順。
"""

import argparse
import json
import re
import shlex
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

PROJECTS = Path.home() / ".claude" / "projects"

# 1 呼び出しを 1 語の「手」にならす。値（パス、数、文字列）は落とし、何をしたかだけを残す
SUBCOMMAND_TOOLS = {
    "jj", "git", "gh", "xwb", "cf", "npm", "bun", "pnpm", "cargo", "mise", "docker",
    "podman", "kubectl", "aws", "gcloud", "claude-deck", "difit", "portless", "uv",
}
# 調べ物と読み書きの道具は、判断の途中の手なので数えない。数えると上位がこれで埋まる
NOISE = {
    "cd", "echo", "true", "sleep", "ls", "cat", "pwd", "rg", "grep", "sed", "awk", "fd",
    "find", "head", "tail", "wc", "jq", "sort", "uniq", "cut", "tr", "diff", "cmp", "stat",
    "file", "which", "command", "date", "mkdir", "cp", "mv", "rm", "touch", "chmod", "test",
}


def normalize_bash(command: str) -> str | None:
    # 複合コマンドは最初の意味のある 1 つで代表させる
    first = re.split(r"\s*(?:&&|\|\||;|\|)\s*", command.strip(), maxsplit=1)[0]
    try:
        words = shlex.split(first)
    except ValueError:
        words = first.split()
    while words and ("=" in words[0] and not words[0].startswith("-")):
        words = words[1:]  # 先頭の環境変数の代入
    if not words:
        return None
    name = Path(words[0]).name
    if name in NOISE:
        return None
    if name in {"python3", "python", "node", "sh", "bash"}:
        script = next((w for w in words[1:] if not w.startswith("-") and not w.startswith("<")), None)
        # ヒアドキュメントや -c の使い捨てのコードは、その場の判断なので数えない
        return f"{name} {Path(script).name}" if script else None
    if name in SUBCOMMAND_TOOLS or (len(words) > 1 and not words[1].startswith("-")):
        sub = next((w for w in words[1:] if not w.startswith("-") and "/" not in w), None)
        if sub and re.fullmatch(r"[a-z][a-z0-9-]*", sub) and (name in SUBCOMMAND_TOOLS):
            return f"{name} {sub}"
    return name


def normalize(tool: str, inp: dict) -> str | None:
    if tool == "Bash":
        cmd = normalize_bash(inp.get("command", ""))
        return f"Bash:{cmd}" if cmd else None
    if tool in {"Read", "Edit", "Write", "Grep", "Glob"}:
        return None  # ファイルを読む・直すのは判断の一部なので数えない
    if tool == "Skill":
        return f"Skill:{inp.get('skill', '')}"
    if tool == "Agent":
        return "Agent"
    return tool


def sessions(days: int):
    since = time.time() - days * 86400
    for path in PROJECTS.glob("*/*.jsonl"):
        if path.stat().st_mtime < since:
            continue
        steps = []
        with path.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                if '"tool_use"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("isSidechain"):
                    continue  # サブエージェントの呼び出しは、その中の判断なので数えない
                content = (rec.get("message") or {}).get("content")
                if not isinstance(content, list):
                    continue
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        step = normalize(block.get("name", ""), block.get("input") or {})
                        # 同じ手が続くのは 1 手にまとめる（ポーリングの繰り返しを数えない）
                        if step and (not steps or steps[-1] != step):
                            steps.append(step)
        if steps:
            yield path, steps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--min-sessions", type=int, default=3)
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--max-len", type=int, default=4)
    args = ap.parse_args()

    seen_in = defaultdict(set)
    projects_of = defaultdict(set)
    total = Counter()
    n_sessions = 0
    for path, steps in sessions(args.days):
        n_sessions += 1
        for n in range(2, args.max_len + 1):
            for i in range(len(steps) - n + 1):
                gram = tuple(steps[i : i + n])
                if len(set(gram)) < 2:
                    continue
                total[gram] += 1
                seen_in[gram].add(path)
                projects_of[gram].add(path.parent.name)

    rows = [
        (len(g), len(seen_in[g]), total[g], g)
        for g in total
        if len(seen_in[g]) >= args.min_sessions
    ]
    # 長い並びに含まれる短い並びは、同じ回数なら出さない（長い方が手順の形をよく表す）
    rows.sort(key=lambda r: (-r[0], -r[1], -r[2]))
    shown = []
    for length, n_seen, count, gram in rows:
        joined = " → ".join(gram)
        if any(joined in s and c >= count for s, c in shown):
            continue
        shown.append((joined, count))
        if len(shown) >= args.top:
            break

    print(f"# 繰り返している手順の候補（直近 {args.days} 日、{n_sessions} セッション）\n")
    print("| 回数 | セッション数 | プロジェクト数 | 並び |")
    print("|---:|---:|---:|---|")
    for joined, count in shown:
        gram = tuple(joined.split(" → "))
        print(f"| {count} | {len(seen_in[gram])} | {len(projects_of[gram])} | {joined} |")
    return 0


if __name__ == "__main__":
    # WHY exit 0: スキルの読み込み時に走る。0 以外で終わるとスキルの呼び出しごと止まり、
    # 何が起きたかがモデルに届かない
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"数えるのに失敗: {type(e).__name__}: {e}")
    sys.exit(0)
