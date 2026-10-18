// 关卡选择：日期 → 种子；URL hash 里的 seed 优先于默认 seed。
// 这里只做字符串处理，不读时钟参与关卡生成（今日题除外，见 D3）。

import { LEVEL_FORMAT, LEVEL_VERSION } from "../core/generator.mjs";

export const DEFAULT_SEED = "2026-10-19";

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
