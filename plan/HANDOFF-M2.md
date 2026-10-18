# HANDOFF-M2 · 生成器与求解器收尾（补记）

> **本轮是补记**：M1 与 M2 在同一个提交（`defd4f1`）里落地，当时只写了 `plan/HANDOFF-M1.md`。
> 本文件把 M2 这一段的交付内容、DoD 证据与遗留项如实补齐，不新增任何未做过的结论。
> 命名约定见 `plan/00-README总览.md` §一：`plan/HANDOFF-M<k>.md` = 第 k 个里程碑的**收尾交接单**。

## 1. M2 交付内容与证据

| 项 | 状态 | 证据位置（可复核） |
| --- | --- | --- |
| xorshift128+ PRNG + FNV-1a seed 归一 | ✅ | `src/core/rng.mjs`；`tests/rng.test.mjs` |
| 随机网表生成（门基 NOT/AND/OR，重抽上限 64） | ✅ | `src/core/generator.mjs` |
| 求解器：成本表 DP（公式复杂度，16 位掩码） | ✅ | `src/core/solver.mjs`；`tests/solver.test.mjs` |
| 关卡 JSON 冻结格式（键顺序固定） | ✅ | `levelToJson`；`tests/generator.test.mjs` |
| 生成期求解器复核 + 难度分档 | ✅ | `difficultyOf`、`level.generation` 段 |
| 关卡 CLI | ✅ | `tools/gen-level.mjs`；`tests/cli.test.mjs` |

**M2 当时实测（2026-10-18，Windows + Node v24.15.0）**

```
npm test                              → 全部通过（当时 69 项）
npm run verify 的 level.generation    → 10000 seeds / failed 0 / ambiguous 0
                                        求解器复核通过率 1；p50 0.16ms / p99 0.68ms（只报告）
node tools/gen-level.mjs --seed 2026-10-19   → 同 seed 两次逐字节相同
```

## 2. M2 DoD 逐项

- [x] 10,000 个 seed 生成的关卡**全部有解**（`failed = 0`）
- [x] **多解 / 无解 = 0**（`ambiguous = 0`）
- [x] 同一 seed 两次生成的 JSON **逐字节相同**（`tests/generator.test.mjs`）
- [x] 隐藏网表不含恒等冗余门（**当时未做，M3 轮补上**：D22）
- [x] 跨浏览器（≥2 引擎）哈希相同 —— **M2 收尾时未做**（本机只有 Chromium）；
  **已在 M3 轮关闭**：安装 Firefox 后新增 `tools/cross-engine.mjs`，实测 200 seed ×
  {Node, Chromium, Firefox} 关卡 JSON 与探测重算逐字节一致、差异 0（详见 `HANDOFF-M3.md` §1）

## 3. 本段口径（K 编号的原始落点）

| 编号 | 口径 | 落点 |
| --- | --- | --- |
| K5 | xorshift128+，seed 归一 = 整数低 64 位 / 字符串 FNV-1a 64 | `src/core/rng.mjs` |
| K6 | 重抽上限 64，超限显式失败（不换 seed、不放宽） | `src/core/generator.mjs` |
| K7 | 关卡 JSON 键顺序固定，同 seed 逐字节相同 | `levelToJson` |
| K8 | 最少门数 = 各输出单独按引用展开的门数之和；未使用门不计 | `data/README.md` §4.3 / `countedGates` |
| K9 | 单输出最少门数 = 公式复杂度（成本表 DP），不可达返回 `-1` | `src/core/solver.mjs` |

> K8 的措辞在 M3 轮被**收紧**（原为"锥内去重"，会让差值可能为负 → D21）；
> 详见 `plan/06` D21 与 `HANDOFF-M3.md` §2。

## 4. 当时未发现、M3 轮实测暴露的两个缺陷（如实记录）

| 缺陷 | 当时为什么没发现 | 何时暴露 / 如何修 |
| --- | --- | --- |
| `countedGates` 按输出锥去重 → 1/10000 关卡出现 `你的门数 6 < 最优 7` | M2 只复核"求解器能不能算出最优"，没有把"玩家提交的门数"与它对齐 | M3 轮结算面板接线后实测 10000 关扫描发现 → D21 改为按引用展开 |
| 生成器允许恒等冗余门 `AND(x,x)` / `OR(x,x)`（10000 关里 4864 处引用） | 这类门功能上等于直连，功能正确性检查看不出问题 | M3 轮端到端冒烟"照答案拼装却有差值 1" → D22 在候选阶段剔除 |

这两条**不是 M2 的验收疏漏**：M2 的 DoD 只覆盖"生成 + 求解复核"；它们是 M3 把"玩家提交"接进判定链后才可观测的。
原文保持在决策记录里，不追溯改写。

## 5. 关键命令

```bash
node --test tests/rng.test.mjs tests/generator.test.mjs tests/solver.test.mjs tests/cli.test.mjs
npm run verify                                   # level.generation 段
node tools/gen-level.mjs --seed 2026-10-19
node tools/gen-level.mjs --seed 7 --count 3
node tools/gen-level.mjs --help                  # 缺参数 / 未知参数 exit 2
```

## 6. 下一棒（M3）启动提示词（原文，来自 `plan/HANDOFF-M1.md` §7）

```
/goal 读取 "<项目根>\plan\HANDOFF-M1.md" 继续完成任务：
本棒目标是 M3（门编辑器 / 提交校验 / 结算面板 / 逐层点亮 / D1 术语门槛）。
先跑 npm test 与 npm run verify 复测基线，再按 §2 待办逐项实现；每完成一项补测试并跑全量，
收尾时写 plan/HANDOFF-M4.md（六节）并 commit。
```

> 该提示词里"写 `plan/HANDOFF-M4.md`"的命名有歧义；M3 轮已在 `plan/00` §一钉死命名规则，
> 并按规则产出 `plan/HANDOFF-M3.md`（本轮的收尾交接单）。
