# HANDOFF-M1 · 仿真核 / 生成器 / 求解器 已完成，下一棒 M3

> 库内路径一律相对仓库根。启动提示词见文末。

## 1. 当前进度与证据

| 项 | 状态 | 证据位置（可复核） |
| --- | --- | --- |
| M0 计划套件 | ✅ | `plan/00`–`plan/06`、`data/README.md` |
| M1 三值 unit-delay 仿真核 | ✅ | `src/core/sim.mjs`；`tests/sim.test.mjs`；`tests/sim-cross.test.mjs` |
| M1 独立第二实现 | ✅ | `tests/reference/sim-reference.mjs`（不 import 生产模块） |
| M1 fixture（1000 条、五形态） | ✅ | `data/fixtures/netlists.json`；`tools/gen-fixtures.mjs --check` |
| M2 xorshift128+ 生成器 | ✅ | `src/core/rng.mjs`、`src/core/generator.mjs` |
| M2 求解器（成本表 DP） | ✅ | `src/core/solver.mjs`；口径 `data/README.md` §4.3 |
| M4 短码内核 | 🟡 | `src/core/replay.mjs`（UI 未接线） |
| M5 `verify` | 🟡 | `tools/verify.mjs`；样例 `docs/verify-sample.txt` |
| M3 编辑器 / 提交 / 结算 | ⬜ | `plan/03-模块详设.md` §M3 |
| M6 发布 | ⬜ | `tools/check-release.mjs` 已就位，`plan/RELEASE-M6.md` 未写 |

**本轮实测（2026-10-18，Windows + Node v24.15.0）**

```
npm test          → tests 69 / pass 69 / fail 0
npm run verify    → 5 段全 PASS，rc=0
                    sim.cross: 1000 fixtures / 9540 comparisons / 0 differences
                    level.generation: 10000 seeds / failed 0 / ambiguous 0 / recheck 100%
                    p50 0.16ms / p99 0.68ms（报告项，不参与判定）
                    replay.crossInstance: consistency 1
                    build.static: 38370 bytes / gzip ~13.3KB / 外链 0
npm run build     → dist/index.html（单文件，零外链）
node tools/check-release.mjs → 离线模式 PASS 5 / FAIL 2 / SKIP 2
                    FAIL 的两项都是"发布还没做"（工作树未提交、RELEASE-M6 未写），符合预期
headless Chrome   → 0 page errors；资源请求 0（除文档自身）；拨杆→灯生效；探测计数 0→1→2→3
```

**变异验证（做过，不是"应该会红"）**

| 变异 | 结果 | 已还原 |
| --- | --- | --- |
| 把 `AND` 的 X 分支改成常量 `1` | `npm test`：39 pass / 1 fail（当时总数 40） | ✅ |
| 改一条 fixture 的 gate type | `verify`：`sim.cross` + `fixtures.bytes` 双红 | ✅ |
| `--require` 未知项（首版 `core`） | 曾静默全绿 → 已修成报 FAIL | ✅ |
| 发布门：`--pre-tag` 模式 | `RELEASE_DOC` 报 SKIP 而非 FAIL（有测试锁住） | — |

## 2. 下一棒待办（M3）

1. **门编辑器**：画布上摆放 `NOT` / `AND` / `OR`、点选引脚连线、删除；32×32 网格吸附。
   - 交互模型见 `plan/06` Q1（倾向"点选引脚"，键盘可达）。
   - 编辑产物必须能被 `validateNetlist` 接受，非法连线在**提交前**就给出提示。
2. **提交校验**：`firstMismatch(submitted, hidden)` 已有；把它接到按钮上，展示
   行号 + 输入组合 + 端口 + 期望/实际。
3. **结算面板**：`countedGates` / `level.optimal` / 差值 / `probes`。
4. **逐层点亮**：按 `topoOrder` 的层级序列递增渲染；`prefers-reduced-motion` 直接终态。
5. **D1 术语门槛**：前 3 关 UI 文案扫描不得出现"门" / "NAND"（写成测试）。
6. **补充测试**：
   - 任意探测序列 → `seed + 网表` 重算逐项相同；
   - 结算差值与求解器一致（含"多摆未使用门"用例）；
   - 揭示层级严格递增（读渲染层暴露的层级序列，不靠截图）。

## 3. 既定口径清单（K 编号，动了会打挂测试）

| 编号 | 口径 | 落点 |
| --- | --- | --- |
| K1 | 三值编码 `0/1/2`，`2 = X`；纯整数，无浮点 | `data/README.md` §4.1 / `src/core/sim.mjs` |
| K2 | unit-delay：门读上一 tick；输入端口本 tick 生效 | 同上 |
| K3 | 环成员恒 X；拓扑序同层按门 id 升序 | `src/core/netlist.mjs` |
| K4 | 稳定判定：连续两 tick 门值与输出都不变；上限 `门数+1`，超限全 X + 诊断 | `src/core/sim.mjs` |
| K5 | xorshift128+，seed 归一 = 整数低 64 位 / 字符串 FNV-1a 64 | `src/core/rng.mjs` |
| K6 | 重抽上限 64，超限显式失败（不换 seed、不放宽） | `src/core/generator.mjs` |
| K7 | 关卡 JSON 键顺序固定，同 seed 逐字节相同 | `levelToJson` |
| K8 | 最少门数 = 各输出锥内部门数之和；共享门重复计；未使用门不计 | `data/README.md` §4.3 / `countedGates` |
| K9 | 单输出最少门数 = 公式复杂度（成本表 DP），不可达返回 `-1` | `src/core/solver.mjs` |
| K10 | 探测次数只在输入向量变化时 +1；进入关卡不计 | `src/ui/app.mjs` |
| K11 | 短码位布局见 §4.5；Base64url；≤64 字符；CRC16-CCITT | `src/core/replay.mjs` |
| K12 | fixture 形态配额 `index % 5` 固定；`synthetic: true` | `tools/gen-fixtures.mjs` |
| K13 | 构建产物零外链（`http(s)://` 计数 = 0），出现即构建失败 | `tools/build.mjs` |
| K14 | `verify --require` 未知项报 FAIL | `tools/verify.mjs` |
| K15 | 门基首期只有 `NOT`/`AND`/`OR`（二输入）；扩展门基不动既有行 | `GATE_TYPES` |
| K16 | 零依赖：`dependencies` / `devDependencies` 均为空 | `package.json` |

## 4. 本机环境坑（本轮实测）

- **本机 Node = v24.15.0，npm = 11.12.1**（`node --version` 实测于 2026-10-18）。
  `package.json` 的 `engines` 写 `>=22`，CI 矩阵跑 22 / 24。
- **Playwright 不在项目依赖里**：本机冒烟用全局 `@playwright/mcp` 自带的核心，路径为
  `%APPDATA%/npm/node_modules/@playwright/mcp/node_modules/playwright-core`，
  浏览器可执行文件在 `%LOCALAPPDATA%/ms-playwright/chromium-1228/chrome-win64/chrome.exe`。
  它要求的 `chromium_headless_shell-1224` 本机不存在 → 必须显式传 `executablePath`，否则 `launch` 报
  "Executable doesn't exist"。**不要为此往项目里加 playwright 依赖**（K16）。
- **`file://` 可直接打开构建产物**，`performance.getEntriesByType("resource").length` 为 0，
  仅 1 条文档请求 —— 这是"零外链"的动态旁证，不只是静态扫描。
- **`node --test` 目录形式**在本机与 CI 都有 MODULE_NOT_FOUND 风险 → `package.json` 的 `test`
  脚本**逐文件列出**测试；新增测试文件必须同步改 `package.json` 一处（`tests/test-manifest.test.mjs`
  会断言"目录里的测试文件数 == package.json 列出的文件数"）。
- **git 提交身份**已配置为 `yuluo554 <282769740+yuluo554@users.noreply.github.com>`（noreply，可发布）。
- **无远端**：`git remote -v` 为空。因此本轮所有"CI"表述只能写"本地等价校验（未接远端）"。
- **`docs/smoke-shot.png` 是 1280×720 的 headless 截图**，可随仓入库（~130KB）；若嫌大，M6 前可删。

## 5. DoD 逐项 checklist

**M1**

- [x] 1000 网表 × 全输入组合与独立第二实现 **0 差异**（9540 次比对）
- [x] 环网表在有限 tick 内收敛为全 X，不挂死（200 条 cyclic fixture 实测）
- [x] fixture 由固定 seed 程序化生成，`--check` 字节级复核
- [x] 非法网表不抛异常，返回结构化错误

**M2**

- [x] 10,000 seed 全部有解（failed 0）
- [x] 多解/无解 = 0（ambiguous 0）
- [x] 同 seed 两次生成 JSON 完全相同
- [ ] 跨浏览器（≥2 引擎）哈希相同 —— **未做**，只有 Chromium 冒烟

**M4（内核）**

- [x] 编码唯一、URL 安全、≤64 字符
- [x] 篡改一位被 CRC 识别；版本不兼容显式报错
- [x] 跨进程回放一致率 100%
- [ ] `#r=<code>` UI 路由 / 回放视图 / 分享文案

**M5**

- [x] `npm run verify` 一条命令可跑，输出 p50/p99、复核通过率、回放一致率、外链数
- [x] `docs/verify-sample.txt` 为真实输出
- [ ] CI 实跑（未推送，**待首推验证**）

**M6**

- [x] 发布门脚本 `tools/check-release.mjs`（离线 / `--pre-tag` / `--online` 三模）
- [ ] `plan/RELEASE-M6.md`
- [ ] tag + Release + 附件 sha256

## 6. 关键命令速查（全部本轮实跑过）

```bash
node --version
npm test
npm run verify
npm run verify -- --json
npm run verify -- --out docs/verify-sample.json
npm run verify:core
npm run build
node tools/check-dist.mjs
node tools/gen-fixtures.mjs
node tools/gen-fixtures.mjs --check
node tools/check-release.mjs
node tools/check-release.mjs --pre-tag
npm run dev            # http://127.0.0.1:4173/
node tools/gen-level.mjs --seed 2026-10-19
node tools/gen-level.mjs --seed 7 --count 3
node tools/gen-level.mjs --help     # 用法；缺参数 / 未知参数 exit 2
```

## 7. 启动提示词（下一棒）

用户侧启动命令（绝对路径由用户拼）：

```
/goal 读取 "<项目根>\plan\HANDOFF-M1.md" 继续完成任务：
本棒目标是 M3（门编辑器 / 提交校验 / 结算面板 / 逐层点亮 / D1 术语门槛）。
先跑 npm test 与 npm run verify 复测基线，再按 §2 待办逐项实现；每完成一项补测试并跑全量，
收尾时写 plan/HANDOFF-M4.md（六节）并 commit。
```
