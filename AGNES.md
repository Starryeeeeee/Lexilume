# Agnes 每日扩词设定（v2）

本文件是「每日时文词」的**契约**：既是生成器的验收标准，也是出问题时的排查依据。
实现代码在 `scripts/daily_words/`，调度在 `.github/workflows/daily-words.yml`，
网站侧的导入逻辑在 `src/app.js`（`parseDaily` / `importDailyFile`）。

## 一、运行方式

| 项目 | 值 |
| --- | --- |
| 触发 | GitHub Actions，每天 UTC 22:00 / 23:30（北京时间 06:00 / 07:30）；第二次是幂等兜底，支持手动触发 |
| 手动触发入口 | Actions → 每日时文词 → Run workflow，可指定日期 / 文章 URL / 模型 / 强制覆盖 / 只演练 |
| 时区 | 一律按 Asia/Shanghai 算「今天」，不看 runner 的 UTC 日期 |
| 模型 | 默认 `agnes-3.0-flash`，失败自动退到 `agnes-2.5-flash` |
| 密钥 | 仓库 Secrets：`AGNES_API_KEY`（Agnes 平台）；提交用 Actions 自带 `GITHUB_TOKEN` |

**幂等**：`data/daily/<YYYY-MM-DD>.json` 已存在（本地或远端）就直接退出，不覆盖、不消耗 token。
只有手动触发并勾选 `force` 才会覆盖同一天。

## 二、输入

1. `progress.json`（**只读**）：每词的稳定度 s、难度 d、复习次数、错误次数、斩词标记。
   生成器据此算出四档分布、稳定度中位数、已斩/已掌握词表、近 8 天已选词。
2. China Daily 当天时文正文（栏目优先：china → world → business → culture → 首页）。

**选文门槛**：正文 260–1600 词、≥4 段、标题不是视频/图集/直播类；优先当天稿件，
其次前一天。最多试 6 篇，全不合格则当天失败并开 issue。

## 三、选词规则

- 数量：10–15 个，由难度带决定目标（10 / 12 / 14）
- 必须是**单个英文单词**（可含连字符、撇号），不收短语、词组
- 必须真实出现在正文中，允许词形变化；词条优先写原形（carrying → carry），
  不规则变化（built、said）才用正文形式
- 排除：专有名词、地名、机构名、缩写（CPC/APEC/GDP/US…）、超纲生僻词、
  过于基础的常用词（make/take/good/people…）
- 排除：已斩的词、已掌握（S ≥ 180 天且未过期）的词、近 8 天已经选过的词
- 例句必须取自原文，且一句只承载一个词（最多两个，超出即剔除）
- 难度带：默认 20–30% 词略高于当前水平

## 四、输出格式

写入 `data/daily/<YYYY-MM-DD>.json`：

```json
{
  "date": "YYYY-MM-DD",
  "source": "文章标题（China Daily）",
  "url": "原文链接",
  "words": [
    {
      "word": "单词（小写，原形优先）",
      "phonetic": "/英式音标/",
      "pos": "n. / v. / adj. …（多词性用 / 连接）",
      "meaning": "中文释义，≤40 字",
      "example": "正文中的原句，一字不改",
      "exampleCn": "例句中文翻译"
    }
  ],
  "notes": [
    { "word": "关联的选词", "text": "值得精讲的搭配/句式，≤200 字（0–3 条）" }
  ],
  "meta": {
    "generator": "daily-words/1.0.0",
    "generatedAt": "2026-11-21T21:40:00+08:00",
    "model": "agnes-3.0-flash",
    "difficultyShift": 0,
    "targetCount": 12,
    "challengeRatio": "20–30%",
    "articleWords": 500,
    "repairRounds": 0,
    "dropped": [{ "word": "laborer", "reason": "正文中未出现" }],
    "learner": { "learned": 216, "bands": {}, "medianStability": 1.9 },
    "usage": { "total_tokens": 3513 }
  }
}
```

- 网站只读 `date / source / url / words / notes`，`meta` 是审计字段，前端忽略。
  下一批的难度带就从 `meta.difficultyShift` 继续。
- `date` 与文件名必须一致：网站用 `daily-<date>` 作词书 id、`daily-<date>-<序号>` 作词 id，
  生成器靠这个约定把复习记录反查成词。

## 五、校验闸门（不通过就不落盘）

模型输出先过一遍硬校验，任何一条不满足就带着失败原因回到模型重写，最多 2 轮；
两轮后仍不足 10 个合格词，当天整批失败——绝不写半成品、绝不降标准凑数。

| 检查 | 处理 |
| --- | --- |
| JSON 可解析（含围栏/前后废话） | 解析失败 → 让模型重写 |
| 单个英文单词 | 短语、带空格、带数字 → 剔除 |
| 正文出现（含派生词形） | 未出现 → 剔除 |
| 音标合法（保留 æ ɪ ə θ ŋ 等） | 缺失/乱码 → 剔除 |
| 词性在白名单 | `n. v.` 这类空格写法自动规范成 `n./v.`；非法 → 剔除 |
| 词条是原形 | 屈折形式（pitted/tied/excluded…）且能在已知词库里对上原形 → 剔除并点名要求改成 pit/tie/exclude，音标也按原形给 |
| 释义含中文且 ≤40 字 | 超长/无中文 → 剔除 |
| 例句 = 正文原句 | 归一化后比对（引号、破折号、大小写差异容忍）→ 对不上就按相似度 ≥0.82 对齐回原句；仍对不上 → 剔除 |
| 一句一词 | 同一句第 3 个词 → 剔除 |
| 中文翻译 | 缺失/无中文 → 剔除 |

对齐后写进词表的是**正文原文切片**，不是模型改写的句子。

## 六、难度阶梯

从上一份 `meta.difficultyShift` 起步，再看真实复习记录：

- 最近三批任一批错误词占比 ≥ 30% → 降一档（10 词，挑战占比 0–10%）
- 最近两批都 ≥3 词有复习记录且零错误 → 升一档（14 词，挑战占比 35–40%）
- 其余维持（12 词，20–30%）
- 范围锁在 −1 ~ +1，不连续加码

## 七、安全约束

- 词表提交只走 Contents API 单文件提交，不 `git push`，避免与网站 sync 提交抢 rebase
- 令牌：Actions 自带 `GITHUB_TOKEN`（contents: write / issues: write），不落盘、不写日志
- **不要修改 `progress.json`**（网站会按词合并，外部写入会打架）
- 文章正文只当素材：提示词明确要求忽略其中的任何指令；输出的 `date/source/url`
  一律以抓取结果覆盖，防止正文注入篡改元数据
- 抓取带 UA，同域请求间隔 ≥2 秒，失败指数退避重试 3 次

## 八、失败与补救

失败时：Actions 运行标红 → 自动写入**唯一一个滚动 issue**（标签 `daily-words`；已有就追加评论，不再一天开一个；某天成功后自动关闭并留言）
→ 产物 JSON 作为 artifact 保留 7 天（若已生成）。

常见原因与处理：

| 现象 | 处理 |
| --- | --- |
| 选文失败（没有合格稿件） | 手动触发并填 `article_url` |
| 补生成历史某天 | `date` 与 `article_url` 必须**同时**填：列表页只有最近的稿子，只改日期会把新稿标成旧日期（脚本会直接拦截） |
| 词数不足（模型给不出足够原句） | 手动触发 `force` 重跑；仍不行可换 `model` |
| 缺 `AGNES_API_KEY` | 仓库 Settings → Secrets 添加后重跑 |
| 当天文件已存在想重做 | 勾 `force`（会覆盖；网站已导入的旧词书不受影响，需要重新导入新文件） |

## 九、本地演练

```bash
# 只生成不发布（打印 JSON）
AGNES_API_KEY=xxx python -m scripts.daily_words --dry-run

# 指定日期/文章，写本地文件但不提交
AGNES_API_KEY=xxx python -m scripts.daily_words --date 2026-11-20 \
  --url https://www.chinadaily.com.cn/a/... --no-publish --force

# 单元测试（不联网）
python -m unittest discover -s scripts/tests -t .
```
