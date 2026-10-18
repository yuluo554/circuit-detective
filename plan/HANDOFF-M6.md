# HANDOFF-M6 · M6 已完成（v0.1.0 已发布：tag + Release + 留档），项目收尾

> 本文件是 **M6 的收尾交接单**，也是**本项目最后一份里程碑交接单**；命名规则见 `plan/00-README总览.md` §一。
> **为什么最后一棒也要写**：`plan/00` §一 钉死"里程碑标 ✅ 就必须有 `plan/HANDOFF-M<k>.md`"，
> 而 M6 是本轮刚翻 ✅ 的里程碑——M5 曾经就因为"产物分批落地、没人记得写交接单"整整漏了一轮
> （见 `HANDOFF-M5.md` §2 最后一条）。既然教训已经变成断言，M6 就不能再犯同一件事。
> 库内路径一律相对仓库根。启动提示词见文末（指向维护/二期，而非下一棒开发）。

## 1. 当前进度与证据

| 项 | 状态 | 证据位置（可复核） |
| --- | --- | --- |
| M0 计划套件 | ✅ | `plan/00`–`plan/06`、`data/README.md` |
| M1 三值 unit-delay 仿真核 + 独立第二实现 + 1000 fixture | ✅ | `src/core/sim.mjs`；`tests/reference/`；`tests/sim-cross.test.mjs` |
| M2 生成器 / 求解器 / 跨引擎一致 | ✅ | `src/core/generator.mjs`、`solver.mjs`；`tools/cross-engine.mjs` |
| M3 编辑器 / 提交 / 结算 / 揭示 | ✅ | `plan/HANDOFF-M3.md` |
| M4 短码回放 / 分享 / 只读回放视图 | ✅ | `plan/HANDOFF-M4.md` |
| M5 `verify` 自检链（10 段）+ 单文件构建 + 静态扫描 | ✅ | `plan/HANDOFF-M5.md` |
| **M6 发布（tag + Release + 留档）** | ✅ 2026-10-18 | `plan/RELEASE-M6.md`（§一 tag 前事实 / §二 tag 后追加）；`https://github.com/yuluo554/circuit-detective` |
| CI 实跑 | ✅ 首推 4/4 绿 | run `39138019748` / `39138218319`；`plan/05` §七 / §八 |

**M6 的交付面（三件套，缺一不可）**

1. **annotated tag** `v0.1.0` → tag 对象 `76b56283d1673a0cdad609cb32b8bec772b6572f`，指向 commit `56f633d1e22dae19065fc4e2ebec80b85d8ed12a`；已推远端。
2. **GitHub Release**（公开仓 `yuluo554/circuit-detective`，已发布非草稿）：附件两份，正文含 sha256 对照表。
3. **发布留档** `plan/RELEASE-M6.md`：tag 前入库（两栏），tag 后回填 §二。

**本棒实测（2026-10-18，Windows + Node v24.15.0；数值取自 `docs/verify-sample.txt` 与实跑输出）**

```
npm test                             → 133 项 / pass 133 / fail 0（21 个测试文件）
npm run verify                       → 10 段全 PASS，rc=0
  sim.cross              1000 fixtures / 9540 comparisons / differences 0
  fixtures.bytes         identical true
  level.generation       10000 seeds / failed 0 / ambiguous 0 / recheck 100%
  replay.crossInstance   3 cases / mismatches 0 / consistency 1
  share.roundtrip        200 cases / encoded 200 / 6 项计数全 0 / maxCodeLength 40
  settlement.closure     400 cases / 六项计数全 0
  reveal.order           500 seeds / nonIncreasing 0 / emptyLayer 0 / uncovered 0
  copy.terms             hits 0 / positiveControl true
  campaign.early         3 levels / optimal [2,2,2]
  build.static           114516 bytes / gzip 34806 / externalLinks 0
npm run verify:engines               → Node + Chromium + Firefox 全绿（关卡 200 seed 差异 0；#r= 回放 5 例步表差异 0）
node tools/smoke.mjs                 → 52 项全绿（真实点击 + 只读回放 + 篡改码报错）
npm run build                        → dist/index.html 114516 字节 / 15 模块 / 零外链
node tools/check-dist.mjs            → PASS 114516 字节 / gzip 34806 / 外链 0
node tools/check-release.mjs         → 发布前 PASS 6 / FAIL 1（RELEASE_DOC）/ SKIP 2；三件套落地后 PASS 7 / FAIL 0 / SKIP 2
node tools/check-release.mjs --online→ **PASS 9 / FAIL 0 / SKIP 0**（rc=0）
```

**产物 sha256（Release 附件，下载回来重算已逐一对上）**

| 附件 | 大小 | sha256 |
| --- | --- | --- |
| `circuit-detective-0.1.0.html`（= `dist/index.html`） | 114,516 字节 | `4e7fdddce85f59a22fab5213f29ef819782583afaa56a702d32dc00e063bcda2` |
| `verify-sample.txt` | 1,547 字节 | `b84a6cc96e034776eaebedd03ebcc006dd4d4c7e64ff3ab35ac511d59163a2c3` |

## 2. 本棒修掉的真实缺陷

| 缺陷 | 症状 | 处理 |
| --- | --- | --- |
| **发布门测试把"瞬态"当契约** | `tests/release-gate.test.mjs` 的"`--pre-tag` 时缺失留档报 SKIP"直接跑真实仓库，**预设了 `plan/RELEASE-M6.md` 不存在**。本轮把留档写出来后该测试立刻红（门报 `PASS` 而非 `SKIP`）——它测的其实是"M6 还没做"，不是门的模式语义 | 给门加 `RELEASE_DOC_PATH` 环境变量（K39），测试用不存在的路径**主动构造**缺档态：缺档 + `--pre-tag` → SKIP、缺档 + 离线 → FAIL、有档 → PASS 两栏齐备。三条断言与 M6 进度解耦（测试 131 → 133） |
| **本机 `github.com:443` 被网络阻断**（不是仓库问题） | `gh repo create` 成功、`api.github.com` 通（`rate_limit` 200），但 `git push` 与 `curl https://github.com` 均超时；HTTPS 远端推不上去 | 改用 **SSH-over-443**：`git remote set-url origin ssh://git@ssh.github.com:443/<owner>/<repo>.git`（`ssh -T -p 443 git@ssh.github.com` 通过）。已记入 `RELEASE-M6.md` §1.7 与本文件 §6 |

> 与 M3/M4/M5 那批同源：**不是"看代码觉得应该没问题"，而是门禁/测试当场红**（或环境当场拒）。
> 本棒**没有**新增源码缺陷——如实记录，不编造"抓到 N 个 bug"。

## 3. 本棒补齐的文档集缺口

| 缺口 | 处理 |
| --- | --- |
| M6 翻 ✅ 后没有自己的交接单（正是 M5 犯过的错） | 补写本文件；并把 `tests/handoff-gate.test.mjs` 的 `REQUIRED` 从 `[1..5]` 扩到 `[1..6]`，让 M6 也进机器断言（删掉本文件 → 该测试红） |
| `plan/05` §五 的 "CI 项未实跑" 长期挂 ⬜ | 首推后按实测改写：§五翻 ✅、§七写入 run 号与 4 个 job 的耗时、§八由"预置说明"改为"实跑说明" |
| 体积末态一直是"M4 快照（M6 回填）" | 改为 v0.1.0 末态 114,516 / 34,806 字节，并指向 `RELEASE-M6.md` §1.3 的 sha256 |

## 4. 下一棒待办（项目已完成，只有维护项）

> 与 `plan/RELEASE-M6.md` §2.4、`plan/06` §四 风险登记同源。**没有 M7 开发棒**。

1. **发布后不改源码**：`v0.1.0` 的附件已定稿。若将来改了 `src/`，必须**升版本号**（K37，两处同时改）+ 新 tag + 新 Release，**不要**覆盖旧附件。
2. **`plan/05` §七 的剩余 ⬜ 是能力边界，不是欠账**：移动端布局（首期只保证桌面）、断网专项验证。要做就另开里程碑并写 DoD。
3. **二期待办（来自 `plan/06` §三 开放项与 `plan/01`）**：扩展门基（NAND / XOR / MUX）、自定义关卡编辑器、每日题。任一项都要先补 DoD 与断言，再动手。
4. **数据/口径纪律**：任何数值口径改动只落在 `data/README.md` §四（单点），并同步 `docs/verify-sample.*`（K32，用 `node tools/verify.mjs --out …` 直跑，别用 `npm run verify`）。
5. **CI 首推已过**：`.github/workflows/ci.yml` 现在是实测过的；再加步骤就要重跑一次并把结果写回 `plan/05` §七。

## 5. 既定口径清单（K 编号，动了会打挂测试）

M6 新增（接 `plan/HANDOFF-M5.md` §5 的 K31–K35）：

| 编号 | 口径 | 落点 |
| --- | --- | --- |
| **K36** | 发布附件**只**给 `dist/index.html` + `docs/verify-sample.txt`；不给源码包/目录压缩包；sha256 登记在 Release 正文 | `plan/RELEASE-M6.md` §1.3 / `tools/check-release.mjs` |
| **K37** | 版本号单一来源 = `package.json` 的 `version` 与 `src/core/version.mjs` 的 `VERSION`，必须一致；tag 名 = `v` + 该版本 | `tools/check-release.mjs` 的 `VERSION_SINGLE_SOURCE` / `TAG_PRESENT` |
| **K38** | `plan/RELEASE-M6.md` 必须两栏齐备（`## 一、tag 前事实` / `## 二、tag 后追加`）且在 tag 前入库；第二栏 tag 前留空 | `tools/check-release.mjs` 的 `RELEASE_DOC` |
| **K39** | 发布留档路径由 `RELEASE_DOC_PATH` 决定（默认 `plan/RELEASE-M6.md`）；该变量是**测试用 seam**，让"缺档报 SKIP / 报 FAIL"在留档存在之后仍可被构造与断言 | `tools/check-release.mjs` / `tests/release-gate.test.mjs` |

M6 直接相关的既有条目：**K13**（零外链）、**K16**（零依赖）、**K23**（src/ 卫生）、**K32**（样例产出方式）、**K33**（构建逐字节确定）、**K34**（测试清单逐文件登记）、**K35**（交接单守门，本轮扩到 M6）。

## 6. 本机环境坑（本轮实测）

- **`github.com:443` 被阻断，`api.github.com` 与 `ssh.github.com:443` 可用**。`gh` 的一切命令正常，
  但 `git push` 走 HTTPS 会超时。推码用：
  `git remote set-url origin ssh://git@ssh.github.com:443/<owner>/<repo>.git`（先 `ssh -T -p 443 git@ssh.github.com` 自检）。
  这是**本机网络**限制，换网络时可以直接换回 HTTPS。
- **沙箱会拦网络**：本机命令需在需要联网时放行沙箱，否则 `git push` / `gh` 报 `Connection reset` / 超时。
- **`gh repo create … --push` 可能在 push 阶段失败而仓库已建好**：此时仓库已存在，别重复 `create`，
  直接 `git remote add/set-url` + `git push` 即可。
- **样例产出必须用 `node` 直跑**（K32）：`npm run verify > docs/verify-sample.txt` 会把 npm banner 写进样例。
- **`docs/verify-sample.*` 里的 p50/p99 每次跑都会变**（只报告不判定）；重跑样例会让这两行进 diff，属正常。
- **本机没有 `python` / `python3`**；批量改文件用 `node -e` 或编辑工具，改完回读确认。
- **`dist/` 与 `release/` 都不入仓**（`.gitignore`；`check-release.mjs` 的 `NO_ARTIFACTS_TRACKED` 会拦前者）。
  `release/` 只放本地副本 + `SHA256SUMS`。

## 7. DoD 逐项 checklist

**M6（三件套，全部完成）**

- [x] git tag（annotated）：`v0.1.0`，对象 `76b56283d167` → commit `56f633d`，已推远端
- [x] GitHub Release：公开仓 `yuluo554/circuit-detective`，附件两份，下载后 sha256 与留档 §1.3 逐一相同
- [x] `plan/RELEASE-M6.md`：tag 前入库（两栏齐备），tag 后回填 §二
- [x] `node tools/check-release.mjs --online` 无 FAIL（PASS 9 / FAIL 0 / SKIP 0）
- [x] 离线门常绿：PASS 7 / FAIL 0 / SKIP 2

**前序里程碑（要点，细节见各自交接单）**

- [x] M1–M5 见 `HANDOFF-M1.md` … `HANDOFF-M5.md`；CI 首推 4/4 绿（`plan/05` §七）

## 8. 关键命令速查（全部本轮实跑过）

```bash
node --version
npm test                                        # 逐文件列出的 21 个测试文件（133 项）
npm run verify                                  # 10 段全量，rc=0 表示全绿
npm run verify:core                             # 4 段快检
npm run build                                   # → dist/index.html（单文件、零外链）
node tools/check-dist.mjs                       # 体积 / gzip / 外链 / 骨架
node tools/check-release.mjs                    # 发布终态自检（离线）
node tools/check-release.mjs --pre-tag          # tag 前：TAG / REMOTE 报 SKIP
node tools/check-release.mjs --online           # 终态：PASS 9 / FAIL 0 / SKIP 0
RELEASE_DOC_PATH=plan/nope.md node tools/check-release.mjs --pre-tag   # 构造"缺档"态（K39）
node tools/gen-fixtures.mjs --check
node tools/cross-engine.mjs --seeds 200
node tools/smoke.mjs                            # 浏览器端到端（需本机 playwright 缓存）
npm run dev                                     # http://127.0.0.1:4173/
```

发布/复核（本机走 SSH-over-443）：

```bash
git remote -v                                   # origin = ssh://git@ssh.github.com:443/yuluo554/circuit-detective.git
git tag -l && git rev-parse v0.1.0 v0.1.0^{commit}
gh release view v0.1.0 --json isDraft,tagName,assets
gh release download v0.1.0 --repo yuluo554/circuit-detective && sha256sum *
```

刷新样例（K32，注意用 `node` 直跑）：

```bash
node tools/verify.mjs --out docs/verify-sample.json > docs/verify-sample.txt
git diff --stat docs/verify-sample.txt   # 确认首行是「黑盒电路侦探 · verify」而不是 npm banner
```

## 9. 启动提示词（后续维护 / 二期）

本棒是**收尾棒**，没有"下一棒开发"。若要继续：

```
/goal 读取 plan/HANDOFF-M6.md 继续本项目：
v0.1.0 已发布（tag + Release + 留档齐备，check-release --online 无 FAIL）。
先按 §4「下一棒待办」确认要做的方向（维护 vs 二期），再跑 npm test、
npm run verify、node tools/check-release.mjs 复测基线。
若只是维护：先看 plan/06 §四 风险登记与 plan/05 §七 的剩余 ⬜。
若开二期（扩展门基 / 自定义关卡 / 每日题）：必须先在 plan/05 补 DoD 与断言再动手，
并遵守 §5 的 K 口径（改口径会打挂测试）。
任何改动若触及 src/，发布侧必须升版本号（K37）：package.json 与 src/core/version.mjs
两处同时改，刷新 docs/verify-sample.*，再打新 tag + Release（不覆盖 v0.1.0 附件）。
```
