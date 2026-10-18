# RELEASE-M6 · 黑盒电路侦探 v0.1.0 发布留档

> **用途**：M6 发布三件套的留档。本文件在 **tag 之前**写就并进 tag 树，因此分两栏：
> `## 一、tag 前事实`（写文件时已发生、可当场复核）与 `## 二、tag 后追加`（tag / Release 落地后才有的对外事实）。
> **纪律**：第一栏里的数字全部来自本机实跑；第二栏在 tag 之前**留空占位**，不得预填。
> 门禁：`node tools/check-release.mjs` 要求本文件同时含两栏标题；离线项应常绿，`--online` 项在接远端后复查。

## 一、tag 前事实

### 1.1 版本与单一来源

| 项 | 值 | 落点 |
| --- | --- | --- |
| 发布版本 | `0.1.0`（去掉 `-dev.0` 后缀） | `package.json` 的 `version` |
| 代码内版本 | `0.1.0` | `src/core/version.mjs` 的 `VERSION` |
| tag 名 | `v0.1.0` | `tools/check-release.mjs` 的 `TAG_PRESENT` 按此名查本地 tag |
| 单一来源判定 | `VERSION_SINGLE_SOURCE` PASS（两处字面量一致） | `check-release.mjs` §version |

版本号只此两处；改动必须**两处同时**（否则 `VERSION_SINGLE_SOURCE` 立刻红）。

### 1.2 tag 前基线复测（2026-10-18，Windows + Node v24.15.0 / npm 11.12.1）

| 门 / 命令 | 结果 |
| --- | --- |
| `npm test` | **133 项全通过**（0 fail），逐文件列出的 21 个测试文件 |
| `npm run verify` | **10 段全 PASS**，rc=0（判定项 = 差异数 / 通过率 / 外链数；耗时只报告） |
| `npm run verify:engines` | Node + Chromium（`chromium-1228`）+ Firefox（`firefox-1522`）：关卡 JSON 200 seed 差异 0；`#r=` 回放 5 例步表差异 0 / 揭示层差异 0；两引擎互相一致 |
| `node tools/smoke.mjs` | **52 项全绿**（含 `#r=` 只读回放、`#r=` 优先于 `#s=`、篡改码报错；真实点击） |
| `node tools/gen-fixtures.mjs --check` | fixture 重生成与入库件逐字节一致 |
| `node tools/check-release.mjs`（离线） | 见 §1.4；本文件落盘后为 PASS 7 / FAIL 0 / SKIP 2（SKIP 为 tag / 远端两项，离线模式不查） |
| GitHub Actions（首推 `main`） | **4/4 绿**：`verify (windows-latest, node 22/24)`、`verify (ubuntu-latest, node 22/24)`；run `39138019748`。步骤与本地等价校验一致；`smoke` / `verify:engines` 刻意不进 CI（需仓外 playwright 缓存） |

`verify` 10 段：`sim.cross`、`fixtures.bytes`、`level.generation`、`replay.crossInstance`、`share.roundtrip`、
`settlement.closure`、`reveal.order`、`copy.terms`、`campaign.early`、`build.static`（快照见 `docs/verify-sample.txt`）。

### 1.3 交付产物与 sha256

附件口径取 **D13 / Q5**：**只给**单文件产物 + verify 样例，不给源码包（源码 zipball 由 GitHub 自动生成，不能替代"打开即玩的那一个文件"）。

| 附件 | 大小 | sha256 | 本地副本 |
| --- | --- | --- | --- |
| `dist/index.html` | 114,516 字节（gzip 34,806，外链 0，15 模块） | `4e7fdddce85f59a22fab5213f29ef819782583afaa56a702d32dc00e063bcda2` | `release/circuit-detective-0.1.0.html` |
| `docs/verify-sample.txt` | — | `b84a6cc96e034776eaebedd03ebcc006dd4d4c7e64ff3ab35ac511d59163a2c3` | `release/verify-sample.txt` |

- `dist/` **不入仓**（`.gitignore`；`check-release.mjs` 的 `NO_ARTIFACTS_TRACKED` 守卫）；产物由 Release 附件承载。
- `release/` 同样入 `.gitignore`（本地留副本，不随仓库走）；sha256 以上表为准，登记进 Release 正文。
- 构建逐字节确定（K33）：同源码两次 `npm run build` 一致；`index.html` 的 CRLF 归一为 LF。

### 1.4 M6 DoD 三件套

| # | 事项 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| ① | git tag（annotated） | ✅ 2026-10-18 | `v0.1.0` → tag 对象 `76b56283d167`，指向 `56f633d`；已推远端（详见 §2.1） |
| ② | GitHub Release（附件 = `dist/index.html` + `docs/verify-sample.txt`，sha256 登记正文） | ✅ 2026-10-18 | 公开仓 `yuluo554/circuit-detective`；两个附件下载后 sha256 与 §1.3 一致（详见 §2.2） |
| ③ | `plan/RELEASE-M6.md`（tag 前入库，两栏） | ✅ 本文件 | tag 树里本文件已含第 ① 栏；第 ② 栏为 tag 后追加（§二） |

离线门 `node tools/check-release.mjs` 在发布前只剩 `RELEASE_DOC` 一项红（"发布还没做完"），
三件套落地后为 **PASS 7 / FAIL 0 / SKIP 2**；`TAG_PRESENT` / `REMOTE_RELEASE` 仅 `--online` 模式查，
发布后 `--online` 为 **PASS 9 / FAIL 0 / SKIP 0**（§2.3）。

### 1.5 已知未验证项（不得写成已完成）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 移动端布局 | ⬜ 未做 | 首期只保证桌面（`data/README.md` §1.4） |
| 断网专项验证 | 🟡 未专项 | 冒烟下页面仅 1 次文档请求、外链 0，但未做断网场景专项 |
| 跨引擎 | ✅ 本机实跑 | 见 §1.2；Firefox 由本机 playwright 缓存提供，**不进项目依赖**，缺缓存时该命令 SKIP |

### 1.6 本轮修掉的缺陷

| 缺陷 | 症状 | 处理 |
| --- | --- | --- |
| **发布门测试把"瞬态"当契约** | `tests/release-gate.test.mjs` 的"`--pre-tag` 时缺失留档报 SKIP"直接跑真实仓库，**预设了 `plan/RELEASE-M6.md` 不存在**。本轮把留档写出来后，该测试立刻红（门报 `PASS` 而非 `SKIP`）——它测的其实是"M6 还没做"，不是门的模式语义 | 给门加 `RELEASE_DOC_PATH` 环境变量（默认 `plan/RELEASE-M6.md`，见 K39），测试用"不存在的路径"**主动构造**缺档态：缺档 + `--pre-tag` → SKIP、缺档 + 离线 → FAIL、有档 → PASS 两栏齐备。三条断言与 M6 进度解耦 |

> 与 M5 那批缺陷同源：**不是靠人复查，而是门禁/测试当场红**。这条还多一层——它红的时候恰好证明"上一棒的测试钉错了对象"。

### 1.7 tag / Release 执行步骤（本棒已逐条执行；结果见 §二）

```bash
# 0) 前置：本文件与版本收口已 commit，工作树干净
node tools/check-release.mjs --pre-tag          # tag 前：RELEASE_DOC 可 PASS，TAG/REMOTE 报 SKIP

# 1) 接远端（建公开仓后）
gh repo create circuit-detective --public --source=. --remote=origin \
  --description "黑盒电路侦探：拨开关、看灯、反推黑盒里的最少门电路（纯前端单页，零依赖、零外链）"
# 若本机 github.com:443 不可达（见下方环境坑），改用 SSH-over-443：
#   git remote set-url origin ssh://git@ssh.github.com:443/<owner>/<repo>.git
git push -u origin main

# 2) tag（annotated）
git tag -a v0.1.0 -m "黑盒电路侦探 v0.1.0"
git push origin v0.1.0

# 3) Release（附件 = 单文件产物 + verify 样例，sha256 写进正文）
gh release create v0.1.0 release/circuit-detective-0.1.0.html release/verify-sample.txt \
  --title "黑盒电路侦探 v0.1.0" --notes-file <发布正文>

# 4) 终态复核（无 FAIL；exit 3 = 环境缺失，既非 PASS 也非 FAIL）
node tools/check-release.mjs --online

# 5) 附件自证：下载回来重算 sha256，与 §1.3 逐一比对
gh release download v0.1.0 --repo <owner>/<repo> && sha256sum *
```

> 建仓、push、tag、Release 都是对外动作，**用户明确确认后才执行**（本棒已确认）。
> **本机环境坑（本轮实测）**：`api.github.com` 可达（`gh` 各命令正常）、但 `github.com:443` 被网络阻断
> （`git push` 超时、`curl https://github.com` 超时），而 `ssh.github.com:443` 可用——因此 `origin`
> 用 SSH-over-443 而非 HTTPS。这是**本机网络**的限制，不是仓库配置问题。

## 二、tag 后追加

> 本节在 tag / Release 落地后填写；tag 之前**留空**，不得预填（防"计划当事实"）。
> 以下为 2026-10-18 实录，故本节的 commit **必然在 `v0.1.0` 之后**（tag 树里这一栏是空占位）。

### 2.1 本地 tag

| 项 | 值 |
| --- | --- |
| tag 名 | `v0.1.0` |
| 类型 | annotated（`git cat-file -t v0.1.0` = `tag`） |
| tag 对象 | `76b56283d1673a0cdad609cb32b8bec772b6572f` |
| 指向 commit | `56f633d1e22dae19065fc4e2ebec80b85d8ed12a`（"CI 首推 4/4 绿：回写实测结论（tag 前）"） |
| 远端 | 已推（`git push origin v0.1.0`） |

### 2.2 GitHub Release

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/yuluo554/circuit-detective （公开） |
| Release URL | https://github.com/yuluo554/circuit-detective/releases/tag/v0.1.0 |
| 状态 | 已发布（`draft=false`） |
| 附件 1 | `circuit-detective-0.1.0.html` — 114,516 字节，sha256 `4e7fdddce85f59a22fab5213f29ef819782583afaa56a702d32dc00e063bcda2` |
| 附件 2 | `verify-sample.txt` — 1,547 字节，sha256 `b84a6cc96e034776eaebedd03ebcc006dd4d4c7e64ff3ab35ac511d59163a2c3` |
| 下载后重算 sha256 | ✅ 两个附件均与 §1.3 逐一相同（`gh release download` → `sha256sum`） |
| 正文 | 含两个附件的 sha256 对照表；口径与验证结论 |

### 2.3 `check-release.mjs --online` 终态

```text
PASS 9 / FAIL 0 / SKIP 0   （rc=0）
```

| 项 | 值 |
| --- | --- |
| 汇总 | **PASS 9 / FAIL 0 / SKIP 0**，rc=0 |
| `TAG_PRESENT` | PASS（`local tag object 76b56283d167`） |
| `REMOTE_RELEASE` | PASS（`v0.1.0 draft=false assets=circuit-detective-0.1.0.html,verify-sample.txt`） |

> 至此 **M6 三件套（tag / Release / 留档）全部落地**，离线门与在线门均无 FAIL。

### 2.4 首推后回写

- [x] 2026-10-18 首推后：`plan/05` §五翻为实测结论、§七「CI 实跑」写入 4/4 绿（run `39138019748`）、§八改为实跑说明；
  `plan/00` 台账与状态表、README 状态行一并按实测改写（本次回写 commit 在 tag 之前，故随 tag 树入库）。
- [x] 首推不改源码：`dist/index.html` 仍为 114,516 字节，sha256 与 §1.3 一致（tag 前复核）。
- [ ] 若 tag 后重跑 `verify` 导致产物字节变化，**不予**修改附件（发布后不再改源码）；如有异常另开勘误。

## 三、M6 增补口径（K 编号，接 `plan/HANDOFF-M5.md` §5 的 K31–K35）

| 编号 | 口径 | 落点 |
| --- | --- | --- |
| **K36** | 发布附件**只**给 `dist/index.html` + `docs/verify-sample.txt`；不给源码包，不给目录压缩包；sha256 登记在 Release 正文（不写进包内） | 本文件 §1.3 / `tools/check-release.mjs` |
| **K37** | 版本号单一来源 = `package.json` 的 `version` 与 `src/core/version.mjs` 的 `VERSION`，必须一致；tag 名 = `v` + 该版本 | `tools/check-release.mjs` 的 `VERSION_SINGLE_SOURCE` / `TAG_PRESENT` |
| **K38** | `plan/RELEASE-M6.md` 必须两栏齐备（`## 一、tag 前事实` / `## 二、tag 后追加`）且在 tag 前入库；第二栏 tag 前留空 | `tools/check-release.mjs` 的 `RELEASE_DOC` |
| **K39** | 发布留档路径由 `RELEASE_DOC_PATH` 决定（默认 `plan/RELEASE-M6.md`）；该变量是**测试用 seam**，让"缺档报 SKIP / 报 FAIL"两条模式语义在留档存在之后仍可被构造和断言 | `tools/check-release.mjs` / `tests/release-gate.test.mjs` |

## 四、阶段 7 出口门覆盖对账（补记 · 复盘轮追加）

> **为什么补这一节**：复盘时对照 `ai-tool-project-sprint` 阶段 7 出口门逐条清点，发现本项目
> `tools/check-release.mjs` 只覆盖其中 9 条，**其余三十几条没有一条被声明为"不适用"——它们是静默消失的**。
> 更糟的是下面标"实现"的四条**当时从未被任何门覆盖**（本轮逐条手查才补上，全部通过，但
> **没有任何东西保证它们通过**）。本节把"缺的那几条"显式登记，三态不许留空。
> 本节的补记属 `plan/` 文档面，tag 之后追加，不改动 `v0.1.0` 附件（附件 sha256 仍为 §1.3 的值）。

| 阶段 7 出口门 | 状态 | 证据 / 不适用理由 |
| --- | --- | --- |
| 发布物本体已验（真下载 + 中立目录） | 实现 | `gh release download` 到 `/tmp/rel-verify/`，sha256 与 §1.3 逐一相同 |
| 附件与 tag 树逐字节同源 | 实现 | `git clone --no-local --branch v0.1.0` → `node tools/build.mjs` → 与下载件 `cmp` 逐字节一致 |
| 源码包要自足（`MANIFEST.in` 白名单） | 不适用 | 附件 = 构建产物本身（D13），本版不发源码包；源码由 GitHub 自动 zipball 提供，不作交付物 |
| 入仓工具在无 `.git` 树里也能跑 | 不适用 | 本仓无发布期入仓工具（无打包器、无历史扫描脚本）；`tools/` 均为开发期脚本 |
| README 提到的附件名必须真在 Release 里 | 实现 | README 的 Release 链接 + `gh release view --json assets` 两种形态（`circuit-detective-0.1.0.html` / `verify-sample.txt`）核对过名实 |
| 附件与校验和 / 复核三步 | 部分实现 | 已做"真下载 → sha256 复算 → 与留档件比对"；**未**上传 `SHA256SUMS` 伴随文件（K36 口径为 sha256 写进 Release 正文） |
| 已发布窗口关闭后的缺陷处置 | 实现 | 本版无发布后缺陷；tag 后的提交只含文档面 + 一处测试面（见下条实测更正） |
| DoD 打勾只能在事实落地后 | 实现 | §1.4 三件套 ①② 在 tag 前为 ⬜，落地后翻 ✅ 并指向 §二 |
| tag 之后只允许文档面提交 | **不成立（如实记，不粉饰）** | `git diff --name-only v0.1.0..HEAD` 实际含**四类面**：① 文档面 `plan/*` + `README.md`；② **测试面** `tests/handoff-gate.test.mjs`、`tests/sprint-layout.test.mjs`；③ **工具/配置面** `tools/check-sprint-layout.mjs`、`package.json`、`.github/workflows/ci.yml`；④ **锚点** `AGENTS.md`。②③④ 是"交接单守门扩到 M6"与"复盘轮补方法论装订"两件事，后者**经用户明确指示**执行。**发布物始终未受影响**：`git diff v0.1.0..HEAD -- src/ index.html` 为空，`dist/index.html` 仍是 §1.3 的 `4e7fddd…`（已从 tag 树重建 `cmp` 验证）。**该口径在本仓应改写为**"tag 之后只允许**非 `src/` 面**提交（文档 / 测试 / 工具 / 配置），任何 `src/` 改动都必须升版本号重发" |
| annotated tag 两端一致 = **对象哈希**一致 | 实现（本轮补查） | 本地 `76b56283d167…` == 远端 `git/ref/tags/v0.1.0` 的 `object.sha` |
| push 数 = run 数对账 | 实现（本轮补查） | 6 次 push ↔ 6 条 run（含 tag run），按 `event/headBranch/headSha/conclusion` 逐条配对，全 success |
| 脱敏：提交身份 + **tagger 邮箱** | 实现（本轮补查） | `git log --format='%ae'` 去重 + tag 对象 tagger，**全部为 GitHub noreply 邮箱** |
| 每条已交付命令都有离线 CI 冒烟 | 实现 | CI 步骤：fixture `--check` / `npm test` / `npm run verify` / `npm run build` / `check-dist`；`smoke` 与 `verify:engines` 刻意不进 CI（需仓外 playwright 缓存，已在 `plan/05` §八 声明） |
| 多平台冻结产物原生构建 + 原生冒烟 | 不适用 | 交付物是浏览器单文件，平台无关；CI 矩阵覆盖 Windows/Ubuntu × Node 22/24 |
| 一致性门（题面/发布物/README 的名字与版本） | 实现 | `VERSION_SINGLE_SOURCE` + `readme-gate.test.mjs` + `check-release.mjs` 的 `DOCS_PRESENT` |
| **方法论装订与布局门（新增）** | **实现（复盘轮补装）** | 复盘时登记为"未装订"，经用户确认后同轮补齐：`AGENTS.md` + `tools/check-sprint-layout.mjs`（8 项断言，**7 组变异全红**）+ `plan/00` 装订行 + CI 一步 + 常驻测试（测试数 133 → 137）。该提交含 `tools/`/`tests/`/`.github/`，**越出"纯文档面"**；**发布物未受影响**（`src/` 零差异、重建产物与附件 `cmp` 一致）。详见 `plan/HANDOFF-M6.md` §4 第 0 条 |
