"""全局配置与常量。

所有可调参数集中在这里，避免散落在各模块里。环境变量优先，缺省值面向
GitHub Actions 运行环境；本地手动跑时用命令行参数覆盖即可。
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

# 站点与词表契约的版本号，写进每份 JSON 的 meta，便于出问题时定位是哪代代码生成的
GENERATOR_VERSION = "1.0.0"

# 学习者所在时区。所有「今天」的判断都用它，不能用 runner 的 UTC 日期，
# 否则北京时间 06:00 跑出来会少算一天。
CN_TZ = timezone(timedelta(hours=8))

# ---------------------------------------------------------------- Agnes

AGNES_BASE = (os.environ.get("AGNES_BASE_URL") or "https://api.agnes-ai.cn/v1").rstrip("/")
# 首选 3.0（音标与释义质量更稳），失败时自动退到 2.5，避免某天模型抖动就断更
AGNES_MODEL = (os.environ.get("AGNES_MODEL") or "agnes-3.0-flash").strip()
AGNES_FALLBACK_MODEL = (os.environ.get("AGNES_FALLBACK_MODEL") or "agnes-2.5-flash").strip()
AGNES_API_KEY = (os.environ.get("AGNES_API_KEY") or "").strip()
AGNES_TIMEOUT = int(os.environ.get("AGNES_TIMEOUT") or 180)
AGNES_TEMPERATURE = 0.3
AGNES_MAX_TOKENS = 3200
# 契约校验不通过时，最多再让模型改几轮
MAX_REPAIR_ROUNDS = 2
# 网络/5xx 重试次数（与修复轮无关）
AGNES_NET_RETRIES = 3

# ---------------------------------------------------------------- GitHub

GITHUB_API = "https://api.github.com"
GITHUB_TOKEN = (os.environ.get("GITHUB_TOKEN") or "").strip()
GITHUB_REPOSITORY = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
GITHUB_BRANCH = (os.environ.get("GITHUB_REF_NAME") or "main").strip()

DAILY_DIR = "data/daily"
PROGRESS_PATH = "progress.json"
BOOKS_FILES = ("data/books.js", "data/books-generated.js")

# ---------------------------------------------------------------- 抓取

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
# 契约要求请求间隔 >= 2 秒，这里统一在 net 层限速
REQUEST_INTERVAL = 2.0
REQUEST_TIMEOUT = 30
REQUEST_RETRIES = 3

# 候选文章入口，按优先级排列：先要闻，再国际/财经/文化，最后首页兜底
ARTICLE_SOURCES = (
    "https://www.chinadaily.com.cn/china",
    "https://www.chinadaily.com.cn/world",
    "https://www.chinadaily.com.cn/business",
    "https://www.chinadaily.com.cn/culture",
    "https://www.chinadaily.com.cn/",
)
# 最多抓几篇候选正文（每篇间隔 2 秒，控制总耗时）
MAX_ARTICLE_PROBES = 6
# 正文长度门槛：太短撑不起 10 个词，太长会把 token 烧在无关内容上
MIN_BODY_WORDS = 260
MAX_BODY_WORDS = 1600
MIN_PARAGRAPHS = 4
# 送进模型的正文上限（字符）。正常新闻远低于此，仅防异常长文
MAX_BODY_CHARS = 9000

# ---------------------------------------------------------------- 选词契约

WORDS_MIN = 10
WORDS_MAX = 15
MEANING_MAX = 40
EXAMPLE_MIN_CHARS = 8
EXAMPLE_MAX_CHARS = 500
NOTE_MAX = 3
NOTE_MAX_CHARS = 200

# 词性白名单。模型常见的 vt./vi./phr. 都在里面；组合词性用 / 连接
ALLOWED_POS = {
    "n.", "v.", "vt.", "vi.", "adj.", "adv.", "prep.", "conj.",
    "pron.", "num.", "art.", "int.", "phr.", "aux.",
}

# 音标允许出现的字符：IPA 基本符号 + 重音符号 + 常见组合
IPA_CHARS = set("abdefhijklmnoprstuvwzæɑɒɔəɜɛɪʊʌʃʒθðŋɡɹɾʔˈˌː-()")

# 明显是专名/缩写的东西，即使正文里出现也不选
PROPER_NOUN_BLOCKLIST = {
    "cpc", "npc", "cppcc", "prc", "un", "who", "wto", "imf", "gdp", "covid",
    "apec", "brics", "asean", "g20", "bri", "ceo", "ai", "it", "us", "uk",
    "eu", "nato", "opec", "fbi", "cia", "nasa", "phd", "tv", "pc", "app",
    "january", "february", "march", "april", "june", "july", "august",
    "september", "october", "november", "december",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "china", "chinese", "beijing", "shanghai", "shenzhen", "guangdong",
    "hong", "kong", "macao", "taiwan", "tibet", "xinjiang",
}

# 过于基础的词，不值得占用每日 10–15 个名额（高二学生早已掌握）
COMMON_WORD_BLOCKLIST = {
    "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
    "for", "with", "by", "from", "as", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would", "can",
    "could", "may", "might", "must", "should", "this", "that", "these", "those",
    "it", "its", "he", "she", "they", "we", "you", "his", "her", "their", "our",
    "your", "not", "no", "yes", "more", "most", "very", "also", "even", "still",
    "just", "only", "all", "some", "any", "each", "every", "other", "another",
    "such", "than", "then", "so", "too", "much", "many", "few", "little", "big",
    "small", "good", "bad", "nice", "new", "old", "young", "make", "made", "take",
    "took", "get", "got", "give", "gave", "go", "went", "come", "came", "say",
    "said", "see", "saw", "look", "want", "need", "help", "use", "used", "find",
    "found", "know", "think", "work", "way", "ways", "thing", "things", "time",
    "times", "day", "days", "year", "years", "people", "person", "man", "men",
    "woman", "women", "child", "children", "world", "life", "today", "now",
}

# 正文抽取时要丢掉的样板段落（版权、编辑署名、相关阅读等）
BOILERPLATE_MARKERS = (
    "all rights reserved", "copyright", "editor:", "contact the writer",
    "follow us on", "scan the qr", "related reading", "most viewed",
    "please indicate the source", "chinadaily.com.cn",
)


def today_cn() -> "datetime":
    """北京时间当前时刻（带时区）。"""
    return datetime.now(tz=CN_TZ)


def parse_date(text: str) -> "datetime":
    """解析 YYYY-MM-DD，返回北京时间零点；非法输入直接抛 ValueError。"""
    d = datetime.strptime(text.strip(), "%Y-%m-%d")
    return d.replace(tzinfo=CN_TZ)
