"""契约校验与本地修复。

模型输出不直接落盘：先逐条对齐 AGNES.md 的硬约束，能在本地安全修的就修
（音标补斜杠、词性补点、例句对齐回原文原句），修不了的形成 errors 交给修复轮；
仍然不合格就整批失败，绝不写出半成品。

例句校验是整套质量闸门的核心：模型给的句子必须能在正文里找到，找不到就按相似度
对齐回正文原句，输出永远是原文文本。这一条同时挡住了模型编造例句和正文里夹带的
提示注入（伪造的"指令"不会成为词表内容）。

比对前做统一归一化（大小写、引号形态、破折号、空白），但对齐后返回的是**原文切片**，
所以词表里看到的引号仍是原文的引号，不是模型改写过的。
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass, field

from . import config

_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
_WORD_RE = re.compile(r"^[a-z][a-z'\-]{2,29}$")
# 句子切分：句号/问号/感叹号后接空白与一个大写或引号开头的字符
_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[]?[A-Z0-9])")
_TOKEN_RE = re.compile(r"[a-z][a-z'\-]*")

# 比对待丢弃：所有引号（单双、直弯）
_DROP_CHARS = set('"\'\u2018\u2019\u201c\u201d\u300c\u300d')
_PUNCT_MAP = str.maketrans({
    "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u00a0": " ",
    "\u3002": ".", "\uff0c": ",", "\u2026": "...",
})

# 例句相似度门槛：低于此值认为模型在编句子，宁可整批失败
SENTENCE_MATCH_THRESHOLD = 0.82
# 同一条原句最多承载几个选词。模型很爱从一条长句里抠两三个词，
# 卡死到 1 会让整批反复不过；2 是可接受的折中，提示词里仍要求尽量一句一词。
MAX_WORDS_PER_EXAMPLE = 2


def compare_norm(text: str) -> str:
    """用于比对的归一化：小写、去引号、统一破折号、折叠空白。"""
    if not text:
        return ""
    text = text.translate(_PUNCT_MAP)
    out = []
    prev_space = False
    for ch in text:
        if ch in _DROP_CHARS:
            continue
        if ch.isspace():
            if prev_space:
                continue
            out.append(" ")
            prev_space = True
            continue
        out.append(ch.lower())
        prev_space = False
    return "".join(out).strip()


def norm_space(text: str) -> str:
    """展示用的归一化：只统一空白与破折号，不改引号。"""
    text = (text or "").translate(_PUNCT_MAP)
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class BodyIndex:
    """正文的可搜索索引：归一化串 + 回指原文的位置表 + 句子表。"""

    orig: str
    norm: str
    pos_map: list[int]
    sentences: list[tuple[str, str]]  # (原文句, 归一化句)
    _forms: dict = field(default_factory=dict)

    @classmethod
    def build(cls, body: str) -> "BodyIndex":
        norm_chars: list[str] = []
        pos_map: list[int] = []
        prev_space = False
        for i, ch in enumerate(body):
            c = ch.translate(_PUNCT_MAP)
            if len(c) != 1:
                c = c[0] if c else " "
            if c in _DROP_CHARS:
                continue
            if c.isspace():
                if prev_space:
                    continue
                norm_chars.append(" ")
                pos_map.append(i)
                prev_space = True
                continue
            norm_chars.append(c.lower())
            pos_map.append(i)
            prev_space = False

        sentences = []
        for raw in _SENT_SPLIT_RE.split(norm_space(body)):
            raw = raw.strip()
            if raw:
                sentences.append((raw, compare_norm(raw)))
        return cls(orig=body, norm="".join(norm_chars).strip(), pos_map=pos_map, sentences=sentences)

    # ------------------------------------------------------------ 词形

    def find_form(self, word: str) -> str | None:
        """在正文里找该词（含常见派生词形），返回命中的实际形式。"""
        if word in self._forms:
            return self._forms[word]
        patterns = _family(word)
        if patterns:
            rx = re.compile(r"\b(?:" + "|".join(sorted(patterns, key=len, reverse=True)) + r")\b")
            m = rx.search(self.norm)
            hit = m.group(0) if m else None
        else:
            hit = None
        self._forms[word] = hit
        return hit

    # ------------------------------------------------------------ 例句

    def exact_original(self, text: str) -> str | None:
        """归一化后是正文子串时，返回对应的原文切片。"""
        needle = compare_norm(text)
        if len(needle) < 8:
            return None
        start = self.norm.find(needle)
        if start < 0:
            return None
        end = start + len(needle) - 1
        if end >= len(self.pos_map):
            return None
        return self.orig[self.pos_map[start]: self.pos_map[end] + 1].strip()

    def best_sentence(self, form: str, example: str) -> tuple[str, float] | None:
        """按相似度找回正文原句；只在该原句确实包含该词形时才算数。"""
        needle = compare_norm(example)
        best, best_ratio = None, 0.0
        for raw, norm_sent in self.sentences:
            if not re.search(r"\b" + re.escape(form), norm_sent):
                continue
            ratio = difflib.SequenceMatcher(None, needle, norm_sent).ratio()
            if ratio > best_ratio:
                best, best_ratio = raw, ratio
        if best and best_ratio >= SENTENCE_MATCH_THRESHOLD:
            return best, best_ratio
        return None

    def snap_to_sentence(self, text: str) -> str:
        """把可能是半句、或跨句的片段，扩到包含它的完整原句。"""
        needle = compare_norm(text)
        if not needle:
            return text
        for raw, norm_sent in self.sentences:
            if needle in norm_sent:
                return raw
        return text


_SUFFIXES = (
    "s", "es", "ed", "d", "ing", "ly", "er", "est", "ies", "ied", "ier", "iest",
    "ily", "ness", "ment", "ments", "ion", "ions", "al", "ally", "ive", "ives",
    "ous", "ious", "ance", "ence", "able", "ible", "ation", "ations", "ic",
)


def _family(word: str) -> set[str]:
    """生成该词的常见派生形式集合，只覆盖真实存在的构词规律。"""
    w = compare_norm(word).replace(" ", "")
    if not w:
        return set()
    forms = {w}
    forms.update(w + s for s in _SUFFIXES)
    # 以 e 结尾：去 e 再加后缀（promote → promoting / promotion）
    if w.endswith("e") and len(w) > 3:
        stem = w[:-1]
        forms.update(stem + s for s in _SUFFIXES)
    # 以 y 结尾：y → i（harmony → harmonious / policies）
    if w.endswith("y") and len(w) > 3:
        stem = w[:-1]
        forms.update(stem + s for s in ("ies", "ied", "ier", "iest", "ily", "ous", "ious", "ation", "able"))
    # 双写末尾辅音（prefer → preferred）
    if len(w) >= 3 and w[-1] not in "aeiou" and w[-1].isalpha():
        forms.update(w + w[-1] + s for s in ("ed", "ing", "er", "est"))
    return {f for f in forms if len(f) >= 3}


# ------------------------------------------------------------------ 字段归一化


def _has_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text or ""))


def _norm_phonetic(raw: str) -> str | None:
    s = norm_space(str(raw or ""))
    if not s:
        return None
    s = s.strip("[]{}").strip("/").strip()
    if not s or _has_cjk(s) or re.search(r"\d", s):
        return None
    # 按 Unicode 类别白名单过滤：保留所有字母（含 æ ɪ ə θ ŋ 等 IPA 符号）
    # 与修饰符号（ˈ ˌ ː），丢掉模型夹带的说明文字与杂字符
    s = "".join(
        ch for ch in s
        if ch in " .-()" or unicodedata.category(ch)[0] in ("L", "M")
    )
    s = norm_space(s)
    if len(s) < 2 or len(s) > 60:
        return None
    return f"/{s}/"


def _norm_pos(raw: str) -> str | None:
    s = norm_space(str(raw or "")).lower()
    if not s:
        return None
    out: list[str] = []
    # 模型常写成 "n. v." / "adj. adv."，空格也要当分隔符
    for p in re.split(r"[\s/&,;、|]+", s):
        p = p.replace("．", ".").strip()
        if not p:
            continue
        if not p.endswith("."):
            p += "."
        if p not in config.ALLOWED_POS:
            return None
        if p not in out:
            out.append(p)
    return "/".join(out) if out else None


def _norm_meaning(raw: str) -> str | None:
    s = norm_space(str(raw or "")).strip("；;，,。. ")
    if not s or not _has_cjk(s) or len(s) > config.MEANING_MAX:
        return None
    # 中文释义的标点统一：并列用顿号，分隔用分号，省略号用中文形式
    s = re.sub(r"(?<=[\u4e00-\u9fff]),(?=[\u4e00-\u9fff])", "、", s)
    s = re.sub(r"(?<=[\u4e00-\u9fff]);", "；", s)
    s = re.sub(r"(?<=[\u4e00-\u9fff])\.$", "", s)
    s = s.replace("......", "……").replace("...", "……")
    return s.strip()


def _norm_note_text(raw: str) -> str | None:
    s = norm_space(str(raw or ""))
    if len(s) < 6 or len(s) > config.NOTE_MAX_CHARS:
        return None
    return s


# ------------------------------------------------------------------ 主校验


@dataclass
class Validation:
    book: dict | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    dropped: list[dict] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.book is not None and not self.errors


def _single_sentence(text: str, form: str) -> str:
    """契约要求「一整句」：模型给跨两句时，取包含该词的那一句。"""
    parts = [p.strip() for p in _SENT_SPLIT_RE.split(text) if p.strip()]
    if len(parts) <= 1:
        return text
    for part in parts:
        if re.search(r"\b" + re.escape(form), compare_norm(part)):
            return part
    return parts[0]


def _drop(dropped: list[dict], word: str, reason: str) -> None:
    dropped.append({"word": word, "reason": reason})


def validate_words(
    raw_words,
    index: BodyIndex,
    *,
    count_min: int = config.WORDS_MIN,
    count_max: int = config.WORDS_MAX,
) -> tuple[list[dict], list[str], list[str], list[dict]]:
    words: list[dict] = []
    errors: list[str] = []
    warnings: list[str] = []
    dropped: list[dict] = []
    seen: set[str] = set()
    per_sentence: dict[str, int] = {}

    if not isinstance(raw_words, list):
        return [], ["words 字段不是数组"], warnings, dropped

    for i, entry in enumerate(raw_words):
        if not isinstance(entry, dict):
            _drop(dropped, f"#{i}", "条目不是对象")
            continue

        word = compare_norm(str(entry.get("word") or "")).strip(" .,;:'\"")
        if not word:
            _drop(dropped, f"#{i}", "word 为空")
            continue
        if not _WORD_RE.match(word):
            _drop(dropped, word, "不是单个英文单词（只能是字母、连字符、撇号）")
            continue
        if word in config.PROPER_NOUN_BLOCKLIST:
            _drop(dropped, word, "专名/缩写，按契约排除")
            continue
        if word in config.COMMON_WORD_BLOCKLIST:
            _drop(dropped, word, "过于基础的常用词，不值得占用名额")
            continue
        if word in seen:
            warnings.append(f"重复词已合并：{word}")
            continue

        form = index.find_form(word)
        if not form:
            _drop(dropped, word, "正文中未出现（含常见派生词形）")
            continue

        phonetic = _norm_phonetic(entry.get("phonetic"))
        if not phonetic:
            _drop(dropped, word, "音标缺失或不是合法 IPA")
            continue

        pos = _norm_pos(entry.get("pos"))
        if not pos:
            _drop(dropped, word, f"词性不在白名单：{entry.get('pos')!r}")
            continue

        meaning = _norm_meaning(entry.get("meaning"))
        if not meaning:
            raw_len = len(norm_space(str(entry.get("meaning") or "")))
            _drop(dropped, word, "释义为空、无中文" + (f"或超过 {config.MEANING_MAX} 字（{raw_len} 字）" if raw_len else ""))
            continue

        raw_example = norm_space(str(entry.get("example") or ""))
        example = index.exact_original(raw_example)
        matched_ratio = 1.0
        if example:
            example = index.snap_to_sentence(example)
        else:
            hit = index.best_sentence(form, raw_example)
            if not hit:
                _drop(dropped, word, "例句在正文中对不上（模型可能改写了句子）")
                continue
            example, matched_ratio = hit
        example = _single_sentence(example, form)
        if len(example) < config.EXAMPLE_MIN_CHARS:
            _drop(dropped, word, "例句过短")
            continue
        if len(example) > config.EXAMPLE_MAX_CHARS:
            _drop(dropped, word, "例句过长")
            continue

        key = example.lower()
        if per_sentence.get(key, 0) >= MAX_WORDS_PER_EXAMPLE:
            _drop(dropped, word, f"同一句已承载 {MAX_WORDS_PER_EXAMPLE} 个选词，避免例句重复")
            continue

        example_cn = norm_space(str(entry.get("exampleCn") or ""))
        if not example_cn or not _has_cjk(example_cn):
            _drop(dropped, word, "例句翻译缺失或无中文")
            continue

        if matched_ratio < 1.0:
            warnings.append(f"{word} 的例句按相似度 {matched_ratio:.2f} 对齐回原文原句")
        seen.add(word)
        per_sentence[key] = per_sentence.get(key, 0) + 1
        words.append({
            "word": word,
            "phonetic": phonetic,
            "pos": pos,
            "meaning": meaning,
            "example": example,
            "exampleCn": example_cn,
        })

    if len(words) > count_max:
        warnings.append(f"词数 {len(words)} 超出上限，截断到 {count_max}")
        words = words[:count_max]
    if len(words) < count_min:
        detail = "；".join(f"{d['word']}={d['reason']}" for d in dropped[:8]) or "无"
        errors.append(f"合格词数 {len(words)} 少于下限 {count_min}；被剔除：{detail}")
    return words, errors, warnings, dropped


def validate_notes(raw_notes, selected: list[str]) -> tuple[list[dict], list[str]]:
    notes: list[dict] = []
    warnings: list[str] = []
    if raw_notes is None:
        return notes, warnings
    if not isinstance(raw_notes, list):
        return notes, ["notes 不是数组，已忽略"]
    allow = set(selected)
    for item in raw_notes:
        if not isinstance(item, dict):
            continue
        word = compare_norm(str(item.get("word") or ""))
        text = _norm_note_text(item.get("text"))
        if word not in allow or not text:
            warnings.append(f"丢弃无效 notes 条目：{item!r}"[:160])
            continue
        notes.append({"word": word, "text": text})
        if len(notes) >= config.NOTE_MAX:
            break
    return notes, warnings


def validate(
    obj,
    *,
    body: str,
    date: str,
    source: str,
    url: str,
    count_min: int = config.WORDS_MIN,
    count_max: int = config.WORDS_MAX,
) -> Validation:
    """对模型整份输出做校验。date/source/url 一律以我方抓取结果为准，不信模型。"""
    result = Validation()
    if not isinstance(obj, dict):
        result.errors.append("输出不是 JSON 对象")
        return result

    index = BodyIndex.build(body)
    words, errors, warnings, dropped = validate_words(
        obj.get("words"), index, count_min=count_min, count_max=count_max,
    )
    result.errors.extend(errors)
    result.warnings.extend(warnings)
    result.dropped = dropped

    notes, note_warn = validate_notes(obj.get("notes"), [w["word"] for w in words])
    result.warnings.extend(note_warn)

    if result.errors:
        return result

    result.book = {
        "date": date,
        "source": norm_space(source),
        "url": url,
        "words": words,
        "notes": notes,
    }
    return result
