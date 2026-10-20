# 黑盒电路侦探 · Circuit Detective

> 屏幕上只有一个黑色芯片盒：左边 4 个输入拨杆，右边 4 个指示灯。
> 你拨开关、看灯亮灭，反推出盒子内部最少用了哪几个逻辑门。
> 答案由内置求解器**现场复算**，关卡由种子确定性生成，探测序列可回放。

纯前端单页 Web 游戏 · Canvas2D · 零后端 · 零 CDN · 无美术资源。

## 状态

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 | 计划与可运行骨架 | ✅ 2026-10-18 |
| M1 | 三值 unit-delay 仿真核（+ 独立第二实现交叉验证） | ✅ |
| M2 | 种子生成器 + 求解器 | ✅ |
| M3 | 门编辑器 / 提交校验 / 结算 / 逐层点亮 | ✅ 2026-10-18 |
| M4 | 回放短码、只读回放视图、分享文案 | ✅ 2026-10-18 |
| M5 | `npm run verify` 全量、单文件构建、静态扫描 | ✅ 2026-10-18（CI 首推 4/4 绿） |
| M6 | git tag + GitHub Release + 发布留档 | ✅ 2026-10-18（`v0.1.0` 已发布） |

CI 最近一次实跑：**`39418742699`**（2026-10-20T11:58:07Z，push `main` @ `3107c8a`），
四腿（ubuntu-latest / windows-latest × node 22 / 24）**全 success**，**注解 2 条**（均为
"ubuntu-latest 将于 2026-10-19 起迁移到 Ubuntu 26" 的 notice；Node 20 弃用告警 **0 条**）。
**如实记**：该次 run 实际分到的镜像仍是 `ubuntu-24.04`（Image Release `20261018.339`），
即迁移在本次 run 尚未生效——下一次跑在 Ubuntu 26 上的 run 需另行登记。

当前可玩：**拨杆 → 灯 → 拼装 → 提交 → 结算 → 逐层点亮 → 分享/回放**。前 3 关是"拼块 / 插口"话术，
第 4 关起才出现 `NOT` / `AND` / `OR` 的正式名称（D1）。
里程碑细节与已知未验证项见 `plan/05-里程碑与发布.md`。

## 玩法

1. 左边四个开关，右边四盏灯。拨开关，看灯怎么变。
2. 切到「拼装」：先点一个来源（开关或拼块右侧的小圆点），再点要接的位置（拼块左侧的小圆点或灯）。
3. 拼块可拖动；选中后方向键微调、`Delete` 删掉。没接的入口画虚线框。
4. 提交后：对上了就结算（你的门数 / 最少门数 / 差值 / 试探次数），并把盒子逐层点亮；
   不对就告诉你**哪一行开关组合、哪盏灯、应亮多少、实际多少**。
5. 门数按每个灯单独计：共用的拼块，每个灯各算一次。
6. 结算后点「复制分享码」拿到一段短码（探测次数 + 门数差 + 回放码）。
   把它拼成链接给别人：`<页面地址>#r=<短码>` 会进入**只读回放**——按步重播当时的试探顺序，
   同时逐层点亮当时的黑盒；不能编辑、不重新计数。短码不可用（被截断/篡改/版本不同）时会明确提示，
   不会静默进到别的关卡。

## 快速开始

**直接玩（不需要构建）**：下载 [v0.1.0 Release](https://github.com/yuluo554/circuit-detective/releases/tag/v0.1.0)
里的 `circuit-detective-0.1.0.html`，用浏览器打开即可（单文件、`file://` 可用、零网络请求）。

从源码跑：

```bash
node --version        # 需要 >= 22（本项目在 v24.15.0 实测）
npm run layout        # 布局门：项目是否仍长在方法论上（`AGENTS.md` 那条；续接对话第一件事）
npm test              # 单元 + 交叉验证
npm run verify        # 全量自检（一条命令，rc=0 表示全绿）
npm run build         # 产出 dist/index.html（单文件、零外链）
npm run dev           # 本地预览 http://127.0.0.1:4173/
```

> 本项目遵循 [`ai-tool-project-sprint`](AGENTS.md) 方法论（装订 2026-10-18）：
> 仓库锚点见 [`AGENTS.md`](AGENTS.md)，布局门 `tools/check-sprint-layout.mjs` 在 CI 里有一条步骤。

可选的两条浏览器级校验（本机需有 Chromium；`verify:engines` 还需要 Firefox，缺则 SKIP）：

```bash
npm run smoke          # headless 真实点击：拨杆 / 拼装 / 接线 / 拆线 / 提交 / 结算 / 揭示 / 分享 / #r= 只读回放
npm run verify:engines # 跨引擎一致性：Node + Chromium + Firefox 关卡 JSON 与回放步表逐字节相同
```

直接用浏览器打开 `dist/index.html` 也可以（`file://` 可用，页面零网络请求）。

**零依赖**：`dependencies` 与 `devDependencies` 均为空，`git clone` 后无需 `npm install`。

**Node 版本口径**：本仓的**支持面由 CI matrix 声明**（`.github/workflows/ci.yml` 的 `node: ["22", "24"]`，
在 ubuntu-latest 与 windows-latest 上各跑一遍）；`package.json` 的 `engines.node`（`>=22`）只作
**npm 安装时的提示**，不是兼容性承诺的第二份声明——两者目前一致，但**门里没有断言二者相容**
（改任一处时请同时问另一处要不要跟）。

## 校验输出（`npm run verify`）

| 段 | 判据 |
| --- | --- |
| `sim.cross` | 1000 条 fixture × 全部输入组合，与独立第二实现差异数 = 0 |
| `fixtures.bytes` | fixture 重生成与入库件逐字节一致 |
| `level.generation` | 10,000 seed：失败 0、多解/无解 0、求解器复核通过率 100%；打印 p50/p99 |
| `replay.crossInstance` | 子进程解码重演与主进程逐项相同，一致率 100% |
| `share.roundtrip` | 200 关：分享短码编码 → 解码 → 重演，步表/网表/最优门数差异 0；超长 0；篡改 0 漏判 |
| `settlement.closure` | 400 关：编辑器可表达答案、结算字段一致、差值非负、失配反馈具体、最优解可达、探测可复算 |
| `reveal.order` | 500 关：揭示层级严格递增、无空层、终态覆盖全部门 |
| `copy.terms` | 前 3 关文案 0 命中"门 / NAND / AND / OR / NOT"，且扫描器有阳性对照 |
| `campaign.early` | 战役前 3 关可生成、最优门数 = 2 |
| `build.static` | 构建产物外链数 = 0；体积 / gzip 打印 |

耗时只报告，不参与判定（避免机器性能导致红绿抖动）。

跨引擎一致（M2 / M4 DoD）由 `npm run verify:engines` 单独跑：
Node + Chromium + Firefox 各生成同一批 seed 的关卡 JSON，再用真实 `#r=<短码>` 路由进只读回放视图，
把回放步表与揭示层与 Node 侧重算结果逐字节比对（实测 200 seed 关卡差异 0、回放步表差异 0）。
Playwright 与浏览器**都不是项目依赖**：脚本按本机全局路径动态查找，找不到就 SKIP。

## 确定性口径

三值编码、X 传播、unit-delay、PRNG、重抽上限、求解器口径、短码位布局全部**只在** [`data/README.md` §四](data/README.md) 定义一次。
代码、界面文案、计划文档一律引用该节，不另立第二套口径。

## 文档

| 文件 | 内容 |
| --- | --- |
| [`plan/00-README总览.md`](plan/00-README总览.md) | 索引、决策记录（D1–D19）、承诺-证据台账 |
| [`plan/01-题目文档.md`](plan/01-题目文档.md) | 题目定稿（定稿不改写） |
| [`plan/02-架构与技术选型.md`](plan/02-架构与技术选型.md) | 分层、目录、构建与零外链 |
| [`plan/03-模块详设.md`](plan/03-模块详设.md) | M1–M5 实现级设计与失败路径 |
| [`plan/04-数据计划.md`](plan/04-数据计划.md) | fixture 台账、真值纪律 |
| [`plan/05-里程碑与发布.md`](plan/05-里程碑与发布.md) | 逐里程碑 DoD 与实测证据 |
| [`plan/06-交付对标与决策.md`](plan/06-交付对标与决策.md) | 评分对标、开放项、风险 |
| [`plan/RELEASE-M6.md`](plan/RELEASE-M6.md) | 发布留档（版本、基线证据、产物 sha256、tag / Release 步骤） |

## 边界

- 不做电路模拟器（不追求自由搭建，不替代 logisim / Digital）。
- 不做多人联机、自定义关卡编辑器（首期）。
- 不做排行榜：无后端，日期种子可在本地提前算出（D3）。
- 零上传、零遥测、零第三方请求；构建产物不含任何外部 URL。

## 许可

[MIT](LICENSE)
