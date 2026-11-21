"""HTML 正文抽取（标准库实现，不依赖 bs4）。

China Daily 的稿件正文放在 `<div id="Content">`，旧模板用 `<div class="main_art">`。
这里优先只在正文容器里取段落；容器缺失时退化为「全页段落 + 最长连续段」，
避免把导航、推荐位当成正文喂给模型。
"""

from __future__ import annotations

import html as html_lib
import re
from html.parser import HTMLParser

from . import config

_WS_RE = re.compile(r"[\s\u00a0\u3000]+")
_ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\ufeff"), None)

_SKIP_TAGS = {
    "script", "style", "noscript", "iframe", "figure", "aside",
    "nav", "footer", "header", "form", "svg", "video", "audio",
}

_CONTENT_IDS = {"content", "article", "artical", "articlebody", "article_body"}
_CONTENT_CLASS_HINTS = ("main_art", "article", "content", "detail")


def normalize_text(text: str) -> str:
    """折叠空白、去零宽字符，保留原始标点（后续校验要用原文比对）。"""
    if not text:
        return ""
    text = text.translate(_ZERO_WIDTH)
    text = html_lib.unescape(text)
    return _WS_RE.sub(" ", text).strip()


class _Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.div_depth = 0
        self.markers: list[int] = []
        self.skip = 0
        self.in_p = 0
        self.buf: list[str] = []
        self.paras: list[tuple[str, bool]] = []
        self.in_h1 = 0
        self.h1: list[str] = []
        self.in_title = 0
        self.title: list[str] = []

    @staticmethod
    def _is_content(attrs: list[tuple[str, str | None]]) -> bool:
        attr = {k.lower(): (v or "") for k, v in attrs}
        if attr.get("id", "").lower() in _CONTENT_IDS:
            return True
        cls = attr.get("class", "").lower()
        if any(h in cls for h in _CONTENT_CLASS_HINTS):
            # 只认 div 上的这些类名，且必须真的像正文容器
            return "main_art" in cls or cls.strip() in {"content", "article", "article-content"}
        return False

    def flush(self) -> None:
        """HTML 被截断时（未闭合的 <p>），把缓冲区里已有的文字收进来。"""
        if self.in_p and self.buf:
            text = normalize_text("".join(self.buf))
            if text:
                self.paras.append((text, bool(self.markers)))
            self.buf = []
            self.in_p = 0

    def handle_starttag(self, tag, attrs):
        if tag == "div":
            self.div_depth += 1
            if self._is_content(attrs):
                self.markers.append(self.div_depth)
        if tag in _SKIP_TAGS:
            self.skip += 1
        elif tag == "p":
            self.in_p += 1
            self.buf = []
        elif tag == "br" and self.in_p:
            self.buf.append(" ")
        elif tag == "h1":
            self.in_h1 += 1
        elif tag == "title":
            self.in_title += 1

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and self.in_p:
            self.buf.append(" ")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS:
            if self.skip:
                self.skip -= 1
        elif tag == "p":
            if self.in_p:
                self.in_p -= 1
                text = normalize_text("".join(self.buf))
                if text:
                    self.paras.append((text, bool(self.markers)))
                self.buf = []
        elif tag == "h1":
            if self.in_h1:
                self.in_h1 -= 1
        elif tag == "title":
            if self.in_title:
                self.in_title -= 1
        elif tag == "div":
            if self.markers and self.markers[-1] == self.div_depth:
                self.markers.pop()
            self.div_depth = max(0, self.div_depth - 1)

    def handle_data(self, data):
        if self.skip:
            return
        if self.in_p:
            self.buf.append(data)
        elif self.in_h1:
            self.h1.append(data)
        elif self.in_title:
            self.title.append(data)


def _is_boilerplate(text: str) -> bool:
    low = text.lower()
    if len(text) < 40:
        return True
    return any(m in low for m in config.BOILERPLATE_MARKERS)


def _clean_title(raw: str) -> str:
    title = normalize_text(raw)
    title = re.sub(r"\s*[-|–]\s*Chinadaily\.com\.cn\s*$", "", title, flags=re.I)
    title = re.sub(r"\s*\|.*$", "", title)
    return title.strip()


def _longest_run(paras: list[tuple[str, bool]]) -> list[str]:
    """没有正文容器时，取长度最长的一段连续合格段落。"""
    best: list[str] = []
    cur: list[str] = []
    for text, _ in paras:
        if _is_boilerplate(text):
            if len(cur) > len(best):
                best = cur
            cur = []
        else:
            cur.append(text)
    if len(cur) > len(best):
        best = cur
    return best


def extract(html: str) -> dict:
    """返回 {"title", "paragraphs", "body", "words", "used_content_div"}。"""
    parser = _Parser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        # 畸形 HTML 不该让整条链路挂掉，喂进去多少算多少
        pass
    finally:
        parser.flush()

    in_content = [t for t, flag in parser.paras if flag and not _is_boilerplate(t)]
    used_content_div = False
    if len(in_content) >= 3:
        paragraphs = in_content
        used_content_div = True
    else:
        paragraphs = _longest_run(parser.paras)
        if len(paragraphs) < config.MIN_PARAGRAPHS:
            # 最后兜底：所有像正文的段落（可能混入少量推荐位，靠后续长度门槛挡）
            paragraphs = [t for t, _ in parser.paras if not _is_boilerplate(t)]

    body = " ".join(paragraphs).strip()
    title = _clean_title("".join(parser.h1)) or _clean_title("".join(parser.title))
    return {
        "title": title,
        "paragraphs": paragraphs,
        "body": body,
        "words": len(body.split()),
        "used_content_div": used_content_div,
    }
