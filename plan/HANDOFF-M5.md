# HANDOFF-M5 · M5 已完成（`verify` 自检链 / 单文件构建 / 静态扫描），下一棒 M6

> 本文件是 **M5 的收尾交接单**；命名规则见 `plan/00-README总览.md` §一。
> **补记说明**：M5 没有独立棒次——它的产物（`tools/verify.mjs`、`tools/build.mjs` + `tools/bundle.mjs`、
> `tools/check-dist.mjs`）在 M0/M1/M2/M3 各轮里分批落地，并由 `HANDOFF-M3.md` 以"✅ 9 段"结账，
> 于是 M5 一直没有自己的交接单。本轮（M4）又动了 M5 的产物（`verify` 9 段 → **10 段**、样例刷新、
> 产物字节变化），因此在此**按 M3/M4 的同一格式补齐 M5 收尾**，把 M5 的基线证据钉在当前状态上。
> 库内路径一律相对仓库根。启动提示词见文末。

## 1. 当前进度与证据

| 项 | 状态 | 证据位置（可复核） |
| --- | --- | --- |
| M0 计划套件 | ✅ | `plan/00`–`plan/06`、`data/README.md` |
| M1 三值 unit-delay 仿真核 + 独立第二实现 + 1000 fixture | ✅ | `src/core/sim.mjs`；`tests/sim-cross.test.mjs`；`tools/gen-fixtures.mjs --check` |
| M2 生成器 / 求解器 / 跨引擎一致 | ✅ | `src/core/generator.mjs`、`solver.mjs`；`tools/cross-engine.mjs` |
| M3 编辑器 / 提交 / 结算 / 揭示 | ✅ | 见 `plan/HANDOFF-M3.md` |
| M4 短码回放 / 分享 / 只读回放视图 | ✅ | 见 `plan/HANDOFF-M4.md` |
| **M5 `verify` 自检链（10 段）+ 单文件构建 + 静态扫描** | ✅ | `tools/verify.mjs`、`build.mjs`、`bundle.mjs`、`check-dist.mjs`；`docs/verify-sample.txt` / `.json` |
| M6 发布 | ⬜ | `tools/check-release.mjs` 已就位，`plan/RELEASE-M6.md` 未写 |

**M5 的交付面（四件东西，缺一不可）**

1. `npm run verify`：一条命令跑全量自检，**判定项只有差异数 / 通过率 / 外链数**，耗时只报告。
   10 段：`sim.cross`、`fixtures.bytes`、`level.generation`、`replay.crossInstance`、`share.roundtrip`、
   `settlement.closure`、`reveal.order`、`copy.terms`、`campaign.early`、`build.static`。
2. 三个开关：`--require <段名,…>`（只跑指定段，未知项报 FAIL）、`--json`（机读）、`--out <path>`（落盘）。
   退出码 `0` 全绿 / `1` 有 FAIL / `2` 用法错误。
3. 单文件构建：`npm run build` → `dist/index.html`（零依赖自写拼接、无时间戳、逐字节确定、零外链）。
4. 静态扫描：`node tools/check-dist.mjs`（体积 / gzip / 外链 / 必备骨架）。

**本轮实测（2026-10-18，Windows + Node v24.15.0；数值取自 `docs/verify-sample.txt`）**

```
npm run verify                       → 10 段全 PASS，rc=0
  sim.cross              1000 fixtures / 9540 comparisons / differences 0
  fixtures.bytes         identical true
  level.generation       10000 seeds / failed 0 / ambiguous 0 / recheck 100%
                         p50 0.176ms / p99 0.73ms（只报告，不参与判定）
  replay.crossInstance   3 cases / mismatches 0 / consistency 1
  share.roundtrip        200 cases / encoded 200 / 6 项计数全 0 / maxCodeLength 40
  settlement.closure     400 cases / 六项计数全 0
  reveal.order           500 seeds / nonIncreasing 0 / emptyLayer 0 / uncovered 0
  copy.terms             hits 0 / positiveControl true
  campaign.early         3 levels / optimal [2,2,2]
  build.static           114516 bytes / gzip 34806 / externalLinks 0
npm run verify -- --require share.roundtrip   → 只跑该段（其余 SKIP），rc=0
npm run verify -- --json                      → 机读 payload（tool/version/pass/total/executed/checks[]）
node tools/verify.mjs --out docs/verify-sample.json > docs/verify-sample.txt   → 样例刷新（10 段）
npm run build                        → dist/index.html 114516 字节 / 15 模块 / 零外链
node tools/check-dist.mjs            → PASS dist: 114516 字节 / gzip 34806 / 外链 0
node tools/check-release.mjs         → 离线 PASS 6 / FAIL 1（RELEASE_DOC，M6 范围）/ SKIP 2
```

## 2. M5 门禁抓到过的真实缺陷（历史，都留了证据）

| 缺陷 | 症状 | 处理 |
| --- | --- | --- |
| **D19 `--require` 未知项静默通过** | 首版 `--require core` 既不匹配任何段名也不报错，输出"全绿"但**一段没跑**（"没扫到"伪装成"扫干净"） | 未知项报 FAIL（rc=1），并新增 `verify.args` 段自证；`tests/cli.test.mjs` 常驻 |
| **D18 fixture 形态缺口** | 首版造环逻辑写错，200 条 cyclic 里**实际 0 条有环**，而总条数 1000 仍然"达标" | 形态配额改为 `index % 5` 固定分配 + 段内计数断言，缺口立刻变红 |
| **D21 计分口径自相矛盾** | `countedGates` 按锥内去重时，1/10000 的关卡出现"你的门数 < 最优门数"，与 §4.4「差值 ≥ 0」冲突 | 改为按引用展开计数；`settlement.closure` 的 `differenceFailures` 常驻断言 |
| **D22 恒等冗余门** | `AND(x,x)` / `OR(x,x)` 让"照答案拼装"仍得到差值 1 | 生成器剔除 + 常驻断言 |
| **D25 短码 seed 还原成负数** | `decodeRecord` 用有符号位运算一次读 32 bit；9 个边界 seed 里错 6 个（含 `campaign/1`、`campaign/2`） | 由 M4 轮的回放实装暴露，`read(32) >>> 0` + `tests/replay.test.mjs` 常驻守卫 |
| **M5 自己的交接单一直缺（本轮由用户发现）** | `plan/00` §一 钉死了"每个 ✅ 里程碑收尾写 `HANDOFF-M<k>.md`"，但 M5 的产物在 M0–M3 分批落地、被 `HANDOFF-M3.md` 以"✅ 9 段"结账，于是**整整一轮没人发现少一份交接单**——"靠人记住"必然漏 | 本轮补写本文件；并新增 `tests/handoff-gate.test.mjs` 把这件事从人事变成机器断言：里程碑标 ✅ 就必须有对应交接单、首行标题对得上号、M3 起还要有九段式部件，`plan/05` 状态表与 `plan/00` 索引行一并对账。变异验证：删掉本文件 → 该测试 2 项红 |

> 共同点：这几条都不是"看代码觉得应该没问题"，而是**门禁/测试当场红**（或变异后红）才发现的。
> 本轮新增的 `share.roundtrip` 一次通过 200 关，**没有**新增代码缺陷——如实记录，不编造"抓到 N 个 bug"；
> 真正的缺口是上面最后那条**文档集缺口**：它不是靠人复查发现的，是被用户点出来的，所以已经补成断言。

## 3. 本轮补齐的 M5 侧缺口

| 缺口 | 处理 |
| --- | --- |
| 回放/分享链没有端到端机器判据（只有"跨进程输出一致"） | 新增 `share.roundtrip` 段：200 关「编码 → 解码 → 重演」，六项计数 = 步表失配 / 网表失配 / 最优门数失配 / 超长 / 篡改漏判 / 编码成功数；短码最长 40 字符留档 |
| `docs/verify-sample.*` 停在 M3 快照（9 段 / 92,630 字节） | 本轮真实重跑刷新为 10 段 / 114,516 字节，`docs/verify-sample.json` 同步落盘 |
| 段名清单与 `verify:core` 的 `--require` 名单靠人手同步 | 段名改动会被 `--require` 的未知项判定（K14）立刻拦下；名单见 §8 |
| 冒烟脚本超时不给报告（工具链本身的可诊断性） | 已修（M4 轮，见 `HANDOFF-M4.md` §2） |

## 4. 下一棒待办（M6 发布）

> 与 `plan/HANDOFF-M4.md` §4 是同一份清单；若两处措辞不一致，**以本节为准**。

1. `plan/RELEASE-M6.md`（**tag 前入库**，两栏：`## 一、tag 前事实` / `## 二、tag 后追加`）——
   `check-release.mjs` 的 `RELEASE_DOC` 会一直 FAIL 直到它存在。
2. 版本号收口：`package.json` 与 `src/core/version.mjs` 同源（`VERSION_SINGLE_SOURCE` 已 PASS）；
   去掉 `-dev.0` 后缀要**两处同时改**。
3. `git tag`（annotated）+ GitHub Release：附件 = `dist/index.html` + `docs/verify-sample.txt`；
   sha256 登记在 Release 正文（D13：源码 zipball 不能替代单文件产物）。
4. **远端未接**：`git remote` 为空、`gh` 未登录 → `check-release.mjs --online` 以 exit 3 报环境缺失
   （既不是 FAIL 也不是 PASS）。
5. CI 首推后把 `plan/05` §七 的"CI 实跑 ⬜"翻成实测结论；首推前只能写"本地等价校验（未接远端，CI 待首推验证）"。
6. 发布前重跑一次 `npm run verify` 并刷新 `docs/verify-sample.*`（产物字节会随最终源码变化）。

## 5. 既定口径清单（K 编号，动了会打挂测试）

M5 直接相关的既有条目：

| 编号 | 口径 | 落点 |
| --- | --- | --- |
| K13 | 构建产物零外链（`http(s)://` 计数 = 0），出现即构建失败 | `tools/build.mjs` / `build.static` 段 |
| K14 | `verify --require` 未知项报 FAIL | `tools/verify.mjs` |
| K16 | 零依赖：`dependencies` / `devDependencies` 均为空（因此**没有打包器**，也没有 playwright 依赖） | `package.json` |
| K23 | src/ 全域不得出现 `undefined` 字面量与时钟/随机 API（产物断言的前置条件） | `tests/source-hygiene.test.mjs` |

本轮为 M5 新增：

| 编号 | 口径 | 落点 |
| --- | --- | --- |
| **K31** | `verify` 的判定项只有**差异数 / 通过率 / 外链数**；耗时（p50/p99）只报告，不参与红绿 | `tools/verify.mjs` 的 `checkGeneration` / `checkBuild` |
| **K32** | `docs/verify-sample.*` 必须由 `node tools/verify.mjs` **直接**产出（`npm run verify` 会在 stdout 里塞 npm banner，污染样例）；改过 `src/` 或增删段名后必须重跑 | `docs/verify-sample.txt` 首行 = `黑盒电路侦探 · verify` |
| **K33** | 构建产物**逐字节确定**：无时间戳、文件顺序固定、`index.html` 的 CRLF 归一为 LF；同源码两次构建一致 | `tools/build.mjs` / `tests/build.test.mjs` |
| **K34** | `package.json` 的 `test` 脚本**逐文件列出**（`node --test tests/` 目录形式在本机与 CI 都有 MODULE_NOT_FOUND 风险），与 `tests/test-manifest.test.mjs` 同源 | `package.json` / `tests/test-manifest.test.mjs` |
| **K35** | 里程碑在 `plan/05` 标 ✅ 就必须有 `plan/HANDOFF-M<k>.md`，且首行标题对得上号（M3 起还要有九段式部件） | `tests/handoff-gate.test.mjs` |

## 6. 本机环境坑（M5 相关，本轮实测）

- **本机 Node = v24.15.0，npm = 11.12.1**；`engines` 写 `>=22`，CI 矩阵跑 22 / 24。
- **本机没有 `python` / `python3`**：别在脚本或流程里假设有；批量改文件用 `node -e`，改完必须回读确认。
- **样例文件的产出方式**：必须 `node tools/verify.mjs --out docs/verify-sample.json > docs/verify-sample.txt`。
  用 `npm run verify > docs/verify-sample.txt` 会把 `> circuit-detective@0.1.0-dev.0 verify` 两行 banner 写进样例（K32）。
- **`dist/` 不入仓**（`.gitignore`；`check-release.mjs` 的 `NO_ARTIFACTS_TRACKED` 会拦）；产物由 M6 作为 Release 附件承载。
- **CI 未接远端**：`.github/workflows/ci.yml` 只做过本地 YAML 解析 + 按步手工复跑；CI 不跑浏览器级脚本
  （`smoke` / `verify:engines` 需要本机 playwright 缓存），因此这两条只是**本地等价校验**。
- **段名即契约**：`package.json` 的 `verify:core` 写死了 4 个段名（`sim.cross`、`fixtures.bytes`、`level.generation`、`replay.crossInstance`）；改段名必须同步，否则 `--require` 会 FAIL（这是**故意**的，K14）。
- **Windows 换行**：`tools/build.mjs` 读模板时 `.replace(/\r\n/g, "\n")`，否则产物字节数会随检出配置漂移（K33）。

## 7. DoD 逐项 checklist

**M5**

- [x] `docs/verify-sample.txt` = 一次真实 `npm run verify` 输出（含 p50/p99、通过率、外链数）
- [x] 构建产物零外链（`build.static` 段外链数 = 0；`node tools/check-dist.mjs` PASS）
- [x] 一条命令输出全量判定：10 段，rc=0；`--require` / `--json` / `--out` 三个开关可用
- [x] 未知 `--require` 项报 FAIL（不静默）
- [x] 文档集守门：`tests/handoff-gate.test.mjs` 断言每个 ✅ 里程碑都有交接单、且部件齐备（本轮补，变异验证过：删文件即红）
- [ ] CI 任一项失败即红（workflow 已预置，**未实跑**——无远端）

**M6**

- [ ] `plan/RELEASE-M6.md`（两栏）
- [ ] tag + Release + 附件 sha256

**前序里程碑（要点，细节见各自交接单）**

- [x] M1：1000 网表 × 全输入组合与独立第二实现 0 差异；环收敛为全 X；fixture 字节级复核
- [x] M2：10k seed 全有解、多解/无解 0；同 seed 字节级一致；跨引擎（Node + Chromium + Firefox）一致
- [x] M3：全表比对；结算与求解器 100% 一致；揭示层级严格递增；前 3 关无术语
- [x] M4：`#r=` 只读回放（两引擎步表差异 0）；分享文案含探测次数与门数差；篡改 0 漏判

## 8. 关键命令速查（全部本轮实跑过）

```bash
node --version
npm test                                        # 逐文件列出的 21 个测试文件（131 项）
npm run verify                                  # 10 段全量，rc=0 表示全绿
npm run verify -- --json
npm run verify -- --out docs/verify-sample.json
npm run verify -- --require share.roundtrip     # 只跑回放/分享闭环那一段
npm run verify:core                             # 4 段快检（sim.cross / fixtures.bytes / level.generation / replay.crossInstance）
npm run build                                   # → dist/index.html（单文件、零外链）
node tools/check-dist.mjs                       # 体积 / gzip / 外链 / 骨架
node --test tests/handoff-gate.test.mjs          # 交接单守门（缺一份就红）
node tools/check-release.mjs                    # 发布终态自检（离线）
node tools/check-release.mjs --pre-tag
node tools/gen-fixtures.mjs --check
node tools/cross-engine.mjs --seeds 200
node tools/smoke.mjs                            # 浏览器端到端（需本机 playwright 缓存，缺则 SKIP）
npm run dev                                     # http://127.0.0.1:4173/
```

刷新样例（K32，注意用 `node` 直跑）：

```bash
node tools/verify.mjs --out docs/verify-sample.json > docs/verify-sample.txt
git diff --stat docs/verify-sample.txt   # 确认首行是「黑盒电路侦探 · verify」而不是 npm banner
```

## 9. 启动提示词（下一棒）

用户侧启动命令（绝对路径由用户拼）：

```
/goal 读取 "<项目根>\plan\HANDOFF-M5.md" 继续完成任务：
本棒目标是 M6 发布。先读本文件 §1 的 verify/构建基线证据与 §4 的待办清单
（M4 侧的收尾记录在 plan/HANDOFF-M4.md），再跑 npm test、npm run verify、
npm run verify:engines、node tools/smoke.mjs、node tools/check-release.mjs 复测基线；
然后写 plan/RELEASE-M6.md（两栏、tag 前入库）、收口版本号、刷新 docs/verify-sample.*，
并 commit。tag 与 GitHub Release 属于对外动作，需要用户明确确认后再动
（当前 git remote 为空、gh 未登录，先解决远端再接续第 4 项）。
```
