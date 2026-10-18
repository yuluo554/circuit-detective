// 关卡选择：日期 → 种子；URL hash 里的 seed 优先于默认 seed。
// 战役模式 = 固定种子序列（`campaign/<n>`），前 3 关用更低门数预算（plan/06 风险表的缓解项）。
// 这里只做字符串处理；今日题读一次本地日期（D3 已知局限），不在 core 里读时钟。

import { LEVEL_FORMAT, LEVEL_VERSION } from "../core/generator.mjs";

export const DEFAULT_SEED = "2026-10-19";
export const CAMPAIGN_PREFIX = "campaign/";
export const CAMPAIGN_LAST = 12;

/** 战役第 n 关的种子文案（n 从 1 开始）。 */
export function campaignSeed(index) {
  return `${CAMPAIGN_PREFIX}${index}`;
}

/**
 * 前 3 关的生成参数：门数预算固定为 2，最优门数固定为 2（`easy`）。
 * 第 4–6 关放宽到 4，第 7 关起回到默认预算；
 * "三种零件"的正式名称在第 4 关出现（D1 / Q3）。
 */
export function campaignOptions(index) {
  if (index <= 3) return { gateBudget: 2, minOptimal: 2 };
  if (index <= 6) return { gateBudget: 4, minOptimal: 2 };
  return {};
}

export function campaignIndexFromSeed(seed) {
  const text = String(seed ?? "");
  if (!text.startsWith(CAMPAIGN_PREFIX)) return null;
  const index = Number(text.slice(CAMPAIGN_PREFIX.length));
  return Number.isInteger(index) && index >= 1 && index <= CAMPAIGN_LAST ? index : null;
}

/** 由日期字符串生成每日题的 seed 文案（真正的哈希在 rng.normalizeSeed 里做）。 */
export function seedFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function seedFromLocation(location) {
  const hash = location.hash || "";
  const match = /#?s=([^&]+)/.exec(hash);
  if (!match) return DEFAULT_SEED;
  const decoded = decodeURIComponent(match[1]).trim();
  return decoded.length > 0 ? decoded : DEFAULT_SEED;
}

export function levelHeader(level) {
  return `${level.format} v${level.version}`;
}

export function isSupportedLevel(level) {
  return level?.format === LEVEL_FORMAT && level?.version === LEVEL_VERSION;
}
