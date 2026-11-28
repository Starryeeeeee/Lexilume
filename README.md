# Lexilume（词律）

一个可自行部署的单词学习网站：按记忆曲线调度复习，学习流程对标百词斩。纯静态、零构建、零依赖（前端无 npm、无框架、无后端），数据存在浏览器本地，用 GitHub 仓库里的一个 JSON 做跨设备同步。

- 线上：https://starryeeeeee.github.io/Lexilume/
- 仓库：`Starryeeeeee/Lexilume`（Pages 从 `main` 根目录发布）
- 本地目录：`C:\Users\Win10\Desktop\lexilume`

## 快速上手

```bash
# 本地预览（不要直接双击 file://，登录门与同步需要 http）
python -m http.server 8000     # 然后开 http://localhost:8000

# 改完必跑：核心逻辑自检（68 项，纯 Node，不需要浏览器）
node tools/selftest.js

# 每日时文词生成器的单元测试
python -m unittest discover -s scripts/tests -t .
```

部署：改完推 `main` 即可，GitHub Pages 约一分钟自动发布。若改动了 `sw.js` 或任何被 SW 缓存的静态资源，**必须把 `sw.js` 里的 `CACHE` 版本号 +1**，否则用户拿到的还是旧代码（这条踩过两次）。

## 功能现状（2026-11-28）

| 模块 | 说明 |
|---|---|
| 调度 | 简化 FSRS：每词维护难度 D、稳定度 S，`R = 1/(1 + t/9S)`；目标保留率 90% 时下次复习 = `上次 + S 天`；答错缩水不清零。双通道：认词 `r` / 产出 `p`，按 `weakestChannel` 挑更弱的出题 |
| 学习流程 | 复习到期词 → 新学（看一张卡 → 立刻测该词的看词选义）→ 拼写环节（**复习过的词与新学的词都进队列**，可跳过；拼错就地重拼、纠正后重排确认） |
| 题型 | 看词选义、看义选词（设置里可切换）；拼写在拼写环节；听音辨义、语境填词已留接口未启用 |
| 练习模式 | 首页入口，抽 10 个已学词；范围（全部/错词/风险词）与题型各一档；错题排队尾直到答对；**不动调度**，计入练习量与连续天数 |
| 考前冲刺 | 首页入口，范围未来 7/14/30 天到期或全部已学，按到期紧迫排序，一轮上限 60；**答对不动调度**（避免虚抬间隔），**答错写遗忘记录**；可斩词 |
| 斩词 | 学习卡、复习、练习、拼写、冲刺都能斩；调度/预测/练习池全部跳过；统计页可恢复 |
| 激励 | 首页今日完成度圆环（已学 ÷ 今日计划）；连胜保护（完成当日目标得一枚，上限 2，漏卡自动补并提示） |
| 统计 | 累计（新学/复习/练习/天数/用时）、掌握分布、30 天复习负载、24 周热力图、遗忘风险、错词本、已斩；可导出 Markdown 报告 |
| 其他 | 断点续学（会话快照）、登录门（Fine-grained token）、跨设备同步、备份导出/恢复、自建词书、CSV 导入、PWA 离线 |
| 每日时文词 | GitHub Actions 定时抓 China Daily → Agnes 选词 → 校验后写 `data/daily/*.json`，网站自动并入《时文积累》词书 |
| 查词 | Agnes 讲解 + 收藏到「我的积累」；密钥只存本机（`cfg.lookupKey`），不进备份、不同步 |

## 架构

```
src/srs.js    调度内核：纯函数，无 DOM、无存储依赖（最容易写测试的一层）
src/store.js  localStorage 封装 + 日志 + 连胜保护 + 备份恢复 + 自建词书
src/quiz.js   题型生成与通道映射（build / chooseType / speak）
src/sync.js   GitHub Contents API 读写 + 合并 + 无变化跳过
src/app.js    视图与会话状态机（3400+ 行，所有 UI 与流程都在这里）
data/         词库（books.js 手工三本 / books-generated.js 三本大书，勿手改）
scripts/      每日时文词生成器（Python 标准库，无依赖）
```

数据全部在 `localStorage`，键前缀 `wl.`：进度 `wl.progress.v1.<bookId>`、日志 `wl.log.v1`、配置 `wl.config.v1`、同步凭证 `wl.sync.v1`、会话快照 `wl.session.v1`。

### 会话状态机（改流程前必读）

`S.session.phase` 的取值与流转：

```
review ──队列空──▶ learn（有 new）──▶ quiz ──▶ spellask ──▶ spell ──▶ done
   │                    └──无 new──▶ spellask ──▶ done
   └── 模式 'new' 时跳过 review
practice（首页进入）──▶ done
sprint（首页进入）──▶ done
```

- `cur.from` 决定题型与记账：`review` / `new` / `practice` / `sprint` / `spell`
- 每个 phase 结束走 `queueDrained()` 分流，不要把跳转写死在题目里
- 会话快照 `render()` 时写入，`boot()` 时检测并询问「继续本轮 / 重新开始」

### 三种「不计调度」的规则（最容易搞错）

| 场景 | 调度状态 | 日志 |
|---|---|---|
| 正常学习/复习 | 全量写入（`srs.review`） | `ok`/`bad`/`nw`/`rv`/`ms` |
| 练习 practice | **完全不写** | 只计 `pr`（练习题次） |
| 冲刺 sprint | 答对**不写**，答错**只写遗忘** | 只计 `pr` |

## 改代码前的硬约定

1. **跑自检**：`node tools/selftest.js`，68 项全过再谈改完。改调度/合并/连胜保护必须补用例（store 层有独立 localStorage 桩的测试）。
2. **bump 缓存**：任何前端资源改动都要 `sw.js` 的 `CACHE +1`，并在推送后用线上地址 grep 验证。
3. **日志字段是白名单**：`sync.js` 的 `mergeLog()` 逐字段列出，往日志加新字段（如 `pr`、`fzg`/`fz`）必须同步补进去，否则同步一次就被清掉。
4. **提交只 add 明确文件**：这个目录可能同时有别的会话在工作（`scripts/`、`data/daily/`、共享的 `app.js`），禁止 `git add -A`；提交后 `git show --stat HEAD` 核对；push 前 `git pull --rebase --autostash`（远端持续有进度同步提交）。
5. **UI 规范**：新拟态（底色 `#E0E5EC`，凸起/内凹阴影），主色正蓝 `#2F6ED4`，禁渐变、禁彩色光晕、禁装饰性分隔符与教学式提示；纵向 flex 卡片里的独立控件必须显式 `align-self: center`（踩过）。
6. **一次只改一件事**：题型、间隔算法、每日配额不要同时动，否则无法判断效果来源。

## 常见坑（完整清单见 `HANDOVER.md` 第六节）

- `#app` 容器必须带 `.app` 类，否则布局全坏
- 预览窗口（iframe 沙箱）的 localStorage 是一次性的，测持久化要双击 `index.html` 或用 http 服务
- `build('spell')` 没有选项，若沿用「选项数 < 2 就回退」的检查会被静默吞掉
- 词卡按钮里多写一次 `s.li++` 会错位（`advanceFromCard` 自己按 li 取词）
- Edge 无头截图在本机已失效（退出码 0 但不产出文件），视觉验收靠用户，逻辑验收靠 selftest

## 文档地图

- `README.md`（本文）——现状、上手、约定
- `HANDOVER.md`——设计决策的来龙去脉、完整踩坑清单、各功能实现规则（**改调度或流程前先读**）
- `改进方向.md`——滚动待办，做完即删，不当存档
- `AGNES.md`——每日时文词的数据契约与安全约束

## 使用与部署

### 直接打开（U 盘 / 离线）

把整个目录拷走，双击 `index.html`。不装任何东西、不联网也能学，数据存在本机浏览器。

### 部署成网站

```bash
git remote add origin ssh://git@ssh.github.com:443/<用户名>/Lexilume.git
git push -u origin main
```

仓库 Settings → Pages → Source 选 `Deploy from a branch`，`main` + `/ (root)`。

### 登录与同步

打开网站先粘贴 Fine-grained token（Repository access 只选本仓库，Permissions 只给 **Contents: Read and write**）。这个令牌同时是登录凭证与同步凭证。

同步规则：每个词取「最后一次复习时间更晚」的那份，日志按天取各字段较大值；内容无变化不提交。已知边界：本机「清空进度」不会传播到远端（合并只有并集）；两台机器同一天各学 20 词，日志记 20 而不是 40。

仓库若为公开，`progress.json` 可被读取；介意就把数据文件指向私有仓库（设置里可改仓库名）。

### 导入词表

每行一个词，逗号或 Tab 分隔：`word, 音标, 词性, 释义, 例句, 例句翻译`，除 word 外都可留空。

### 备份

「设置 → 导出备份」存 JSON（不含查词密钥）。换设备、清缓存前先导出。
