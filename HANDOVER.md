# 交接文档

> 写给下一次接手这份工作的人（或未来的自己）。读完这一篇就能继续干活，不用翻对话记录。

## 一、这是什么

**词律 wordbeat** —— 一个可自行部署的单词学习网站，参考百词斩的学习机制，调度算法用的是简化版 FSRS。

- 纯静态、零构建、零依赖：没有 npm、没有框架、没有后端
- 使用者目前只有一人（高二学生，家里和学校各一台电脑，都不会被还原）
- 仓库规划名：`Starryeeeeee/wordbeat`，地址将是 `https://starryeeeeee.github.io/wordbeat/`

## 二、当前状态（2026-11-14）

**已完成且验证通过：**

| 模块 | 状态 |
|---|---|
| 调度内核 srs.js | 完成。21 项单元自检全过 |
| 学习流程 | 完成。先整批过词 → 统一测；答错退回词卡稍后重考 |
| 题型 | 只启用「看词选义」，其余四种接口已留好，在设置里灰显 |
| 统计复盘 | 掌握分布 / 30 天复习量预测 / 24 周热力图 / 遗忘风险榜 / 错词本 |
| 本地存储 | localStorage，实测写入后关浏览器重开数据还在 |
| 跨设备同步 | GitHub 仓库文件当数据后端，代码完成，等仓库建好才能实测 |
| UI | 新拟态，主色 #2F6ED4 蓝 |

**卡住的唯一一步：** GitHub 仓库还没建。本地已提交 5 个版本，remote 已指向 `wordbeat.git`，SSH 密钥与 `core.sshCommand` 已配好，只差仓库存在。

## 三、上线待办（按顺序做）

1. **建仓库**：https://github.com/new?name=wordbeat ，选 Public，**不要**勾选 Add README / .gitignore / license
2. **推送**：`git push -u origin main`（本机可用，走 `ssh://git@ssh.github.com:443` 绕过 22 端口封锁）
3. **开 Pages**：仓库 Settings → Pages → Deploy from a branch → `main` / `(root)` → 约一分钟后访问上面那个网址
4. **生成 token**：GitHub → Settings → Developer settings → Fine-grained personal access tokens
   - Repository access 只勾 `wordbeat` 这一个
   - Permissions 只给 **Contents: Read and write**
5. **配置同步**：打开网站 → 设置 → 跨设备同步 → 仓库填 `<用户名>/wordbeat`，粘贴 token → 保存并同步

## 四、关键设计决策（改动前先读）

### 调度算法：不是 SM-2，也不是完整 FSRS

- 每个词维护难度 D 与稳定度 S；保留率 `R = 1/(1 + t/9S)`
- 目标保留率 90% 时反解得 **`下次复习 = 上次 + S 天`**，没有 EF 乘法，没有 ease hell
- 答对 `S ×= max(1.3, 2.6 − 0.16D)`；答错 `S ×= 0.35` 但**不清零**（这是相对 SM-2 的关键修正）
- 实测连续答对九次的间隔：1.8 → 3.3 → 6.2 → 11.7 → 22.4 → 43.4 → 84.5 → 165.6 → 326.4 天
- 双通道结构（认词 r / 产出 p）已保留但只激活 r。所有调度函数都接受 channels 参数，加题型只需改 `activeTypes`

### 复刻自百词斩的三条机制

1. **固定每日配额**：新学与复习条数固定（默认 20 / 60），复习不会堆积到某天
2. **先整批过词再统一测**：新词先逐张翻完，不夹题（用户明确要求，否决了"学一个测一个"）
3. **答错退回词卡**：变红停 0.72 秒 → 跳到该词介绍页 → 点"看懂了，继续"→ 该词隔三道重考，最多两次

### 答对不弹反馈条

答对只有选项变绿，420ms 后自动进下一题。底部是**固定高度**的提示行，作答前后不变——这是修过的一次抖动，别改回去。

### 存储与同步

- localStorage，键前缀 `wl.`：进度 `wl.progress.v1.<bookId>`、日志 `wl.log.v1`、配置 `wl.config.v1`、同步 `wl.sync.v1`（含 token）
- `file://` 和 `localhost` 都实测过跨重启保存；**预览窗口/iframe 沙箱不行**，为此做了顶部红条和设置页「存储」面板
- 同步合并规则：**每个词取最后一次复习时间更晚的那份**；日志按天取各字段较大值。合并是幂等的，重复同步不会翻倍
- token 只存本机浏览器，权限最小化为单仓库 Contents 读写

### UI 规范（用户明确过的偏好）

- 新拟态：底色 `#E0E5EC`，凸起 `8px 8px 16px #B8BCC2 / -8px -8px 16px #FFF`，hover 阴影缩小，active 转内凹，无边框无渐变
- 主色正蓝 `#2F6ED4`，**不要蓝紫**；按钮投影用中性灰，不要彩色光晕
- 反馈类颜色：正确 `#22664E/#DCE9E3`，错误 `#94403A/#EFDFDC`
- 背景不用渐变；禁廉价霓虹、禁大圆角廉价感

## 五、文件地图

```
index.html            入口（注意：#app 必须带 .app 类，之前漏过导致布局全坏）
assets/style.css      全部样式
src/srs.js            调度内核，纯函数无 DOM，可单独测试
src/store.js          localStorage 封装 + 导出/恢复 + 存储可用性探测
src/quiz.js           五种题型的生成与通道映射
src/sync.js           GitHub Contents API 读写 + 合并
src/app.js            视图与会话状态机（会话结构见 startSession）
data/books.js         词库，装载时自动归一化释义里混入的第二词性
sw.js                 离线缓存，改资源后记得 bump CACHE 版本号
tools/selftest.js     21 项核心自检：node tools/selftest.js
tools/make-icons.js   重新生成图标（纯 Node 手写 PNG 编码）
HANDOVER.md           本文档
```

## 六、已踩过的坑

1. `#app` 容器没有 `.app` 类 → max-width 和内边距全部失效，页面顶到边
2. 中途答错过的词不计入「今日新学」→ 改为在生词卡点"下一个"时计数（markLearned）
3. 释义字段混入第二词性（如"益处 v. 有益于"）→ 装载时自动拆成 pos 与释义
4. 柱状图被离群值压平 → 高度用开方缩放
5. 预览窗口的存储是一次性的 → 已有红条提示，别在那里面测持久化
6. 本机 github.com 网页直连不通，但 `ssh.github.com:443` 和 `api.github.com` 可达

## 七、验证手段（改完必跑）

```bash
node tools/selftest.js          # 21 项，全过才算动过核心
```

浏览器端验证脚本曾经用过三种：答题落库校验、卡片高度测量（验证不再抖动）、重考入队校验。都是临时 HTML + headless Edge，用完即删。

## 八、下一步候选

- 启用其余四种题型（看义选词 / 听音辨义 / 拼写 / 语境填词），接口在 quiz.js
- 词库扩充：ECDICT（github.com/skywind3000/ECDICT）按 tag 裁剪，或用户自行导入教材词表
- 同步冲突的边界：两台机器同一秒答题理论上仍会以后写者为准，可忽略
- PWA 已就绪（manifest + sw），部署后手机「添加到主屏幕」即可离线
