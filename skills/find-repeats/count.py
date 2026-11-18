#!/usr/bin/env python3
"""会話の記録から、セッションをまたいで繰り返している道具の呼び出しの並びを数える。

スクリプトや hook にできる手順の候補を出すためのもの。どれを仕組みにするかは、
振り返り（/re）で人とエージェントが決める。このスクリプトは数えるだけで、判断しない。

使い方:
  count.py [--days 30] [--min-sessions 3] [--top 30] [--max-len 4]

出力は、並びの長さが長い順、同じ長さの中ではセッション数の多い順。
"""

import argparse
import json
import re
import shlex
import sys
import time
from collections import Counter, defaultdict
from collections.abc import Iterator
from pathlib import Path

PROJECTS = Path.home() / ".claude" / "projects"

# サブコマンドまでを 1 手として数える道具。ほかの道具はコマンド名だけで数える
SUBCOMMAND_TOOLS = frozenset(
    {
        "jj", "git", "gh", "xwb", "cf", "npm", "bun", "pnpm", "cargo", "mise",
        "docker", "podman", "kubectl", "aws", "gcloud", "claude-deck", "difit",
        "portless", "uv",
    }
)  # fmt: skip

# 調べ物と読み書きの道具は、判断の途中の手なので数えない。数えると上位がこれで埋まる
NOISE = frozenset(
    {
        "cd", "echo", "true", "sleep", "ls", "cat", "pwd", "rg", "grep", "sed",
        "awk", "fd", "find", "head", "tail", "wc", "jq", "sort", "uniq", "cut",
        "tr", "diff", "cmp", "stat", "file", "which", "command", "date", "mkdir",
        "cp", "mv", "rm", "touch", "chmod", "test",
    }
)  # fmt: skip

INTERPRETERS = frozenset({"python3", "python", "node", "sh", "bash", "zsh"})
SUBCOMMAND = re.compile(r"[a-z][a-z0-9-]*")
COMMAND_SEPARATOR = re.compile(r"\s*(?:&&|\|\||;|\|)\s*")


def split_words(command: str) -> list[str]:
    """複合コマンドの最初の 1 つを語に分け、先頭の環境変数の代入を除く。"""
    first = COMMAND_SEPARATOR.split(command.strip(), maxsplit=1)[0]
    try:
        words = shlex.split(first)
    except ValueError:  # 閉じていない引用符。語の切れ目だけ分かればよい
        words = first.split()
    while words and "=" in words[0] and not words[0].startswith("-"):
        words = words[1:]
    return words


def normalize_bash(command: str) -> str | None:
    """Bash の 1 呼び出しを、値を落とした 1 語の「手」にする。数えない手は None。"""
    words = split_words(command)
    if not words:
        return None
    name = Path(words[0]).name
    args = words[1:]
    if name in NOISE:
        return None
    if name in INTERPRETERS:
        # -c やヒアドキュメントの使い捨てのコードは、その場の判断なので数えない
        if "-c" in args or any(a.startswith("<") for a in args):
            return None
        script = next((a for a in args if not a.startswith("-")), None)
        return f"{name} {Path(script).name}" if script else None
    if name in SUBCOMMAND_TOOLS:
        sub = next((a for a in args if not a.startswith("-")), None)
        if sub and SUBCOMMAND.fullmatch(sub):
            return f"{name} {sub}"
    return name


def normalize(tool: str, tool_input: dict) -> str | None:
    """道具の呼び出しを 1 手にする。数えない手は None。"""
    if tool == "Bash":
        step = normalize_bash(tool_input.get("command", ""))
        return f"Bash:{step}" if step else None
    if tool in {"Read", "Edit", "Write", "Grep", "Glob"}:
        return None  # ファイルを読む・直すのは判断の一部なので数えない
    if tool == "Skill":
        return f"Skill:{tool_input.get('skill', '')}"
    return tool


def tool_uses(line: str) -> Iterator[tuple[str, dict]]:
    """記録の 1 行から、メインの会話の道具の呼び出しを取り出す。"""
    if '"tool_use"' not in line:
        return
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        return
    if record.get("isSidechain"):
        return  # サブエージェントの呼び出しは、その中の判断なので数えない
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            yield block.get("name", ""), block.get("input") or {}


def sessions(days: int) -> Iterator[tuple[Path, list[str]]]:
    """直近 days 日に更新された記録ごとに、手の並びを返す。"""
    since = time.time() - days * 86400
    for path in PROJECTS.glob("*/*.jsonl"):
        if path.stat().st_mtime < since:
            continue
        steps: list[str] = []
        with path.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                for tool, tool_input in tool_uses(line):
                    step = normalize(tool, tool_input)
                    # 同じ手が続くのは 1 手にまとめる（ポーリングの繰り返しを数えない）
                    if step and (not steps or steps[-1] != step):
                        steps.append(step)
        if steps:
            yield path, steps


def contains(longer: tuple[str, ...], shorter: tuple[str, ...]) -> bool:
    n = len(shorter)
    return any(longer[i : i + n] == shorter for i in range(len(longer) - n + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--min-sessions", type=int, default=3)
    parser.add_argument("--top", type=int, default=30)
    parser.add_argument("--max-len", type=int, default=4)
    args = parser.parse_args()

    occurrences: Counter[tuple[str, ...]] = Counter()
    sessions_of: defaultdict[tuple[str, ...], set[Path]] = defaultdict(set)
    projects_of: defaultdict[tuple[str, ...], set[str]] = defaultdict(set)
    n_sessions = 0
    for path, steps in sessions(args.days):
        n_sessions += 1
        for n in range(2, args.max_len + 1):
            for i in range(len(steps) - n + 1):
                gram = tuple(steps[i : i + n])
                if len(set(gram)) < 2:
                    continue  # 1 種類の手だけの並びは、手順ではない
                occurrences[gram] += 1
                sessions_of[gram].add(path)
                projects_of[gram].add(path.parent.name)

    candidates = sorted(
        (g for g in occurrences if len(sessions_of[g]) >= args.min_sessions),
        key=lambda g: (-len(g), -len(sessions_of[g]), -occurrences[g]),
    )
    # 長い並びに含まれる短い並びは、回数が増えないなら出さない（長い方が手順をよく表す）
    shown: list[tuple[str, ...]] = []
    for gram in candidates:
        if any(
            contains(s, gram) and occurrences[s] >= occurrences[gram] for s in shown
        ):
            continue
        shown.append(gram)
        if len(shown) >= args.top:
            break

    print(
        f"# 繰り返している手順の候補（直近 {args.days} 日、{n_sessions} セッション）\n"
    )
    print("| 回数 | セッション数 | プロジェクト数 | 並び |")
    print("|---:|---:|---:|---|")
    for gram in shown:
        row = [occurrences[gram], len(sessions_of[gram]), len(projects_of[gram])]
        print(f"| {' | '.join(map(str, row))} | {' → '.join(gram)} |")


if __name__ == "__main__":
    # WHY 失敗しても exit 0: スキルの読み込み時に走る。0 以外で終わると
    # スキルの呼び出しごと止まり、何が起きたかがモデルに届かない。
    # 失敗は「数えるのに失敗」で始まる行で知らせる
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"数えるのに失敗: {type(e).__name__}: {e}")
    sys.exit(0)
