# AGENTS.md

本仓库遵循 **`ai-tool-project-sprint`** 方法论（装订日期：2026-10-18；口径 K40 见 `plan/HANDOFF-M6.md` §5）。

## 任何新对话的第一件事

```bash
npm run layout        # 或 node tools/check-sprint-layout.mjs —— 布局门；必须绿
```

- **续接对话**：读 `plan/HANDOFF-M<k>.md`（那是第 k 棒的**收尾**交接单）——但**先跑上面这条门**。
- **接手对话**（无 HANDOFF 可读）：先读 `plan/00`、`plan/05`、`plan/06` 与各 `plan/HANDOFF-*.md`，
  重建"当前状态 + K 口径清单"，先汇报再动手。
- **门红了 → 先修布局，再干别的**；门不存在 = 本项目没装订（先补第零步）。

## 强制布局（`tools/check-sprint-layout.mjs` 逐条断言）

| 项 | 位置 | 判据 |
| --- | --- | --- |
| 计划套件 | `plan/00–06` + `data/README.md` | 存在且各含必需小节 |
| 交接单 | `plan/HANDOFF-M<k>.md` | 每个 ✅ 里程碑一份（**含收尾棒**）；M0 已声明豁免；M3 起要求六节齐 |
| 状态副本一致 | `plan/00` 里程碑表 / `plan/05` 状态表 / `README` 状态行 | **逐处一致**（枚举式断言，不靠人肉 grep） |
| 缺口列 | `plan/06` 的「缺口」列 | 不得再提已 ✅ 的里程碑 |
| 发布留档 | `plan/RELEASE-M<last>.md` | 两栏（tag 前事实 / tag 后追加）+ **阶段 7 覆盖对账表**（三态逐条） |
| CI 步骤 | `.github/workflows/ci.yml` | 有一条跑布局门 |

> 更细的项（测试清单、样例产出方式、外链、版本单一来源…）在各自的门里，**不在这里重复**——
> 同一判据只许一处实现。发布终态门是 `node tools/check-release.mjs`（**刻意不进 CI**：发布前它本来就该红）。

## 本仓交付与验证面（速记）

```bash
npm test                 # 单元 + 交叉验证（逐文件列出）
npm run verify           # 一条命令 10 段全量自检；rc=0 全绿
npm run build            # → dist/index.html（单文件、零外链、逐字节确定）
npm run layout           # 布局门（本文件上方那条）
node tools/check-release.mjs          # 发布终态自检（离线）
node tools/check-release.mjs --online # 终态（需远端）
```

**零依赖**：`dependencies` 与 `devDependencies` 均为空，`git clone` 后无需 `npm install`。

## 环境事实与禁忌（实测，带日期）

- Node **v24.15.0** / npm 11.12.1（`engines` 写 `>=22`；CI 矩阵跑 22 / 24）。
- **本机 `github.com:443` 被网络阻断**，`api.github.com` 与 `ssh.github.com:443` 可用：
  推码用 `git remote set-url origin ssh://git@ssh.github.com:443/<owner>/<repo>.git`（2026-10-18 实测）。
- **没有 `python` / `python3`**：批量改文件用 `node -e`，改完必须回读确认。
- **禁忌**：把"未执行"写成已完成（`⬜` 不许预填成 ✅）；tag 之后改动 `src/`；
  用 `npm run verify > docs/verify-sample.txt` 产出样例（会把 npm banner 写进去，见 K32）。
