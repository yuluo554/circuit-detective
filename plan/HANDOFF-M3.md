# HANDOFF-M3 · M3 已完成（编辑器 / 提交 / 结算 / 逐层点亮），下一棒 M4

> 本文件是 **M3 的收尾交接单**；命名规则见 `plan/00-README总览.md` §一。
> 下一棒（M4）读本文件即可；补记的 M2 记录在 `plan/HANDOFF-M2.md`。
> 库内路径一律相对仓库根。启动提示词见文末。

## 1. 当前进度与证据

| 项 | 状态 | 证据位置（可复核） |
| --- | --- | --- |
| M0 计划套件 | ✅ | `plan/00`–`plan/06`、`data/README.md` |
| M1 三值 unit-delay 仿真核 | ✅ | `src/core/sim.mjs`；`tests/sim.test.mjs`；`tests/sim-cross.test.mjs` |
| M1 独立第二实现 | ✅ | `tests/reference/sim-reference.mjs`（不 import 生产模块） |
| M1 fixture（1000 条、五形态各 200） | ✅ | `data/fixtures/netlists.json`；`tools/gen-fixtures.mjs --check` |
| M2 xorshift128+ 生成器 | ✅ | `src/core/rng.mjs`、`src/core/generator.mjs`；`plan/HANDOFF-M2.md` |
| M2 求解器（成本表 DP）+ 最优解可构造 | ✅ | `src/core/solver.mjs`（`optimalNetlist`） |
| M2 跨引擎一致（≥2 引擎） | ✅ | `tools/cross-engine.mjs`（Node + Chromium + Firefox） |
| **M3 编辑器 / 提交 / 结算 / 揭示** | ✅ | `src/core/editor.mjs`、`judge.mjs`、`reveal.mjs`、`src/ui/layout.mjs`、`render.mjs`、`app.mjs`、`copy.mjs` |
| M4 短码内核 | 🟡 | `src/core/replay.mjs`（UI 未接线） |
| M5 `verify` | ✅ 9 段 | `tools/verify.mjs`；`docs/verify-sample.txt` |
| M6 发布 | ⬜ | `tools/check-release.mjs` 已就位，`plan/RELEASE-M6.md` 未写 |

**本轮实测（2026-10-18，Windows + Node v24.15.0）**

```
npm test                        → tests 117 / pass 117 / fail 0
npm run verify                  → 9 段全 PASS，rc=0
                                  sim.cross: 1000 fixtures / 9540 comparisons / 0 differences
                                  level.generation: 10000 seeds / failed 0 / ambiguous 0 / recheck 100%
                                  settlement.closure: 400 cases / 六项计数全 0
                                  reveal.order: 500 seeds / nonIncreasing 0 / emptyLayer 0 / uncovered 0
                                  copy.terms: hits 0 / positiveControl true
                                  campaign.early: 3 levels / optimal [2,2,2]
                                  build.static: 92630 bytes / gzip 28190 / externalLinks 0
npm run build                   → dist/index.html（单文件、13 模块、零外链）
npm run verify:engines          → Node + Chromium + Firefox，200 seed × 3 运行时
                                  关卡 JSON 与探测重算逐字节一致，差异 0（约 6s）
node tools/smoke.mjs            → 32 项全绿（headless Chromium，真实点击画布）
node tools/check-release.mjs    → 离线模式 PASS 6 / FAIL 1 / SKIP 2
                                  FAIL 只剩 RELEASE-M6 未写（符合预期）
```

## 2. 本轮修掉的四个真实缺陷（都做过复现/变异验证，不是"应该会红"）

1. **计分口径自相矛盾（D21）**：`countedGates` 按输出锥去重时，10000 关里有 1 关出现
   `你的门数 6 < 最优 7`，与 `data/README.md` §4.4「差值 ≥ 0」直接冲突。
   改为**按引用展开计数**（同一输出内的重复引用也各计一次）后差值恒非负。
2. **相邻拼块抢点击（D24）**：命中判定原按"引脚 > 插口"类型优先，点 A 的输出会命中 B 的输入。
   端到端冒烟实测复现（`g03` 引脚漏接）。改为同优先级内**按距离取最近**。
3. **生成器允许恒等冗余门（D22）**：`AND(x,x)` / `OR(x,x)` 在 10000 关里有 4864 处引用，
   导致"照答案拼装"仍得到差值 1。改为候选阶段显式剔除。
4. **`undefined` 字面量埋在 `src/core/replay.mjs`**：M4 一旦把短码接进 UI，
   构建断言（产物不得含 `undefined`）就会红。已改成 `typeof x !== "string"`，
   并新增 `tests/source-hygiene.test.mjs` 把这条守卫前移到 src/ 全域。

## 3. 本轮补齐的 M3 功能缺口

| 缺口 | 处理 |
| --- | --- |
| 玩家接错线只能删掉整个零件 | 补"拆线"入口：没有待接来源时，点一个已接好的入口即断开（`disconnectPin` / `setOutput`） |
| 界面文案散落在 `app.mjs` | 全部收敛到 `src/ui/copy.mjs`（含 readout 提示语），D1 扫描有唯一对象 |
| 端到端只覆盖"结构不全"的拒绝 | 冒烟新增"结构完整但功能错误"的提交，断言 `第 N 行 · 开关 0110 · 1 号灯 · 应亮 x · 实际 y` |
| 笔记（D11）没有验证 | 冒烟新增：写入 → 刷新 → 仍在（按关卡 key 存 `localStorage`） |
| 死代码 | 删除无人引用的导出：`snapIntoWorkArea`/`gateTypes`/`SOCKET_RADIUS`（layout）、`levelHeader`/`isSupportedLevel`（level-source）、`signalIds`/`DEFAULT_INPUT_COUNT`/`DEFAULT_OUTPUT_COUNT`（netlist）、`BOARD_SIZE` 等再导出（render）、5 个未用文案键（copy） |

## 4. 下一棒待办（M4）

1. **`#r=<code>` 路由**：`decodeRecord` → 重建关卡 → 回放视图（按步推进探测，不重新计数）。
   - 与 `#s=` 的优先级要定死（建议 `#r=` 优先，并在地址栏保留原码）。
   - 失败路径：校验失败 / 版本不兼容 → 明确提示，**不**静默进入普通关卡。
2. **分享文案**：探测次数 + 门数差 + 短码；超 64 字符时的降级文案（只给 seed + 探测数）。
3. **回放视图**：只读展示隐藏网表与探测序列，不允许编辑；与揭示动画共用 `buildRevealPlan`。
4. **把 `share` 按钮接上**（当前 `disabled`，点击只显示探测次数摘要）。
5. **补测试**：
   - `#r=` 解码 → 回放输出逐项等于 `recomputeProbes`；
   - 分享文案含两个字段，超长时走降级分支；
   - 回放视图不可编辑（提交/清空按钮禁用）；
   - 建议顺手给 `verify` 加一段 `share.roundtrip`（编码→解码→重演一致率）。

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
| K8 | 最少门数 = 各输出单独按引用展开的门数之和；未使用门不计 | `data/README.md` §4.3 / `countedGates` |
| K9 | 单输出最少门数 = 公式复杂度（成本表 DP），不可达返回 `-1` | `src/core/solver.mjs` |
| K10 | 探测次数只在输入向量变化时 +1；进入关卡不计 | `src/ui/app.mjs` |
| K11 | 短码位布局见 §4.5；Base64url；≤64 字符；CRC16-CCITT | `src/core/replay.mjs` |
| K12 | fixture 形态配额 `index % 5` 固定；`synthetic: true` | `tools/gen-fixtures.mjs` |
| K13 | 构建产物零外链（`http(s)://` 计数 = 0），出现即构建失败 | `tools/build.mjs` |
| K14 | `verify --require` 未知项报 FAIL | `tools/verify.mjs` |
| K15 | 门基首期只有 `NOT`/`AND`/`OR`（二输入）；扩展门基不动既有行 | `GATE_TYPES` |
| K16 | 零依赖：`dependencies` / `devDependencies` 均为空 | `package.json` |
| K17 | 未使用草稿零件不计分、不进提交网表、不参与校验 | `validateDraft` / `reachableNetlist` |
| K18 | 隐藏关卡不含恒等冗余门 `AND(x,x)` / `OR(x,x)` | `src/core/generator.mjs` |
| K19 | 前 3 关只用"黑盒/开关/灯/拼块/插口"；第 4 关起出现门名 | `src/ui/copy.mjs` |
| K20 | 揭示层级 = 1 + 上游最大层；环成员单列末层；集合只增不减 | `src/core/reveal.mjs` |
| K21 | 命中判定同优先级内取最近距离 | `src/ui/layout.mjs` |
| K22 | 战役前 3 关 `gateBudget:2`、最优恒为 2 门 | `src/ui/level-source.mjs` |
| K23 | src/ 全域不得出现 `undefined` 字面量与时钟/随机 API（守卫前移） | `tests/source-hygiene.test.mjs` |

## 6. 本机环境坑（本轮实测）

- **本机 Node = v24.15.0，npm = 11.12.1**。`engines` 写 `>=22`，CI 矩阵跑 22 / 24。
- **Playwright 不在项目依赖里（K16）**。`tools/smoke.mjs` 与 `tools/cross-engine.mjs` 按以下顺序
  动态找 `playwright-core`：`PLAYWRIGHT_CORE` → `%APPDATA%/npm/node_modules/@playwright/mcp/node_modules/playwright-core`
  → `%APPDATA%/npm/node_modules/playwright-core` → 本地 `node_modules`；找不到就 SKIP 并 rc=0。
- **Chromium 必须显式传 `executablePath`**：`%LOCALAPPDATA%/ms-playwright/chromium-1228/chrome-win64/chrome.exe`
  （默认的 `chromium_headless_shell-1224` 在本机不存在，不传会报 "Executable doesn't exist"）。
- **Firefox 已装入本机 playwright 缓存**（`%LOCALAPPDATA%/ms-playwright/firefox-1522`），
  用 `playwright-core/cli.js install firefox` 装的，**不进项目依赖、不进仓库**；
  换机器若无该缓存，`verify:engines` 会 SKIP 而不是报 FAIL。
- **跨引擎脚本用 http 源**：页面内 `import("/src/core/generator.mjs")` 需要 http origin，
  因此复用 `tools/serve.mjs` 导出的 `startStaticServer()`（`file://` 下模块导入会被浏览器拦）。
- **`node --test` 目录形式**在本机与 CI 都有 MODULE_NOT_FOUND 风险 → `package.json` 的 `test`
  脚本**逐文件列出**；新增测试文件必须同步改这一处（`tests/test-manifest.test.mjs` 会断言一致）。
- **`git remote` 为空**：所有"CI"表述只能写"本地等价校验（未接远端）"。
- **冒烟默认不写截图**（像素抗锯齿会随时序抖动、反复跑会脏工作树）；留证用
  `node tools/smoke.mjs --shot docs/smoke-shot.png`。

## 7. DoD 逐项 checklist

**M1**

- [x] 1000 网表 × 全输入组合与独立第二实现 0 差异（9540 次比对）
- [x] 环网表在有限 tick 内收敛为全 X，不挂死（200 条 cyclic fixture）
- [x] fixture 由固定 seed 程序化生成，`--check` 字节级复核（五形态各 200，全部 `synthetic: true`）
- [x] 非法网表不抛异常，返回结构化错误

**M2**

- [x] 10,000 seed 全部有解（`failed 0`）
- [x] 多解 / 无解 = 0（`ambiguous 0`）
- [x] 同 seed 两次生成 JSON 完全相同
- [x] 跨浏览器（≥2 引擎）哈希相同（`npm run verify:engines`：Node + Chromium + Firefox）

**M3**

- [x] 提交网表与隐藏网表 16 行全表比对，不做抽样
- [x] 结算面板四项与求解器 100% 一致（400 关 0 漂移）
- [x] 提交错误答案给出"行号 + 输入组合 + 端口 + 期望/实际"
- [x] 揭示层级严格递增（500 关断言）
- [x] 前 3 关文案扫描无"门 / NAND / AND / OR / NOT"（含阳性对照）
- [x] 任意探测序列可由 `seed + 网表` 重算并逐项相同
- [x] 门编辑器：摆件、点选接线、**拆线**、删除、32×32 吸附、键盘可达
- [x] 未使用零件不惩罚（不计分、不进提交网表）
- [x] 笔记按关卡存 `localStorage`（冒烟验证刷新后仍在）
- [x] 端到端冒烟 32 项（真实点击画布，含错误提交反馈）

**M4（未开始）**

- [ ] `#r=<code>` 路由 / 回放视图 / 分享文案
- [ ] 两浏览器重放同一短码逐项相同

**M6（未开始）**

- [ ] `plan/RELEASE-M6.md`
- [ ] tag + Release + 附件 sha256

## 8. 关键命令速查（全部本轮实跑过）

```bash
node --version
npm test
npm run verify
npm run verify -- --json
npm run verify -- --out docs/verify-sample.json
npm run verify:core
npm run verify:engines          # Node + Chromium + Firefox；缺浏览器则 SKIP
npm run build
node tools/check-dist.mjs
node tools/smoke.mjs            # 真实点击；默认不写截图
node tools/smoke.mjs --shot docs/smoke-shot.png
node tools/cross-engine.mjs --seeds 500
node tools/gen-fixtures.mjs --check
node tools/check-release.mjs
node tools/check-release.mjs --pre-tag
npm run dev                     # http://127.0.0.1:4173/
node tools/gen-level.mjs --seed 2026-10-19
node tools/gen-level.mjs --seed campaign/1 --count 3
```

## 9. 启动提示词（下一棒）

用户侧启动命令（绝对路径由用户拼）：

```
/goal 读取 "<项目根>\plan\HANDOFF-M3.md" 继续完成任务：
本棒目标是 M4（#r= 路由 / 回放视图 / 分享文案 / 两浏览器一致）。
先跑 npm test、npm run verify 与 npm run verify:engines 复测基线，再按 §4 待办逐项实现；
每完成一项补测试并跑全量，收尾时更新 docs/verify-sample.txt、写 plan/HANDOFF-M4.md
（按 §5 的 K 清单格式）并 commit。
```
