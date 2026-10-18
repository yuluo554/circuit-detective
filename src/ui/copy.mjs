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
  lampsLabel: "四盏灯",
  hintProbe: "点左边的开关，观察右边的灯。<br>同一个组合反复拨动不计次。",
  hintBuild: "先点一个插口作为来源，再点要接的位置。<br>拼块可以拖动；选中后按方向键微调，按 Delete 删掉。",
  statusReady: "黑盒已就绪",
  statusProbing: "记录中",
  statusBuilding: "拼装中",
  statusReveal: "正在揭晓",
  statusSettled: "已结算",
  seedPlaceholder: "输入种子，例如 2026-10-19",
  load: "换一关",
  daily: "今日题",
  share: "复制分享码",
  submit: "提交答案",
  next: "下一关",
  prev: "上一关",
  clear: "全部清空",
  deleteGate: "删掉选中的拼块",
  paletteLabel: "拼块",
  palette: Object.freeze({
    NOT: "¬ 一个入口",
    AND: "∧ 两个入口",
    OR: "∨ 两个入口",
  }),
  part: Object.freeze({ NOT: "¬", AND: "∧", OR: "∨" }),
  deleteKey: "Delete 删掉",
  noteLabel: "草稿笔记（只存在本机）",
  notePlaceholder: "写下你的猜测……",
  empty: "先摆一个拼块",
  outputSocket: "灯",
  inputSocket: "开关",
  revealLayer: (index, total) => `第 ${index} / ${total} 层亮起`,
  revealDone: "全部亮起",
  unsettled: "拨过开关之后就能提交。",
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
  deleteKey: "Delete 删掉",
  outputSocket: "输出",
  inputSocket: "输入",
});

export const EARLY_LEVEL_LIMIT = 3;

/** campaignIndex 为 null 表示手动种子（按进阶文案）。 */
export function copyFor(campaignIndex) {
  return Number.isInteger(campaignIndex) && campaignIndex <= EARLY_LEVEL_LIMIT ? BASIC : FULL;
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
