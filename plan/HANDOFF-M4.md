# HANDOFF-M4 · M4 已完成（短码回放 / 分享文案 / 只读回放视图），下一棒 M6

> 本文件是 **M4 的收尾交接单**；命名规则见 `plan/00-README总览.md` §一。
> 上一棒（M4 的起点）读的是 `plan/HANDOFF-M3.md`；补记的 M2 记录在 `plan/HANDOFF-M2.md`。
> 库内路径一律相对仓库根。启动提示词见文末。
>
> **M5（10 段 `verify` + 单文件构建 + 静态扫描）在本轮之前已全绿**，因此下一棒只剩 **M6 发布**。

## 1. 当前进度与证据

| 项 | 状态 | 证据位置（可复核） |
| --- | --- | --- |
| M0 计划套件 | ✅ | `plan/00`–`plan/06`、`data/README.md` |
| M1 三值 unit-delay 仿真核 | ✅ | `src/core/sim.mjs`；`tests/sim.test.mjs`；`tests/sim-cross.test.mjs` |
| M1 独立第二实现 | ✅ | `tests/reference/sim-reference.mjs`（不 import 生产模块） |
| M1 fixture（1000 条、五形态各 200） | ✅ | `data/fixtures/netlists.json`；`tools/gen-fixtures.mjs --check` |
| M2 xorshift128+ 生成器 + 求解器 | ✅ | `src/core/rng.mjs`、`generator.mjs`、`solver.mjs` |
| M2 跨引擎一致（≥2 引擎） | ✅ | `tools/cross-engine.mjs`（Node + Chromium + Firefox，200 seed） |
| M3 编辑器 / 提交 / 结算 / 揭示 | ✅ | `src/core/editor.mjs`、`judge.mjs`、`reveal.mjs`、`src/ui/*` |
| **M4 短码回放 / 分享 / 只读回放视图** | ✅ | `src/core/replay.mjs`、**`src/core/share.mjs`**、`src/ui/level-source.mjs`（路由）、`src/ui/app.mjs`（`enterReplay`/`advanceReplay`/`shareCurrent`） |
| M5 `verify` | ✅ 10 段 | `tools/verify.mjs`（新增 `share.roundtrip`）；`docs/verify-sample.txt` |
| M6 发布 | ⬜ | `tools/check-release.mjs` 已就位，`plan/RELEASE-M6.md` 未写 |

**本轮实测（2026-10-18，Windows + Node v24.15.0）**

```
npm test                        → tests 127 / pass 127 / fail 0
npm run verify                  → 10 段全 PASS，rc=0
                                  sim.cross: 1000 fixtures / 9540 comparisons / 0 differences
                                  level.generation: 10000 seeds / failed 0 / ambiguous 0 / recheck 100%
                                                    p50 0.133ms / p99 0.467ms（只报告）
                                  replay.crossInstance: 3 cases / 0 失配 / 一致率 1
                                  share.roundtrip: 200 cases / encoded 200 / stepsMismatch 0 /
                                                   netlistMismatch 0 / optimalMismatch 0 /
                                                   tooLong 0 / tamperBlind 0 / maxCodeLength 40
                                  settlement.closure: 400 cases / 六项计数全 0
                                  reveal.order: 500 seeds / nonIncreasing 0 / emptyLayer 0 / uncovered 0
                                  copy.terms: hits 0 / positiveControl true
                                  campaign.early: 3 levels / optimal [2,2,2]
                                  build.static: 114516 bytes / gzip 34806 / externalLinks 0
npm run build                   → dist/index.html（单文件、15 模块、零外链）
npm run verify:engines          → Node + Chromium + Firefox，200 seed 关卡 JSON 差异 0；
                                  新增 `#r=` 回放段：5 例 × 2 引擎，回放步表与揭示层差异 0
node tools/smoke.mjs            → 52 项全绿（headless Chromium，真实点击 + `#r=` 只读回放）
node tools/check-release.mjs    → 离线模式 PASS 5 / FAIL 2 / SKIP 2
                                  FAIL = WORKTREE_CLEAN（提交前）+ RELEASE_DOC（M6 未写）
```

## 2. 本轮修掉的真实缺陷（都做过复现或变异验证）

1. **短码里的 64 bit seed 还原成负数（D25）**：`decodeRecord` 用 JS 有符号位运算**一次读 32 bit**
   （`read(32)` 在最高位为 1 时返回负数），`BigInt(负数)` 再拼接得到**负 seed**。
   影响面：一半左右的 seed（含 `campaign/1`、`campaign/2`）——变异验证时 9 个边界 seed 里 6 个还原错。
   此前 `replay.crossInstance` 只比"探测输出"、不比 seed，所以缺陷一直潜伏；M4 要把 seed 显示出来、
   降级分享文案也要用它，才暴露。修法：`BigInt(reader.read(32) >>> 0)`；回归测试：
   `tests/replay.test.mjs` 的 9 个边界 seed 断言（把 `>>> 0` 改回去即变红）。
2. **冒烟脚本超时不出报告**：`waitForFunction` 超时以"未捕获异常"中止，日志里只剩一行 Timeout，
   看不出哪些项已经过了（本轮就因此多花了一轮定位）。现在 `uncaughtException` / `unhandledRejection`
   都接住并打印完整对账表（`tools/smoke.mjs` 的 `abort()` + `report()`）。

> 本轮没有出现"以为会红其实没红"的情况：两处变异验证都是**先看红、再还原**（见 §7）。

## 3. 本轮补齐的功能缺口

| 缺口 | 处理 |
| --- | --- |
| 短码只能靠 `#s=` 进普通关卡，`#r=` 不存在 | `routeFromLocation`：`#r=` 优先于 `#s=`，空 `#r=` 退回种子；非法转义不抛（`safeDecode`） |
| 解码失败会静默进普通关卡 | 明确报错 + 清空局面（画布、面板、灯、笔记），**不**回退成普通关卡（D27） |
| 回放视图（按步推进探测）不存在 | `enterReplay` / `advanceReplay` / `startReplayClock`：tick 同时推进"探测步"与"揭示层"，末尾同到终态；揭示与回放共用 `buildRevealPlan` |
| 回放能不能编辑没定义 | `readOnly()` 统一锁：提交 / 清空 / 删除 / 摆件 / 关卡切换禁用，点画布与数字键都不改状态（D26） |
| `share` 按钮一直是 `disabled`，点了只显示探测次数 | 结算后可用；`sharePayload`（探测次数 + 门数差 + 短码）+ 剪贴板（失败则贴进 readout） |
| 超长时只有一句报错 | 降级文案（原始种子文案 + 探测次数）；错误对象带 `code: "code-overflow"` 供调用方判定（K24） |
| 回放的词表口径没定 | `replayCopy()` 固定无术语词表：短码不含关卡号，不能靠"第几关"选词表（D26） |
| 回放/分享没有机器判据 | 新增 `share.roundtrip` 段、`tests/share.test.mjs`、跨引擎回放段、冒烟 14 项（含只读 / 地址栏 / 篡改） |
| 死代码 | 删除无人引用的 `readout.summary` 文案键；`app.mjs` 不再 import `dailySeed` |

## 4. 下一棒待办（M6 发布）

1. `plan/RELEASE-M6.md`（**tag 前入库**，两栏：tag 前事实 / tag 后追加）——`check-release.mjs` 的
   `RELEASE_DOC` 项会一直 FAIL 直到它存在。
2. 版本号收口：`package.json` 现在是 `0.1.0-dev.0`，与 `src/core/version.mjs` 同源（`VERSION_SINGLE_SOURCE` 已 PASS）；
   发布前把 dev 后缀去掉要**两处同时改**。
3. `git tag`（annotated）+ GitHub Release：附件 = `dist/index.html` + `docs/verify-sample.txt`，
   sha256 登记在 Release 正文（D13：源码 zipball 不能替代单文件产物）。
4. **远端未接**：`git remote` 为空，`gh` 未登录；`check-release.mjs --online` 会以 exit 3 报环境缺失，
   这不是 FAIL 但也不是 PASS（见 `tools/check-release.mjs` 的 `EnvironmentMissing`）。
5. CI 首推后需要在 `plan/05` §七 把"CI 实跑 ⬜"翻成实测结论（目前只能写"本地等价校验（未接远端）"）。
6. `npm run verify` 的 `--json` / `--out` 样例已是 10 段；发布前重跑一次并刷新 `docs/verify-sample.*`。

## 5. 既定口径清单（K 编号，动了会打挂测试）

| 编号 | 口径 | 落点 |
| --- | --- | --- |
| K1 | 三值编码 `0/1/2`，`2 = X`；纯整数，无浮点 | `data/README.md` §4.1 / `src/core/sim.mjs` |
| K2 | unit-delay：门读上一 tick；输入端口本 tick 生效 | 同上 |
| K3 | 环成员恒 X；拓扑序同层按门 id 升序 | `src/core/netlist.mjs` |
| K4 | 稳定判定：连续两 tick 门值与输出都不变；上限 `门数+1`，超限全 X + 诊断 | `src/core/sim.mjs` |
| K5 | xorshift128+，seed 归一 = 整数低 64 位 / 字符串 FNV-1a 64 | `src/core/rng.mjs` |
| K6 | 重抽上限 64，超限显式失败（不换 seed、不放宽） | `src/core/generator.mjs` |
| K7 | 关卡 JSON 键顺序固定，同 seed 逐字节相同 | `levelToJson` |
| K8 | 最少门数 = 各输出单独按引用展开的门数之和；未使用门不计 | `countedGates` |
| K9 | 单输出最少门数 = 公式复杂度（成本表 DP），不可达返回 `-1` | `src/core/solver.mjs` |
| K10 | 探测次数只在输入向量变化时 +1；进入关卡不计 | `src/ui/app.mjs` |
| K11 | 短码位布局见 §4.5；Base64url；≤64 字符；CRC16-CCITT | `src/core/replay.mjs` |
| K12 | fixture 形态配额 `index % 5` 固定；`synthetic: true` | `tools/gen-fixtures.mjs` |
| K13 | 构建产物零外链（`http(s)://` 计数 = 0），出现即构建失败 | `tools/build.mjs` |
| K14 | `verify --require` 未知项报 FAIL | `tools/verify.mjs` |
| K15 | 门基首期只有 `NOT`/`AND`/`OR`（二输入） | `GATE_TYPES` |
| K16 | 零依赖：`dependencies` / `devDependencies` 均为空 | `package.json` |
| K17 | 未使用草稿零件不计分、不进提交网表、不参与校验 | `validateDraft` / `reachableNetlist` |
| K18 | 隐藏关卡不含恒等冗余门 `AND(x,x)` / `OR(x,x)` | `src/core/generator.mjs` |
| K19 | 前 3 关只用"黑盒/开关/灯/拼块/插口"；第 4 关起出现门名 | `src/ui/copy.mjs` |
| K20 | 揭示层级 = 1 + 上游最大层；环成员单列末层；集合只增不减 | `src/core/reveal.mjs` |
| K21 | 命中判定同优先级内取最近距离 | `src/ui/layout.mjs` |
| K22 | 战役前 3 关 `gateBudget:2`、最优恒为 2 门 | `src/ui/level-source.mjs` |
| K23 | src/ 全域不得出现 `undefined` 字面量与时钟/随机 API | `tests/source-hygiene.test.mjs` |
| **K24** | 分享文案 = 探测次数 + 门数差 + 短码；**超长降级**为"原始种子文案 + 探测次数"，永不截断短码 | `src/core/share.mjs` / `copy.mjs` / `tools/smoke.mjs` |
| **K25** | `#r=` **优先于** `#s=`；解码失败明确报错且**不**进普通关卡；成功时保留原 `#r=` | `routeFromLocation` / `tests/share.test.mjs` |
| **K26** | 回放视图只读：提交/清空/删除/摆件/关卡切换禁用；点画布与数字键不改状态 | `src/ui/app.mjs` 的 `readOnly()` / 冒烟回放组 14 项 |
| **K27** | 回放**不重新计数**：探测次数 = 短码步数；步表 = 用短码里的网表对探测序列重算 | `decodeReplay` / `recomputeProbes` |
| **K28** | 回放按 tick 同时推进探测步与揭示层（末尾同到终态）；回放固定用无术语词表 | `advanceReplay` / `replayCopy()` |
| **K29** | 短码 seed 解码必须还原为**无符号 64 位**（`read(32) >>> 0`） | `src/core/replay.mjs` / `tests/replay.test.mjs` |
| **K30** | 短码超长走 `error.code = "code-overflow"`（调用方据此降级，不看文案字符串） | `src/core/replay.mjs` |

## 6. 本机环境坑（本轮实测）

- **本机 Node = v24.15.0，npm = 11.12.1**；`engines` 写 `>=22`，CI 矩阵跑 22 / 24。
- **没有 `python` / `python3`**（本轮批量改文件时踩过：`python - <<EOF` 静默失败，改文件没生效还看不出来）。
  批量替换请用 `node -e` 或 Edit 工具，改完**必须回读**确认。
- **`page.goto` 只改 URL hash 时不会重新加载页面**（同文档导航）。用 `#r=` 深链测回放时，
  必须先切到一个带 query 的地址（如 `index.html?case=replay#r=<code>`）强制真导航；
  否则应用不会重新走路由，`snapshot().replay` 永远是 `null`——**这是测试脚本的坑，不是应用的 bug**
  （应用只在启动时读一次 hash，不监听 `hashchange`；这条限制已记在 README 的玩法说明里）。
- **Node 顶级 await 的未处理拒绝走的是 `uncaughtException`**（不是 `unhandledRejection`），
  只挂后者接不住超时；`tools/smoke.mjs` 两个口都接了。
- **Playwright 不在项目依赖里（K16）**；实际命中的路径是
  `%APPDATA%/npm/node_modules/@playwright/mcp/node_modules/playwright-core`（候选列表第 2 项）。
- **Chromium 必须显式传 `executablePath`**：`%LOCALAPPDATA%/ms-playwright/chromium-1228/chrome-win64/chrome.exe`。
- **Firefox 靠本机 playwright 缓存**（`firefox-1522`），不进依赖、不进仓库；换机器缺缓存时 `verify:engines` SKIP 而非 FAIL。
- **跨引擎脚本用 http 源**：页面内 `import("/src/...")` 需要 http origin，复用 `tools/serve.mjs` 的 `startStaticServer()`。
- **`node --test` 目录形式**有 MODULE_NOT_FOUND 风险 → `package.json` 的 `test` 脚本**逐文件列出**；
  本轮新增 `tests/share.test.mjs` 已同步登记（`tests/test-manifest.test.mjs` 会断言一致）。
- **`git remote` 为空**：所有"CI"表述只能写"本地等价校验（未接远端）"。
- **冒烟默认不写截图**；留证用 `node tools/smoke.mjs --shot docs/smoke-shot.png`（本轮已把截图换成**回放终态**，
  比错误提交态更能说明 M4 的能力）。

## 7. DoD 逐项 checklist

**M1**

- [x] 1000 网表 × 全输入组合与独立第二实现 0 差异（9540 次比对）
- [x] 环网表在有限 tick 内收敛为全 X，不挂死
- [x] fixture 由固定 seed 程序化生成，`--check` 字节级复核
- [x] 非法网表不抛异常，返回结构化错误

**M2**

- [x] 10,000 seed 全部有解、多解/无解 = 0、同 seed 两次生成 JSON 相同
- [x] 跨浏览器（≥2 引擎）哈希相同（`npm run verify:engines`）

**M3**

- [x] 提交网表与隐藏网表 16 行全表比对；结算四项与求解器 100% 一致
- [x] 提交错误给出"行号 + 输入组合 + 端口 + 期望/实际"；揭示层级严格递增
- [x] 门编辑器（摆件 / 点选接线 / 拆线 / 删除 / 键盘可达）；未使用零件不惩罚
- [x] 前 3 关文案无术语（含阳性对照）；任意探测序列可重算

**M4（本轮）**

- [x] `#r=<code>` 直接进入回放视图（冒烟：`#r=` 直达 + 地址栏保留原码 + 只读锁 + 不重新计数）
- [x] 两个浏览器实例重放同一短码逐项相同（`verify:engines`：Chromium / Firefox 各自与 Node 一致且互相一致）
- [x] 短码 ≤ 64 字符（`share.roundtrip` 200 关最长 40 字符）
- [x] 篡改一位被 CRC 识别（`share.roundtrip` 0 漏判 + `replay.test.mjs` 常驻）
- [x] 分享文案含探测次数与门数差（冒烟真实点击 `#share`，短码与纯函数编码逐字节相同）
- [x] 超长降级分支可用（`tests/share.test.mjs` 12 门 × 200 探测 → 降级文案保留探测次数与差值）
- [x] `#r=` 优先于 `#s=`；不可用短码明确提示且不进普通关卡（冒烟实测）
- [x] 变异验证 1（seed 符号）：`read(32) >>> 0` 改回 `read(32)` → `tests/replay.test.mjs` 1 项红（9 个边界 seed 错 6 个）
- [x] 变异验证 2（只读锁）：`readOnly()` 去掉回放态 → 冒烟红 1 项（回放里面板未锁）

**M6（未开始）**

- [ ] `plan/RELEASE-M6.md`（两栏）
- [ ] tag + Release + 附件 sha256

## 8. 关键命令速查（全部本轮实跑过）

```bash
node --version
npm test
npm run verify
npm run verify -- --json
npm run verify -- --out docs/verify-sample.json
npm run verify -- --require share.roundtrip      # 只跑新增的那一段
npm run verify:engines                           # Node + Chromium + Firefox；缺浏览器则 SKIP
npm run build
node tools/check-dist.mjs
node tools/smoke.mjs                             # 真实点击；默认不写截图
node tools/smoke.mjs --shot docs/smoke-shot.png
node tools/cross-engine.mjs --seeds 20
node tools/gen-fixtures.mjs --check
node tools/check-release.mjs
node tools/check-release.mjs --pre-tag
npm run dev                                      # http://127.0.0.1:4173/
node tools/gen-level.mjs --seed 2026-10-19
```

手工验回放（把 `<code>` 换成任意分享短码）：

```bash
npm run dev
# 浏览器打开 http://127.0.0.1:4173/#r=<code>   → 只读回放；改成 #r=<code>&s=campaign/1 仍然进回放
# 故意改掉短码中间一位             → 明确报"这个回放码用不了：…"，不会进到别的关卡
```

## 9. 启动提示词（下一棒）

用户侧启动命令（绝对路径由用户拼）：

```
/goal 读取 "<项目根>\plan\HANDOFF-M4.md" 继续完成任务：
本棒目标是 M6 发布（plan/RELEASE-M6.md → git tag → GitHub Release → check-release.mjs --online 无 FAIL）。
先跑 npm test、npm run verify、npm run verify:engines、node tools/smoke.mjs 复测基线，
再按 §4 待办逐项做；收尾时更新 plan/05 的 M6 DoD 与已知未验证项、刷新 docs/verify-sample.*，
并 commit（tag 与 Release 需要用户明确确认后再动）。
```
