#!/usr/bin/env node
// 无头浏览器端到端冒烟：真实点击画布，验证"拨杆→灯→拼装→提交→结算→逐层点亮"。
// Playwright 不是项目依赖（K16）：本脚本按本机全局路径动态 import，找不到就明确 SKIP。
// 用法：node tools/smoke.mjs [--shot docs/smoke-shot.png]

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateLevel } from "../src/core/generator.mjs";
import { truthTableMasks } from "../src/core/sim.mjs";
import { recomputeProbes } from "../src/core/judge.mjs";
import { sharePayload } from "../src/core/share.mjs";
import { gateInputPin, gateOutputPin, socketPoint } from "../src/ui/layout.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist", "index.html");
const SEED = "campaign/2";

function fallbackPaths() {
  const appData = process.env.APPDATA ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  return {
    core: [
      process.env.PLAYWRIGHT_CORE,
      join(appData, "npm", "node_modules", "@playwright", "mcp", "node_modules", "playwright-core"),
      join(appData, "npm", "node_modules", "playwright-core"),
      join(ROOT, "node_modules", "playwright-core"),
    ].filter(Boolean),
    executables: [
      process.env.CHROME_PATH,
      join(localAppData, "ms-playwright", "chromium-1228", "chrome-win64", "chrome.exe"),
    ].filter(Boolean),
  };
}

async function loadChromium() {
  for (const path of fallbackPaths().core) {
    try {
      const module = await import(pathToFileURL(join(path, "index.mjs")).href);
      if (module.chromium) return module.chromium;
    } catch {
      // 试下一个候选
    }
  }
  return null;
}

const args = process.argv.slice(2);
const shotFlag = args.indexOf("--shot");
// 默认不写盘：截图的抗锯齿像素会随时序微小抖动，反复跑会把工作树弄脏。
// 需要留证时显式 `--shot docs/smoke-shot.png`。
const shotPath = shotFlag >= 0 ? resolve(args[shotFlag + 1]) : null;

const chromium = await loadChromium();
if (!chromium) {
  process.stdout.write("SKIP  smoke：本机未找到 playwright-core（项目刻意不引入该依赖）\n");
  process.exit(0);
}

const notes = [];
const failures = [];
const check = (name, condition, detail) => {
  const line = `${condition ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : ` (${detail})`}`;
  notes.push(line);
  if (!condition) failures.push(name);
};

function report() {
  process.stdout.write("冒烟 · headless Chromium\n");
  process.stdout.write("=".repeat(48) + "\n");
  for (const line of notes) process.stdout.write(`${line}\n`);
  process.stdout.write("=".repeat(48) + "\n");
  process.stdout.write(`结论: ${failures.length === 0 ? "全绿" : `${failures.length} 项未通过`}\n`);
  if (shotPath) process.stdout.write(`截图: ${shotPath}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

// 等待超时 / 脚本异常也必须出报告：否则"跑挂了"和"跑绿了"在日志里长得一样。
// Node 默认把顶级 await 的未处理拒绝升级成 uncaughtException，两个口都要接。
function abort(error) {
  check("冒烟脚本未异常中止", false, String((error && error.message) || error).split("\n")[0]);
  report();
  process.exit(1);
}
process.on("unhandledRejection", abort);
process.on("uncaughtException", abort);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH ?? fallbackPaths().executables[0],
  args: ["--allow-file-access-from-files"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1040 } });
const pageErrors = [];
const requests = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("request", (request) => requests.push(request.url()));

const target = `${pathToFileURL(DIST).href}#s=${encodeURIComponent(SEED)}`;
await page.goto(target, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__circuitDetective), null, { timeout: 5000 });

const snapshot = () => page.evaluate(() => window.__circuitDetective.snapshot());

async function clickBoard(x, y) {
  const box = await page.locator("#board").boundingBox();
  await page.mouse.click(box.x + (x * box.width) / 880, box.y + (y * box.height) / 560);
}

/** 按答案顺序摆件，并逐引脚点击接通（与真人操作同一路径）。 */
async function placeAndWire(level) {
  for (const gate of level.netlist.gates) await page.click(`[data-gate="${gate.type}"]`);
  const placed = (await snapshot()).draft.gates;
  for (const [index, gate] of level.netlist.gates.entries()) {
    for (let pin = 0; pin < gate.in.length; pin += 1) {
      await clickSource(level, placed, gate.in[pin]);
      const point = gateInputPin(placed[index], pin);
      await clickBoard(point.x, point.y);
    }
  }
  for (const [index, name] of level.outputs.entries()) {
    await clickSource(level, placed, level.netlist.outputsMap[name]);
    const point = socketPoint("output", index);
    await clickBoard(point.x, point.y);
  }
  return { placed };
}

/** 点一个来源：输入插口或某个拼块的输出。 */
async function clickSource(level, placed, signal) {
  if (level.netlist.inputs.includes(signal)) {
    const point = socketPoint("input", level.netlist.inputs.indexOf(signal));
    await clickBoard(point.x, point.y);
    return;
  }
  const index = level.netlist.gates.findIndex((item) => item.id === signal);
  const out = gateOutputPin(placed[index]);
  await clickBoard(out.x, out.y);
}

check("页面无 JS 错误", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
const external = requests.filter((url) => !url.startsWith(pathToFileURL(DIST).href));
check("零外部资源请求", external.length === 0, `${external.length} 条`);

const snap0 = await snapshot();
check("直接进入指定关卡（#s= 路由）", snap0.seed === SEED, snap0.seed);
check("默认在观察视图", snap0.view === "probe");
check("进入关卡不计探测", snap0.probes === 0);

// —— 1. 拨杆 → 灯 → 计数 ——
await clickBoard(socketPoint("input", 0).x, socketPoint("input", 0).y);
await clickBoard(socketPoint("input", 1).x, socketPoint("input", 1).y);
await clickBoard(socketPoint("input", 2).x, socketPoint("input", 2).y);
const snap1 = await snapshot();
check("拨杆计数 0→3", snap1.probes === 3, `probes=${snap1.probes}`);
check("灯值来自仿真核（4 盏）", snap1.lamps.length === 4, snap1.lamps.join(","));

const before = snap1.probes;
await clickBoard(socketPoint("input", 0).x, socketPoint("input", 0).y);
await clickBoard(socketPoint("input", 0).x, socketPoint("input", 0).y);
const snap2 = await snapshot();
check("拨回与再拨各计一次", snap2.probes === before + 2, `probes=${snap2.probes}`);

// —— 2. 拼装视图：摆件 / 连线 / 删除 ——
await page.click("#view-build");
await page.click('[data-gate="AND"]');
const snap3 = await snapshot();
check("点零件按钮可摆放", snap3.draft.gates.length === 1, `gates=${snap3.draft.gates.length}`);

await page.locator("#board").focus();
await page.keyboard.press("Delete");
const snap4 = await snapshot();
check("Delete 删掉选中零件（键盘可达）", snap4.draft.gates.length === 0);

await page.click("#submit");
const emptyReadout = await page.locator("#readout").textContent();
check("空草稿提交给出结构提示", /还没摆|没接/.test(emptyReadout), emptyReadout.slice(0, 40));

// —— 3. 拆线入口：接上再点一次同一入口应断开 ——
await page.click("#view-build");
await page.click('[data-gate="AND"]');
const placedOne = (await snapshot()).draft.gates[0];
await clickBoard(socketPoint("input", 0).x, socketPoint("input", 0).y);
const pin0 = gateInputPin(placedOne, 0);
await clickBoard(pin0.x, pin0.y);
const afterWire = await snapshot();
check("接上一根线", afterWire.draft.gates[0].in[0] === "i0", JSON.stringify(afterWire.draft.gates[0].in));
await clickBoard(pin0.x, pin0.y);
const afterUnwire = await snapshot();
check("再点同一入口即断开（拆线入口）", afterUnwire.draft.gates[0].in[0] === null, JSON.stringify(afterUnwire.draft.gates[0].in));
await page.click("#clear");

// —— 4. 草稿笔记持久化（D11）——
await page.fill("#note", "第 2 关像是一个 或 加一个 非");
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__circuitDetective), null, { timeout: 5000 });
check("笔记按关卡存在 localStorage（刷新后仍在）", (await page.inputValue("#note")).includes("第 2 关像是一个"));

// 刷新后仍是同一关；顺手拨两下，给后面的分享 / 回放准备一段真实的探测序列。
await clickBoard(socketPoint("input", 3).x, socketPoint("input", 3).y);
await clickBoard(socketPoint("input", 2).x, socketPoint("input", 2).y);
const afterNote = await snapshot();
check(
  "刷新后仍是同一关且拨杆重新计数",
  afterNote.seed === SEED && afterNote.probes === 2 && afterNote.probeLog.length === 2,
  `${afterNote.seed}/${afterNote.probes}/${afterNote.probeLog.join(",")}`,
);

// —— 5. 用真实点击照答案拼装 ——
const { level } = generateLevel(SEED, { gateBudget: 2, minOptimal: 2 });
const { placed } = await placeAndWire(level);
check("零件数正确", placed.length === level.netlist.gates.length, `${placed.length}/${level.netlist.gates.length}`);

const wired = await snapshot();
const wiredOk = wired.draft.gates.every((gate) => gate.in.every((pin) => typeof pin === "string"));
check("全部引脚经点击接通", wiredOk, JSON.stringify(wired.draft.gates.map((gate) => gate.in)));
check(
  "输出端口全部接通",
  level.outputs.every((name) => typeof wired.draft.outputsMap[name] === "string"),
  JSON.stringify(wired.draft.outputsMap),
);
check("结算前分享不可用（文案要含门数差）", await page.locator("#share").isDisabled());

// —— 6. 提交 → 结算 → 逐层点亮 ——
await page.click("#submit");
const settled = await snapshot();
check("提交后被接受", Boolean(settled.settlement), JSON.stringify(settled.mismatch ?? {}));
check("结算面板可见", await page.locator("#settlement").isVisible());
if (settled.settlement) {
  check(
    "结算最优门数与求解器一致",
    settled.settlement.optimalGates === level.optimal,
    `${settled.settlement.optimalGates}/${level.optimal}`,
  );
  check(
    "差值 = 你的门数 − 最优门数且非负",
    settled.settlement.difference === settled.settlement.yourGates - settled.settlement.optimalGates &&
      settled.settlement.difference >= 0,
    JSON.stringify(settled.settlement),
  );
  check("结算记录探测次数", settled.settlement.probes === settled.probes, `${settled.settlement.probes}/${settled.probes}`);
}

const layers = settled.reveal?.layers ?? [];
check("揭示层数 > 0", layers.length > 0, `layers=${layers.length}`);
check("揭示层号严格递增（每层非空）", layers.every((layer) => layer.length > 0));

// 等揭示跑完
await page.waitForFunction(
  () => {
    const snap = window.__circuitDetective.snapshot();
    return snap.reveal && snap.reveal.step >= snap.reveal.total;
  },
  null,
  { timeout: 20000 },
);
const done = await snapshot();
check("揭示走到终态", done.reveal.step === done.reveal.total, `${done.reveal.step}/${done.reveal.total}`);
check(
  "终态覆盖全部零件",
  done.reveal.revealed.length === level.netlist.gates.length,
  `${done.reveal.revealed.length}/${level.netlist.gates.length}`,
);

// —— 6b. 分享按钮：探测次数 + 门数差 + 短码（UI 编码与纯函数逐字节相同）——
check("结算后分享可用", await page.locator("#share").isEnabled());
const shareExpect = sharePayload({
  seed: SEED,
  probes: done.probeLog,
  netlist: level.netlist,
  difference: done.settlement.difference,
});
check("分享载荷可编码且 ≤64 字符", shareExpect.ok && shareExpect.code.length <= 64, `${shareExpect.code?.length}`);
await page.click("#share");
const shareText = await page.locator("#readout").textContent();
check(
  "分享文案含探测次数与门数差",
  shareText.includes(String(done.probeLog.length)) && shareText.includes(String(done.settlement.difference)),
  shareText.slice(0, 80),
);
check("分享短码与纯函数编码逐字节相同", shareText.includes(shareExpect.code), shareExpect.code);

// —— 7. 错误提交的反馈：结构完整但把 1 号灯接错 ——
await page.click("#prev");
await page.click("#next");
const reloaded = await snapshot();
check("关卡切换后可继续（无残留揭示态）", reloaded.reveal === null && reloaded.settlement === null);

const wrong = await placeAndWire(level);
// 按真值表挑一个与 1 号灯功能必然不同的来源（生成器允许 OR(i,i)=i 这类等价结构）
const target0 = level.outputs[0];
const originalMask = truthTableMasks(level.netlist).masks[target0];
const candidate = [...level.netlist.inputs, ...level.netlist.gates.map((gate) => gate.id)].find((signal) => {
  const probe = { ...level.netlist, outputs: [target0], outputsMap: { [target0]: signal } };
  return truthTableMasks(probe).masks[target0] !== originalMask;
});
check("找得到功能不同的来源（测试前提）", typeof candidate === "string", String(candidate));
await clickSource(level, wrong.placed, candidate);
await clickBoard(socketPoint("output", 0).x, socketPoint("output", 0).y);
const tampered = await snapshot();
check("1 号灯已改接", tampered.draft.outputsMap[target0] !== level.netlist.outputsMap[target0]);

await page.click("#submit");
const rejected = await snapshot();
const rejectText = await page.locator("#readout").textContent();
check("功能不符时提交被拒", rejected.settlement === null, JSON.stringify(rejected.mismatch ?? {}));
check(
  "失配反馈含行号 / 开关组合 / 灯号",
  /第 \d+ 行/.test(rejectText) && /开关 \d{4}/.test(rejectText) && /号灯/.test(rejectText),
  rejectText.slice(0, 90),
);
check("结算面板在未通过时不显示", await page.locator("#settlement").isHidden());

// —— 8. M4：短码回放（`#r=` 只读视图，按步推进且不重新计数）——
const replayProbes = [...done.probeLog];
const replayCode = shareExpect.code;
const expectedSteps = recomputeProbes(level, replayProbes).map((row) => ({
  vector: row.vector,
  inputs: [...row.inputs],
  outputs: { ...row.outputs },
  ok: row.ok,
  stable: row.stable,
}));

await page.goto(`${pathToFileURL(DIST).href}?case=replay#r=${replayCode}`, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__circuitDetective), null, { timeout: 5000 });
const replaySnap = await snapshot();
check("`#r=<code>` 直达回放视图", Boolean(replaySnap.replay), "replay=null");
check(
  "回放不改写地址栏（原短码保留在 URL 里）",
  page.url().includes(`#r=${replayCode}`),
  page.url().slice(-48),
);
check(
  "回放不新增探测：次数 = 短码里的步数",
  replaySnap.probes === replayProbes.length && replaySnap.replay?.probes.length === replayProbes.length,
  `${replaySnap.probes}/${replayProbes.length}`,
);
check(
  "回放步表 = seed + 网表重算，逐项相同",
  JSON.stringify(replaySnap.replay?.steps) === JSON.stringify(expectedSteps),
  JSON.stringify(replaySnap.replay?.steps ?? []).slice(0, 60),
);
check(
  "回放展示隐藏网表（拼块数与答案一致）",
  replaySnap.replay?.layers.flat().length === level.netlist.gates.length,
  `${replaySnap.replay?.layers.flat().length}/${level.netlist.gates.length}`,
);

const locked = {
  submit: await page.locator("#submit").isDisabled(),
  clear: await page.locator("#clear").isDisabled(),
  del: await page.locator("#delete").isDisabled(),
  palette: await page.locator('[data-gate="AND"]').isDisabled(),
  share: await page.locator("#share").isDisabled(),
  prev: await page.locator("#prev").isDisabled(),
  next: await page.locator("#next").isDisabled(),
};
check("回放视图只读：提交 / 清空 / 删除 / 摆件全部禁用", Object.values(locked).every(Boolean), JSON.stringify(locked));

const beforeClick = await snapshot();
await clickBoard(socketPoint("input", 0).x, socketPoint("input", 0).y);
const afterClick = await snapshot();
check(
  "回放里点画布不改变探测次数与接线",
  afterClick.probes === replayProbes.length && JSON.stringify(afterClick.draft) === JSON.stringify(beforeClick.draft),
);
check("回放里键盘也不改状态（数字键被忽略）", await (async () => {
  await page.locator("#board").focus();
  await page.keyboard.press("1");
  return (await snapshot()).probes === replayProbes.length;
})());

await page.waitForFunction(
  () => {
    const snap = window.__circuitDetective.snapshot();
    return snap.replay && snap.replay.tick >= snap.replay.totalTicks;
  },
  null,
  { timeout: 30000 },
);
const replayDone = await snapshot();
check(
  "回放按步推进到终态",
  replayDone.replay.step === replayDone.replay.total && replayDone.replay.tick === replayDone.replay.totalTicks,
  `${replayDone.replay.step}/${replayDone.replay.total} tick ${replayDone.replay.tick}/${replayDone.replay.totalTicks}`,
);
check(
  "回放终态点亮全部拼块",
  replayDone.replay.revealed.length === level.netlist.gates.length,
  `${replayDone.replay.revealed.length}/${level.netlist.gates.length}`,
);

await page.goto(`${pathToFileURL(DIST).href}?case=priority#r=${replayCode}&s=campaign/1`, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__circuitDetective), null, { timeout: 5000 });
const priority = await snapshot();
check(
  "`#r=` 优先于 `#s=`（同时给出时进回放而不是普通关卡）",
  Boolean(priority.replay) && priority.campaignIndex === null && priority.seed !== "campaign/1",
  `seed=${priority.seed} campaign=${priority.campaignIndex}`,
);

const tamperAt = Math.floor(replayCode.length / 2);
const tamperChar = replayCode[tamperAt] === "A" ? "B" : "A";
const tamperedCode = `${replayCode.slice(0, tamperAt)}${tamperChar}${replayCode.slice(tamperAt + 1)}`;
await page.goto(`${pathToFileURL(DIST).href}?case=tampered#r=${tamperedCode}`, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__circuitDetective), null, { timeout: 5000 });
const badSnap = await snapshot();
const badText = await page.locator("#readout").textContent();
check(
  "篡改一位：明确提示且不静默进普通关卡",
  badSnap.replay === null && badSnap.draft === null && /用不了/.test(badText),
  badText.slice(0, 60),
);
check(
  "篡改一位后面板锁死（提交 / 摆件不可用）",
  (await page.locator("#submit").isDisabled()) && (await page.locator('[data-gate="AND"]').isDisabled()),
);
check("篡改一位后页面仍无 JS 错误", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

if (shotPath) {
  mkdirSync(dirname(shotPath), { recursive: true });
  // 留证用回放终态：M4 的回放视图（只读）比错误提交态更能说明当前能力。
  await page.goto(`${pathToFileURL(DIST).href}?case=shot#r=${replayCode}`, { waitUntil: "load" });
  await page.waitForFunction(
    () => {
      const snap = window.__circuitDetective.snapshot();
      return snap.replay && snap.replay.tick >= snap.replay.totalTicks;
    },
    null,
    { timeout: 30000 },
  );
  await page.screenshot({ path: shotPath });
}
await browser.close();

report();
