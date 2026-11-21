"""从 China Daily 选一篇当天时文。

流程：按栏目优先级抓列表页 → 抽出当天（含前 1–2 天，容错跨时区与凌晨运行）的
稿件链接 → 逐篇抓正文 → 质量门槛（正文词数、段落数、非视频/图集）→ 取第一篇合格的。

顺序是确定性的：同一份列表页会给同一篇文章，便于复现问题。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import timedelta

from . import config, htmltext, net

# 稿件链接：//www.chinadaily.com.cn/a/202611/21/WS6b00f9e4e4b03ebf8519dd22.html
_LINK_RE = re.compile(
    r"(?:https?:)?//(?:www\.)?chinadaily\.com\.cn/a/(\d{4})(\d{2})/(\d{2})/([A-Za-z0-9]+)\.html",
    re.I,
)

# 明显不是「一篇可读时文」的标题
_SKIP_TITLE_RE = re.compile(
    r"^\s*(\[)?(video|videos|photo|photos|graphic|graphics|infographic|live|highlights|podcast)\b",
    re.I,
)


class NoArticleError(RuntimeError):
    """今天没有可用稿件（全部候选不合格）。"""


@dataclass
class Article:
    url: str
    title: str
    body: str
    paragraphs: list[str]
    words: int
    published: str  # 稿件日期 YYYY-MM-DD（从 URL 取）
    probes: list[dict] = field(default_factory=list)


def _abs_url(matched: str) -> str:
    return "https://" + matched.split("//", 1)[-1]


def parse_links(html: str) -> list[tuple[str, str]]:
    """从列表页 HTML 里抽 [(url, 稿件日期)]，按出现顺序去重。"""
    out: list[tuple[str, str]] = []
    seen = set()
    for m in _LINK_RE.finditer(html or ""):
        url = _abs_url(m.group(0))
        if url in seen:
            continue
        seen.add(url)
        out.append((url, f"{m.group(1)}-{m.group(2)}-{m.group(3)}"))
    return out


def harvest_links(source: str, today) -> list[tuple[str, str]]:
    """抓一个列表页并解析出稿件链接。"""
    resp = net.get(source)
    if resp.status != 200:
        return []
    return parse_links(resp.text)


def collect_candidates(today, max_links: int = 40) -> list[tuple[str, str]]:
    """跨栏目收集候选 [(url, 稿件日期)]，只留今天与前一两天（避免拿旧文）。"""
    oldest = (today - timedelta(days=2)).date()
    newest = today.date()
    out: list[tuple[str, str]] = []
    seen = set()
    for source in config.ARTICLE_SOURCES:
        try:
            links = harvest_links(source, today)
        except net.NetworkError:
            continue
        for url, pub in links:
            try:
                y, m, d = (int(x) for x in pub.split("-"))
                pub_date = today.replace(year=y, month=m, day=d).date()
            except ValueError:
                continue
            if not (oldest <= pub_date <= newest):
                continue
            if url in seen:
                continue
            seen.add(url)
            out.append((url, pub))
            if len(out) >= max_links:
                return out
    return out


def fetch_article(url: str, published: str) -> Article:
    resp = net.get(url)
    if resp.status != 200:
        raise NoArticleError(f"稿件页返回 {resp.status}：{url}")
    parsed = htmltext.extract(resp.text)
    return Article(
        url=url,
        title=parsed["title"],
        body=parsed["body"],
        paragraphs=parsed["paragraphs"],
        words=parsed["words"],
        published=published,
    )


def pick(today, *, log=print, exclude: set | None = None) -> Article:
    """选出一篇合格稿件；都不合格时抛 NoArticleError 并带上诊断信息。

    exclude：已经试过的 URL（换稿重试时用）。
    """
    exclude = exclude or set()
    candidates = [c for c in collect_candidates(today) if c[0] not in exclude]
    if not candidates:
        raise NoArticleError("列表页没有抓到当天稿件链接（可能改版或被拦截，或候选都已试过）")

    # 优先当天稿件，其次前一天；同一天内保持列表页顺序（确定性）
    candidates = sorted(candidates, key=lambda item: item[1], reverse=True)

    probes: list[dict] = []
    for url, published in candidates[: config.MAX_ARTICLE_PROBES]:
        try:
            art = fetch_article(url, published)
        except (NoArticleError, net.NetworkError) as exc:
            probes.append({"url": url, "ok": False, "reason": str(exc)[:120]})
            continue

        reason = ""
        if _SKIP_TITLE_RE.search(art.title or ""):
            reason = "标题是视频/图集/直播类"
        elif art.words < config.MIN_BODY_WORDS:
            reason = f"正文过短（{art.words} 词）"
        elif art.words > config.MAX_BODY_WORDS:
            reason = f"正文过长（{art.words} 词）"
        elif len(art.paragraphs) < config.MIN_PARAGRAPHS:
            reason = f"段落过少（{len(art.paragraphs)} 段）"
        elif not art.title:
            reason = "取不到标题"

        probes.append({"url": url, "ok": not reason, "reason": reason, "words": art.words})
        if reason:
            log(f"  跳过 {url}：{reason}")
            continue

        art.probes = probes
        return art

    raise NoArticleError(f"候选 {len(probes)} 篇均不合格：{probes}")
