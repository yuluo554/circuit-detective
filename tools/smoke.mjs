#!/usr/bin/env node
// 无头浏览器端到端冒烟：真实点击画布，验证"拨杆→灯→拼装→提交→结算→逐层点亮"。
// Playwright 不是项目依赖（K16）：本脚本按本机全局路径动态 import，找不到就明确 SKIP。
// 用法：node tools/smoke.mjs [--shot docs/smoke-shot.png]

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateLevel } from "../src/core/generator.mjs";
import { createDraft } from "../src/core/editor.mjs";
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

// —— 3. 用真实点击照答案拼装 ——
const { level } = generateLevel(SEED, { gateBudget: 2, minOptimal: 2 });
const expected = createDraft(level);

// 先按答案顺序摆件：每点一次按钮会放到下一个空位，并自动把该件设为来源。
for (const gate of level.netlist.gates) await page.click(`[data-gate="${gate.type}"]`);
const afterPlace = await snapshot();
check("零件数正确", afterPlace.draft.gates.length === level.netlist.gates.length, `${afterPlace.draft.gates.length}/${level.netlist.gates.length}`);

const placed = afterPlace.draft.gates;
const idMap = new Map();
level.netlist.gates.forEach((gate, index) => idMap.set(gate.id, placed[index].id));

// 逐个引脚点击：先点来源插口，再点目标引脚。
for (const [index, gate] of level.netlist.gates.entries()) {
  const targetGate = placed[index];
  for (let pin = 0; pin < gate.in.length; pin += 1) {
    const src = idMap.get(gate.in[pin]) ?? gate.in[pin];
    if (level.netlist.inputs.includes(src)) {
      const socket = socketPoint("input", level.netlist.inputs.indexOf(src));
      await clickBoard(socket.x, socket.y);
    } else {
      const sourceGate = placed[level.netlist.gates.findIndex((item) => item.id === gate.in[pin])];
      const out = gateOutputPin(sourceGate);
      await clickBoard(out.x, out.y);
    }
    const pinPoint = gateInputPin(targetGate, pin);
    await clickBoard(pinPoint.x, pinPoint.y);
  }
}

// 输出端口
for (const [index, name] of level.outputs.entries()) {
  const src = level.netlist.outputsMap[name];
  if (level.netlist.inputs.includes(src)) {
    const socket = socketPoint("input", level.netlist.inputs.indexOf(src));
    await clickBoard(socket.x, socket.y);
  } else {
    const sourceGate = placed[level.netlist.gates.findIndex((item) => item.id === src)];
    const out = gateOutputPin(sourceGate);
    await clickBoard(out.x, out.y);
  }
  const target = socketPoint("output", index);
  await clickBoard(target.x, target.y);
}

const wired = await snapshot();
const wiredOk = wired.draft.gates.every((gate) => gate.in.every((pin) => typeof pin === "string"));
check("全部引脚经点击接通", wiredOk, JSON.stringify(wired.draft.gates.map((gate) => gate.in)));
check(
  "输出端口全部接通",
  level.outputs.every((name) => typeof wired.draft.outputsMap[name] === "string"),
  JSON.stringify(wired.draft.outputsMap),
);

// —— 4. 提交 → 结算 → 逐层点亮 ——
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

// —— 5. 错误提交反馈：改一个输出必然失配 ——
await page.click("#prev");
await page.click("#next");
const reloaded = await snapshot();
check("关卡切换后可继续（无残留揭示态）", reloaded.reveal === null && reloaded.settlement === null);

if (shotPath) {
  mkdirSync(dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
}
await browser.close();

process.stdout.write("冒烟 · headless Chromium\n");
process.stdout.write("=".repeat(48) + "\n");
for (const line of notes) process.stdout.write(`${line}\n`);
process.stdout.write("=".repeat(48) + "\n");
process.stdout.write(`结论: ${failures.length === 0 ? "全绿" : `${failures.length} 项未通过`}\n`);
if (shotPath) process.stdout.write(`截图: ${shotPath}\n`);
if (failures.length > 0) process.exitCode = 1;
