"""把 progress.json 翻译成「学情摘要」与「排除词表」。

两件事必须和前端严格一致，否则会选出学习者已经斩掉/已掌握的词：
1. 四档健康度的阈值（与 src/srs.js 的 healthOf 完全对齐）
2. 每日词书的 id 约定：`daily-<日期>` + `<书 id>-<序号>`（与 src/app.js 的 parseDaily 一致）

另外负责判断「难度带」是否该上调/下调：从历史每日文件读上一批的 meta.difficultyShift，
再结合这批词的真实遗忘情况（lapses）做 ±1 的微调。
"""

from __future__ import annotations

import json
import re
import shutil
import statistics
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import config

DAY_MS = 86400000.0
# 与 srs.js 一致的阈值
STABLE_FAMILIAR = 21.0
STABLE_MASTERED = 180.0
RISK_R = 0.75


# ------------------------------------------------------------------ 词 id 索引


def load_word_index(root: Path) -> dict[str, str]:
    """返回 {word_id: word}。没有 node 或词库缺失时返回空字典（降级，不报错）。"""
    node = shutil.which("node")
    if not node:
        return {}
    files = [str(root / f) for f in config.BOOKS_FILES if (root / f).exists()]
    if not files:
        return {}
    script = root / "scripts" / "daily_words" / "wordindex.mjs"
    try:
        proc = subprocess.run(
            [node, str(script), *files],
            capture_output=True,
            text=True,
            timeout=120,
            encoding="utf-8",
        )
    except (subprocess.SubprocessError, OSError):
        return {}
    if proc.returncode != 0 or not proc.stdout.strip():
        return {}
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {}
    index: dict[str, str] = {}
    for book in data.get("books", []):
        bid = book.get("id", "")
        for i, word in enumerate(book.get("words", [])):
            if word:
                index[f"{bid}-{i}"] = word
    return index


# ------------------------------------------------------------------ 健康度


def retrievability(s: float, last_ms: float, now_ms: float) -> float:
    if not s or s <= 0:
        return 0.0
    t = max(0.0, (now_ms - last_ms) / DAY_MS)
    return 1.0 / (1.0 + t / (9.0 * s))


def band_of(state: dict, now_ms: float) -> str:
    """复刻 srs.js healthOf：risk > learning > familiar > mastered。"""
    if not state:
        return "new"
    min_r, min_s = 1.0, float("inf")
    for key in ("r", "p"):
        ch = (state.get("ch") or {}).get(key)
        if not ch or not ch.get("n"):
            continue
        r = retrievability(float(ch.get("s") or 0), float(ch.get("last") or 0), now_ms)
        min_r = min(min_r, r)
        min_s = min(min_s, float(ch.get("s") or 0))
    if min_s == float("inf"):
        return "learning"
    if min_r < RISK_R:
        return "risk"
    if min_s < STABLE_FAMILIAR:
        return "learning"
    if min_s < STABLE_MASTERED:
        return "familiar"
    return "mastered"


# ------------------------------------------------------------------ 学情


@dataclass
class Profile:
    bands: dict = field(default_factory=lambda: {"learning": 0, "familiar": 0, "mastered": 0, "risk": 0})
    learned: int = 0
    median_s: float = 0.0
    cut: set = field(default_factory=set)
    mastered: set = field(default_factory=set)
    weak: list = field(default_factory=list)  # [(word, lapses)]
    active_days: int = 0

    def summary_cn(self) -> str:
        b = self.bands
        parts = [
            f"学习中 {b['learning']}", f"熟悉 {b['familiar']}",
            f"已掌握 {b['mastered']}", f"遗忘风险 {b['risk']}",
        ]
        line = "、".join(parts)
        if self.learned:
            line += f"；已学 {self.learned} 词，稳定度中位数约 {self.median_s:.0f} 天"
        else:
            line += "；尚无学习记录（新用户）"
        if self.cut:
            line += f"；已斩 {len(self.cut)} 词"
        return line


def load_progress(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def build_profile(progress: dict, index: dict[str, str], now_ms: float | None = None) -> Profile:
    now_ms = now_ms if now_ms is not None else time.time() * 1000
    prof = Profile()
    stabilities: list[float] = []
    for book_id, states in (progress.get("books") or {}).items():
        if not isinstance(states, dict):
            continue
        for wid, st in states.items():
            if not isinstance(st, dict):
                continue
            word = index.get(wid)
            band = band_of(st, now_ms)
            prof.learned += 1
            prof.bands[band] = prof.bands.get(band, 0) + 1
            if st.get("cut") and word:
                prof.cut.add(word.lower())
            if band == "mastered" and word:
                prof.mastered.add(word.lower())
            if int(st.get("lapses") or 0) >= 2 and word:
                prof.weak.append((word.lower(), int(st.get("lapses") or 0)))
            chs = [c for c in (st.get("ch") or {}).values() if c and c.get("n")]
            if chs:
                stabilities.append(min(float(c.get("s") or 0) for c in chs))
    if stabilities:
        prof.median_s = statistics.median(stabilities)
    prof.weak.sort(key=lambda x: (-x[1], x[0]))
    prof.weak = prof.weak[:20]

    logs = progress.get("log") or []
    if isinstance(logs, list):
        days = {str(x.get("d") or x.get("date") or "")[:10] for x in logs if isinstance(x, dict)}
        prof.active_days = len({d for d in days if d})
    return prof


# ------------------------------------------------------------------ 历史每日词


@dataclass
class DailyBatch:
    date: str
    words: list[str]
    shift: int
    seen: int = 0
    lapsed: int = 0

    @property
    def lapse_rate(self) -> float:
        return (self.lapsed / self.seen) if self.seen else 0.0


def read_daily_history(daily_dir: Path, progress: dict, limit: int = 10) -> list[DailyBatch]:
    """读最近 limit 份每日文件，并用 progress.json 里的真实复习记录统计表现。"""
    if not daily_dir.is_dir():
        return []
    files = sorted(daily_dir.glob("*.json"), key=lambda p: p.stem)[-limit:]
    books = progress.get("books") or {}
    out: list[DailyBatch] = []
    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        dates = str(data.get("date") or f.stem)[:10]
        words = [str(w.get("word", "")).lower() for w in (data.get("words") or []) if w.get("word")]
        meta = data.get("meta") or {}
        try:
            shift = int(meta.get("difficultyShift") or 0)
        except (TypeError, ValueError):
            shift = 0
        batch = DailyBatch(date=dates, words=words, shift=shift)
        states = books.get(f"daily-{dates}") or {}
        for i, _ in enumerate(words):
            st = states.get(f"daily-{dates}-{i}")
            if not st:
                continue
            reps = int(st.get("reps") or 0)
            if reps <= 0:
                continue
            batch.seen += 1
            if int(st.get("lapses") or 0) >= 1:
                batch.lapsed += 1
        out.append(batch)
    return out


def decide_ladder(history: list[DailyBatch]) -> tuple[int, int, str]:
    """返回 (shift, 目标词数, 挑战词比例说明)。

    规则（有界、可解释）：
    - 起点取上一批的 shift；没有历史则 0
    - 最近三批里，任一批错误词占比 >= 30%，或有两词以上错误 >= 2 次 → 降一档
    - 最近两批都有复习记录且零错误 → 升一档
    - 其余维持
    """
    shift = history[-1].shift if history else 0
    recent = [b for b in history if b.seen > 0][-3:]
    if not recent:
        return _clamp_shift(shift), _count_for(shift), _ratio_text(shift)

    heavy = any(b.lapse_rate >= 0.3 for b in recent)
    if heavy:
        shift -= 1
    else:
        last_two = recent[-2:]
        if len(last_two) >= 2 and all(b.lapse_rate == 0 and b.seen >= 3 for b in last_two):
            shift += 1
    shift = _clamp_shift(shift)
    return shift, _count_for(shift), _ratio_text(shift)


def _clamp_shift(shift: int) -> int:
    return max(-1, min(1, int(shift)))


def _count_for(shift: int) -> int:
    return { -1: 10, 0: 12, 1: 14 }.get(shift, 12)


def _ratio_text(shift: int) -> str:
    return {
        -1: "0–10%（本批以巩固为主）",
        0: "20–30%",
        1: "35–40%（可略超纲）",
    }.get(shift, "20–30%")


# ------------------------------------------------------------------ 排除词


_WORD_TAIL = r"(?:s|es|ed|d|ing|ly|er|est|ies)?"


def words_in_body(words, body: str) -> list[str]:
    """只保留确实出现在正文里的词，避免把几百个词塞进提示词。"""
    low = body.lower()
    hit = []
    for w in words:
        if not w:
            continue
        if re.search(r"\b" + re.escape(w) + _WORD_TAIL + r"\b", low):
            hit.append(w)
    return sorted(set(hit))


def build_exclusions(prof: Profile, history: list[DailyBatch], body: str) -> dict:
    """按「本次正文是否出现」过滤后的排除词表。"""
    recent_daily = {w for b in history[-8:] for w in b.words}
    return {
        "cut": words_in_body(prof.cut, body)[:40],
        "mastered": words_in_body(prof.mastered, body)[:60],
        "recent": words_in_body(recent_daily, body)[:40],
    }
