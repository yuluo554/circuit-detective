// 界面文案单点：所有玩家可见的文字从这里取，术语门槛（D1 / D20）靠它落地。
// 前 3 关（campaignIndex 1–3）只用"黑盒 / 开关 / 灯 / 拼块 / 插口"，
// 不出现"门""NAND"以及 AND / OR / NOT 这些正式名称。

const FORBIDDEN_EARLY = Object.freeze(["门", "NAND", "AND", "OR", "NOT"]);

const BASIC = Object.freeze({
  mode: "basic",
  title: "黑盒电路侦探",
  subtitle: "拨开关 · 看灯 · 猜出盒子里最少用了几样东西",
  viewProbe: "观察",
  viewBuild: "拼装",
  probesLabel: "试探次数",
  levelLabel: "关卡",
  submissionLabel: "提交次数",
  hintProbe: "点左边的开关，观察右边的灯。<br>同一个组合反复拨动不计次。",
  hintBuild: "先点一个插口作为来源，再点要接的位置。<br>拼块可以拖动；选中后按方向键微调，按 Delete 删掉。",
  hintReplay: "回放只读：左右方向键可以逐步重播，不能改动任何接线。",
  statusReady: "黑盒已就绪",
  statusBuilding: "拼装中",
  statusReveal: "正在揭晓",
  statusSettled: "已结算",
  statusReplay: "回放中（只读）",
  statusReplayDone: "回放结束（只读）",
  statusReplayError: "回放码不可用",
  seedPlaceholder: "输入种子，例如 2026-10-19",
  load: "换一关",
  daily: "今日题",
  share: "复制分享码",
  submit: "提交答案",
  next: "下一关",
  prev: "上一关",
  clear: "全部清空",
  deleteGate: "删掉选中的拼块",
  replayLabel: "回放",
  replayBad: (message) => `这个回放码用不了：${message}`,
  replayHint: "换一个码或直接玩关卡。",
  shareText: (info) => `我试探了 ${info.probes} 次，比最少多用 ${info.difference} 个拼块。回放码：${info.code}`,
  shareFallbackText: (info) => `我试探了 ${info.probes} 次。种子：${info.seed}（这次操作太长，没进回放码）`,
  shareCopied: "分享文案已复制到剪贴板。",
  shareManual: "剪贴板不可用，文案已贴在下面，手动复制即可：",
  shareDegraded: "这次操作太长，已降级为种子分享：",
  paletteLabel: "拼块",
  palette: Object.freeze({
    NOT: "¬ 一个入口",
    AND: "∧ 两个入口",
    OR: "∨ 两个入口",
  }),
  part: Object.freeze({ NOT: "¬", AND: "∧", OR: "∨" }),
  noteLabel: "草稿笔记（只存在本机）",
  notePlaceholder: "写下你的猜测……",
  empty: "先摆一个拼块",
  revealLayer: (index, total) => `第 ${index} / ${total} 层亮起`,
  revealDone: "全部亮起",
  mismatch: (mismatch) =>
    `第 ${mismatch.row + 1} 行 · 开关 ${mismatch.input.join("")} · ${mismatch.outputLabel} · 应亮 ${mismatch.expected} · 实际 ${mismatch.actual}`,
  invalidDraft: "还差一点：",
  rejectedHead: "这盏灯的走势不对",
  acceptedHead: "对上了",
  settlement: Object.freeze({
    yourGates: "你用的拼块",
    optimalGates: "最少拼块",
    difference: "多用",
    probes: "试探次数",
    basis: "每个灯单独计数：共用的拼块，每个灯各算一次。",
  }),
  diffSuffix: "个",
  nextHint: "点「下一关」继续。",
  readout: Object.freeze({
    pickSource: "先点一个来源：开关或拼块的输出。",
    pickTarget: "再点一个要接的位置（拼块入口或灯）。",
    wired: "接好了。没接的入口会画虚线框。",
    disconnected: "已断开这根线。再点来源可以重新接。",
    noTarget: "这里接不上：点拼块左边的小圆点或右边的灯。",
    introEarly: "先拨开关试试，看清四个灯怎么跟着变，再切到「拼装」把盒子拼出来。",
    introFull: "先拨开关试探，再切到「拼装」把盒子拼出来。",
    replayReady: (probes, steps) => `回放码载入：${probes} 次试探 / ${steps} 个拼块，正在逐步重播（只读）。`,
    replayStep: (index, total) => `回放第 ${index} / ${total} 步`,
    replayDone: "回放结束：这就是当时的盒子和试探顺序（只读）。",
  }),
});

const FULL = Object.freeze({
  ...BASIC,
  mode: "full",
  hintBuild:
    "先点一个引脚作为来源，再点要接的位置。<br>门可以拖动；选中后按方向键微调，按 Delete 删掉。",
  paletteLabel: "门",
  palette: Object.freeze({
    NOT: "NOT 非门",
    AND: "AND 与门",
    OR: "OR 或门",
  }),
  part: Object.freeze({ NOT: "NOT", AND: "AND", OR: "OR" }),
  shareText: (info) => `我试探了 ${info.probes} 次，比最优多用 ${info.difference} 个门。回放码：${info.code}`,
});

export const EARLY_LEVEL_LIMIT = 3;

/** campaignIndex 为 null 表示手动种子（按进阶文案）。 */
export function copyFor(campaignIndex) {
  return Number.isInteger(campaignIndex) && campaignIndex <= EARLY_LEVEL_LIMIT ? BASIC : FULL;
}

/**
 * 回放视图专用词表：短码不带关卡号，无法判断来源关卡，
 * 因此一律用无术语词表，绝不因为回放把 D1 门槛漏掉。
 */
export function replayCopy() {
  return BASIC;
}

export const EARLY_TERMS = FORBIDDEN_EARLY;

/** 把 BASIC 文案展平为字符串数组，供术语扫描断言。 */
export function flattenCopy(copy, path = "") {
  const out = [];
  for (const [key, value] of Object.entries(copy)) {
    const label = path ? `${path}.${key}` : key;
    if (typeof value === "string") out.push({ label, text: value });
    else if (value && typeof value === "object" && !(value instanceof Function)) {
      out.push(...flattenCopy(value, label));
    } else if (typeof value === "function") {
      out.push({ label, text: String(value({ row: 0, input: [0, 0, 0, 0], output: "o0", expected: 0, actual: 1 })) });
    }
  }
  return out;
}

/** 前 3 关可见文案里出现了禁用术语就返回命中列表（空数组 = 通过）。 */
export function forbiddenTermHits(copy = copyFor(1)) {
  const hits = [];
  for (const item of flattenCopy(copy)) {
    for (const term of FORBIDDEN_EARLY) {
      if (item.text.includes(term)) hits.push({ ...item, term });
    }
  }
  return hits;
}
