"""运行报告：GitHub Step Summary + 控制台摘要。"""

from __future__ import annotations

import os
from pathlib import Path

_STATUS = {
    "generated": "✅ 已生成",
    "exists": "⏭ 已存在，跳过",
    "exists-local": "⏭ 本地已存在，跳过",
    "no-article": "❌ 没有合格稿件",
    "short-article": "❌ 稿件过短",
    "llm-failed": "❌ 生成或校验失败",
    "publish-failed": "❌ 发布失败",
    "config-error": "⚠️ 配置缺失",
}


def build(ctx, failed: bool = False) -> str:
    info = ctx.info
    status = info.get("result", "unknown")
    title = _STATUS.get(status, status)
    if failed and status in _STATUS:
        title = _STATUS[status]

    lines = [f"## {title}", ""]
    lines.append(f"- 日期：`{info.get('date', '-')}`")
    if info.get("path"):
        lines.append(f"- 文件：`{info['path']}`")
    if info.get("words"):
        lines.append(f"- 词数：{len(info['words'])}")
        lines.append(f"- 选词：{', '.join(info['words'])}")
    pub = info.get("publish") or {}
    if pub:
        detail = pub.get("status", "")
        if pub.get("commit"):
            detail += f"（commit {str(pub['commit'])[:7]}）"
        lines.append(f"- 发布：{detail}")

    if ctx.lines:
        lines += ["", "<details><summary>运行日志</summary>", "", "```"]
        lines += ctx.lines[-40:]
        lines += ["```", "", "</details>"]

    return "\n".join(lines) + "\n"


def emit(ctx, root: Path, failed: bool = False) -> None:
    text = build(ctx, failed)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        try:
            with open(summary_path, "a", encoding="utf-8") as fh:
                fh.write(text)
        except OSError:
            pass
    # 控制台也留一份纯文本，便于本地跑时直接看
    print("\n==== 运行摘要 ====", flush=True)
    print(text, flush=True)
