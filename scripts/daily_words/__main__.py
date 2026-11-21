"""每日时文词生成器。

流程（每一步失败都不会留下半成品文件）：
1. 幂等检查：远端已有当天文件就直接退出（先做这一步，省掉全部抓取与 token）
2. 读 progress.json → 学情摘要、已斩/已掌握/近 8 天已选 的排除词
3. 从 China Daily 选一篇当天时文（质量门槛：长度、段落数、非视频图集）
4. 调 Agnes 生成词表，逐条校验，不合格就带着错误清单让模型修（最多 2 轮）
5. 组装 JSON（附 meta 审计字段），本地留一份，再通过 Contents API 提交
6. 写 GitHub Step Summary；失败时开 issue 告警

退出码：0 成功或已存在；1 生成失败；2 配置缺失（需要人处理）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

from . import article as article_mod
from . import config, learner, llm, publish, report

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_CONFIG = 2


def _setup_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass


class Ctx:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self.info: dict = {}

    def log(self, msg: str) -> None:
        print(msg, flush=True)
        self.lines.append(msg)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="生成 Lexilume 每日时文词")
    p.add_argument("--date", help="目标日期 YYYY-MM-DD，默认北京时间今天")
    p.add_argument("--url", help="手动指定文章 URL（跳过选文，用于补救）")
    p.add_argument("--model", help="覆盖 Agnes 模型，如 agnes-3.0-flash")
    p.add_argument("--root", default=".", help="仓库根目录，默认当前目录")
    p.add_argument("--dry-run", action="store_true", help="只生成并打印，不写文件不发布")
    p.add_argument("--no-publish", action="store_true", help="写本地文件但不提交到仓库")
    p.add_argument("--force", action="store_true", help="允许覆盖已存在的当天文件")
    p.add_argument("--out", help="另外输出一份到指定路径（便于 debug）")
    p.add_argument("--offline-article", help="用本地 HTML 文件替代抓取（自测用）")
    return p.parse_args(argv)


def resolve_date(raw: str | None) -> str:
    if not raw:
        return config.today_cn().strftime("%Y-%m-%d")
    return config.parse_date(raw).strftime("%Y-%m-%d")


def article_from_file(path: str, url: str) -> article_mod.Article:
    from . import htmltext

    html = Path(path).read_text(encoding="utf-8", errors="replace")
    parsed = htmltext.extract(html)
    return article_mod.Article(
        url=url or "file://" + os.path.abspath(path),
        title=parsed["title"] or "（本地自测稿件）",
        body=parsed["body"],
        paragraphs=parsed["paragraphs"],
        words=parsed["words"],
        published="",
    )


def _choose_article(ctx, date_str: str, args, tried: list[str]) -> article_mod.Article:
    """选一篇稿件：本地文件 / 指定 URL / 自动挑选（跳过已试过的）。"""
    if args.offline_article:
        art = article_from_file(args.offline_article, args.url or "")
        ctx.log(f"使用本地稿件：{art.title}（{art.words} 词）")
    elif args.url:
        art = article_mod.fetch_article(args.url, "")
        ctx.log(f"使用指定稿件：{art.title}（{art.words} 词）")
    else:
        art = article_mod.pick(config.parse_date(date_str), log=ctx.log, exclude=set(tried))
        ctx.log(f"选中：{art.title}（{art.words} 词）\n  {art.url}")

    if art.words < config.MIN_BODY_WORDS:
        raise article_mod.NoArticleError(f"稿件过短（{art.words} 词）：{art.url}")
    return art


def _generate_with_models(ctx, art, profile, exclusions, date_str, count, ratio_text, args):
    """先用首选模型，失败再退到备用模型；两者都失败才抛异常。"""
    def run(client):
        return llm.select_words(
            client, art, profile, exclusions,
            date=date_str, count=count, ratio_text=ratio_text, log=ctx.log,
        )

    client = llm.AgnesClient(model=args.model)
    fallback = config.AGNES_FALLBACK_MODEL
    try:
        return client, run(client)
    except Exception as exc:  # noqa: BLE001
        if os.environ.get("DW_DEBUG"):
            ctx.log(traceback.format_exc())
        if not fallback or fallback == client.model:
            raise
        ctx.log(f"{client.model} 失败（{str(exc)[:200]}），改用备用模型 {fallback} 再试一次")

    client = llm.AgnesClient(model=fallback)
    try:
        return client, run(client)
    except Exception as exc2:  # noqa: BLE001
        if os.environ.get("DW_DEBUG"):
            ctx.log(traceback.format_exc())
        raise llm.AgnesError(f"{client.model} 仍失败：{exc2}") from exc2


def main(argv=None) -> int:
    _setup_stdout()
    args = parse_args(argv)
    ctx = Ctx()
    root = Path(args.root).resolve()
    date = resolve_date(args.date)
    rel_path = f"{config.DAILY_DIR}/{date}.json"
    local_path = root / rel_path

    ctx.info["date"] = date
    ctx.info["path"] = rel_path
    ctx.log(f"目标文件 {rel_path}（模型 {args.model or config.AGNES_MODEL}）")

    repo_ready = bool(config.GITHUB_TOKEN and config.GITHUB_REPOSITORY)
    publish_enabled = repo_ready and not args.dry_run and not args.no_publish

    # 补历史日期必须指定文章：列表页只有最近的稿子，否则会把今天的文章标成过去某天
    real_today = config.today_cn().strftime("%Y-%m-%d")
    if date != real_today and not (args.url or args.offline_article):
        ctx.log(f"{date} 不是今天（{real_today}），补生成历史日期必须同时指定 --url，避免把新稿标成旧日期")
        ctx.info["result"] = "config-error"
        report.emit(ctx, root, failed=True)
        return EXIT_CONFIG

    # ---------------------------------------------------------- 1. 幂等
    try:
        if repo_ready:
            sha = publish.get_file_sha(rel_path)
            if sha and not args.force:
                ctx.log(f"远端已存在 {rel_path}，跳过（幂等）")
                ctx.info["result"] = "exists"
                report.emit(ctx, root)
                return EXIT_OK
    except (publish.PublishError, Exception) as exc:  # noqa: BLE001
        ctx.log(f"幂等检查失败，继续尝试生成：{exc}")

    if local_path.exists() and not args.force and not args.dry_run:
        ctx.log(f"本地已存在 {rel_path}，跳过（如需重生成加 --force）")
        ctx.info["result"] = "exists-local"
        report.emit(ctx, root)
        return EXIT_OK

    if not (args.offline_article or args.url):
        if not config.AGNES_API_KEY:
            ctx.log("配置缺失：没有 AGNES_API_KEY（仓库 Settings → Secrets 里加一个）")
            ctx.info["result"] = "config-error"
            report.emit(ctx, root, failed=True)
            _notify_failure(date, "\n".join(ctx.lines), root)
            return EXIT_CONFIG

    # ---------------------------------------------------------- 2. 学情
    progress = learner.load_progress(root / config.PROGRESS_PATH)
    index = learner.load_word_index(root)
    now_ms = config.today_cn().timestamp() * 1000
    profile = learner.build_profile(progress, index, now_ms)
    history = learner.read_daily_history(root / config.DAILY_DIR, progress)
    shift, count, ratio_text = learner.decide_ladder(history)
    ctx.log(f"学情：{profile.summary_cn()}")
    ctx.log(f"历史批次 {len(history)} 份，难度带 shift={shift}，目标 {count} 词，挑战占比 {ratio_text}")
    if not index:
        ctx.log("提示：拿不到词 id 索引（node 缺失或词库不可读），已斩/已掌握排除会降级")

    # ---------------------------------------------------------- 3/4/5. 选文 → 排除 → 生成
    def fail(reason: str, status: str = "llm-failed") -> int:
        ctx.log(f"生成失败：{reason}")
        ctx.info["result"] = status
        report.emit(ctx, root, failed=True)
        _notify_failure(date, "\n".join(ctx.lines), root)
        return EXIT_FAIL

    max_rounds = 1 if (args.url or args.offline_article) else 2
    tried: list[str] = []
    selection = None
    client = None
    art = None
    exclusions: dict = {}

    for round_no in range(1, max_rounds + 1):
        try:
            art = _choose_article(ctx, date, args, tried)
        except Exception as exc:  # noqa: BLE001
            ctx.log(f"选文失败：{exc}")
            return fail(str(exc), status="no-article")
        tried.append(art.url)

        exclusions = learner.build_exclusions(profile, history, art.body)
        ctx.log(
            "排除词（仅统计正文中出现的）：已斩 {} / 已掌握 {} / 近期 {}".format(
                len(exclusions["cut"]), len(exclusions["mastered"]), len(exclusions["recent"])
            )
        )

        try:
            client, selection = _generate_with_models(
                ctx, art, profile, exclusions, date, count, ratio_text, args
            )
            break
        except Exception as exc:  # noqa: BLE001
            ctx.log(f"第 {round_no} 篇稿件生成失败：{exc}")
            if round_no >= max_rounds:
                return fail(f"{round_no} 篇稿件都没能产出合格词表：{exc}")
            ctx.log("换一篇稿件再试（同一篇重试大概率还是同样的结果）")

    if selection is None or client is None or art is None:
        return fail("没有可用词表")

    # ---------------------------------------------------------- 6. 组装
    book = selection.book
    payload = dict(book)
    payload["meta"] = {
        "generator": f"daily-words/{config.GENERATOR_VERSION}",
        "generatedAt": config.today_cn().isoformat(timespec="seconds"),
        "model": client.model,
        "difficultyShift": shift,
        "targetCount": count,
        "challengeRatio": ratio_text,
        "articleWords": art.words,
        "articlePublished": art.published,
        "attemptedArticles": tried,
        "probes": len(art.probes) or None,
        "repairRounds": max(0, len(selection.attempts) - 1),
        "usage": selection.usage or None,
        "learner": {
            "learned": profile.learned,
            "bands": profile.bands,
            "medianStability": round(profile.median_s, 1),
            "cut": len(profile.cut),
        },
        "exclusions": {k: len(v) for k, v in exclusions.items()},
        "dropped": selection.dropped[:20],
        "warnings": selection.warnings[:20],
    }
    content = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    ctx.info["words"] = [w["word"] for w in book["words"]]
    ctx.info["result"] = "generated"

    if args.dry_run:
        ctx.log("---- dry-run 输出 ----")
        print(content)
        report.emit(ctx, root)
        return EXIT_OK

    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_text(content, encoding="utf-8")
    ctx.log(f"已写入本地 {rel_path}（{len(book['words'])} 词）")

    if args.out:
        Path(args.out).write_text(content, encoding="utf-8")

    # ---------------------------------------------------------- 7. 发布
    if publish_enabled:
        try:
            result = publish.put_file(
                rel_path,
                content.encode("utf-8"),
                f"daily: {date} 时文词（{len(book['words'])} 词）",
                force=args.force,
            )
            ctx.info["publish"] = result
            if result["status"] == "exists":
                ctx.log("远端已有同名文件（并发写入），视为成功")
            else:
                ctx.log(f"已提交到仓库：{result['status']} commit={result.get('commit', '')[:7]}")
        except Exception as exc:  # noqa: BLE001
            ctx.log(f"发布失败：{exc}")
            ctx.info["result"] = "publish-failed"
            report.emit(ctx, root, failed=True)
            _notify_failure(date, "\n".join(ctx.lines), root)
            return EXIT_FAIL
    else:
        ctx.log("未配置 GitHub token 或已禁用发布：仅保留本地文件")
        ctx.info["publish"] = {"status": "skipped"}

    report.emit(ctx, root)
    return EXIT_OK


def _notify_failure(date: str, log_text: str, root: Path) -> None:
    if not (config.GITHUB_TOKEN and config.GITHUB_REPOSITORY):
        return
    run_url = ""
    server = os.environ.get("GITHUB_SERVER_URL")
    repo = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    if server and repo and run_id:
        run_url = f"{server}/{repo}/actions/runs/{run_id}"
    body = (
        f"日期：{date}\n\n```\n{log_text[-2500:]}\n```\n"
        + (f"\n运行日志：{run_url}\n" if run_url else "")
        + "\n处理方式：在 Actions 里手动触发 `每日时文词`，可指定 `article_url` 或 `force` 重试。\n"
    )
    msg = publish.open_failure_issue(f"[daily] {date} 时文词生成失败", body)
    print(f"告警：{msg}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
