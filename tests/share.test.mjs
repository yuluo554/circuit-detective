import test from "node:test";
import assert from "node:assert/strict";
import { decodeReplay, sharePayload, SHARE_OVERFLOW_REASON } from "../src/core/share.mjs";
import { MAX_CODE_LENGTH } from "../src/core/replay.mjs";
import { recomputeProbes } from "../src/core/judge.mjs";
import { generateLevel } from "../src/core/generator.mjs";
import { normalizeSeed } from "../src/core/rng.mjs";
import { copyFor, forbiddenTermHits, replayCopy } from "../src/ui/copy.mjs";
import { routeFromLocation, SEED_KEY, REPLAY_KEY } from "../src/ui/level-source.mjs";

const PROBES = [0, 1, 2, 3, 15, 8, 7, 11];

/** 12 门 / 8 个信号以上的场景：短码必然超长，用来验降级分支。 */
const fatNetlist = {
  inputs: ["i0", "i1", "i2", "i3"],
  outputs: ["o0", "o1", "o2", "o3"],
  gates: Array.from({ length: 12 }, (_, index) => {
    const n = index + 1;
    const prev = index === 0 ? "i0" : `g${String(index).padStart(2, "0")}`;
    return {
      id: `g${String(n).padStart(2, "0")}`,
      type: index % 3 === 0 ? "NOT" : index % 3 === 1 ? "AND" : "OR",
      in: index % 3 === 0 ? [prev] : ["i1", prev],
    };
  }),
  outputsMap: { o0: "g01", o1: "g02", o2: "g03", o3: "g04" },
};

test("路由：#r= 优先于 #s=，空 #r= 退回种子，非法转义不抛异常", () => {
  assert.deepEqual(routeFromLocation({ hash: `#${REPLAY_KEY}=ABC&${SEED_KEY}=campaign/2` }), {
    kind: "replay",
    code: "ABC",
  });
  assert.deepEqual(routeFromLocation({ hash: `#${SEED_KEY}=campaign/2` }), { kind: "seed", seed: "campaign/2" });
  assert.deepEqual(routeFromLocation({ hash: `#${REPLAY_KEY}=&${SEED_KEY}=7` }), { kind: "seed", seed: "7" });
  assert.deepEqual(routeFromLocation({ hash: "" }), { kind: "seed", seed: "2026-10-19" });
  assert.deepEqual(routeFromLocation({ hash: `#${REPLAY_KEY}=%` }), { kind: "replay", code: "%" });
});

test("分享载荷：成功时给出短码，并回填探测次数与门数差", () => {
  const generated = generateLevel("campaign/2", { gateBudget: 2, minOptimal: 2 });
  assert.equal(generated.ok, true);
  const payload = sharePayload({
    seed: "campaign/2",
    probes: PROBES,
    netlist: generated.level.netlist,
    difference: 1,
  });
  assert.equal(payload.ok, true);
  assert.match(payload.code, /^[A-Za-z0-9_-]+$/);
  assert.ok(payload.code.length <= MAX_CODE_LENGTH, `短码超长: ${payload.code.length}`);
  assert.equal(payload.probes, PROBES.length);
  assert.equal(payload.difference, 1);
  assert.equal(payload.limit, MAX_CODE_LENGTH);
});

test("分享载荷：短码超长时降级（保留探测次数与门数差，不给截断的码）", () => {
  const payload = sharePayload({
    seed: 7,
    probes: Array.from({ length: 200 }, (_, index) => index & 0xf),
    netlist: fatNetlist,
    difference: 3,
  });
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, SHARE_OVERFLOW_REASON);
  assert.equal(payload.code, null);
  assert.ok(payload.length > MAX_CODE_LENGTH, `应报出真实长度: ${payload.length}`);
  assert.equal(payload.probes, 200);
  assert.equal(payload.difference, 3);
  assert.match(payload.message, /无法生成短码/);
});

test("分享文案：含探测次数与门数差两处字段；超长时降级为种子 + 探测次数", () => {
  for (const copy of [copyFor(1), copyFor(4), replayCopy()]) {
    const text = copy.shareText({ probes: 6, difference: 2, code: "AbC-123" });
    assert.match(text, /6/);
    assert.match(text, /2/);
    assert.match(text, /AbC-123/);
    const fallback = copy.shareFallbackText({ probes: 6, seed: "campaign/2" });
    assert.match(fallback, /6/);
    assert.match(fallback, /campaign\/2/);
    assert.ok(!fallback.includes("AbC-123"), "降级文案不得再出现短码");
  }
});

test("分享文案：前 3 关词表不因分享泄漏术语，回放词表同样干净", () => {
  for (const copy of [copyFor(1), replayCopy()]) {
    const hits = forbiddenTermHits({
      ...copy,
      shareText: copy.shareText({ probes: 6, difference: 2, code: "ABC" }),
      shareFallbackText: copy.shareFallbackText({ probes: 6, seed: "s" }),
    });
    assert.deepEqual(hits, [], JSON.stringify(hits));
  }
});

test("回放解码：网表 / 探测序列 / 最优门数与分享侧逐项一致", () => {
  for (const seed of ["campaign/1", "2026-10-19", 42]) {
    const generated = generateLevel(seed);
    assert.equal(generated.ok, true);
    const payload = sharePayload({
      seed,
      probes: PROBES,
      netlist: generated.level.netlist,
      difference: 0,
    });
    assert.equal(payload.ok, true);
    const replay = decodeReplay(payload.code);
    assert.equal(replay.seed, normalizeSeed(seed));
    assert.equal(replay.seedText, String(normalizeSeed(seed)));
    assert.deepEqual(replay.probes, PROBES);
    assert.equal(replay.optimal, generated.level.optimal);
    // 回放步表 = 用短码里的网表重算的探测结果（不重新生成关卡、不重新计数）
    assert.deepEqual(
      replay.steps.map((row) => ({ vector: row.vector, outputs: row.outputs })),
      recomputeProbes(replay.level, PROBES).map((row) => ({ vector: row.vector, outputs: row.outputs })),
    );
    assert.equal(replay.steps.length, PROBES.length);
    assert.equal(replay.level.netlist.gates.length, generated.level.netlist.gates.length);
    assert.deepEqual(replay.level.netlist.outputsMap, generated.level.netlist.outputsMap);
  }
});

test("回放解码：篡改一位被识别，抛错而不是回放别的关卡", () => {
  const generated = generateLevel(7);
  const { code } = sharePayload({ seed: 7, probes: PROBES, netlist: generated.level.netlist, difference: 0 });
  const index = Math.floor(code.length / 2);
  const swapped = code[index] === "A" ? "B" : "A";
  const tampered = code.slice(0, index) + swapped + code.slice(index + 1);
  assert.throws(() => decodeReplay(tampered), /校验失败|版本不兼容|非法字符/);
});

test("回放解码：空码 / 非法字符明确报错（不静默进普通关卡）", () => {
  assert.throws(() => decodeReplay(""), /为空/);
  assert.throws(() => decodeReplay("!!!!"), /非法字符/);
});

test("回放步表只依赖短码内容：同一码在两次解码上逐项相同", () => {
  const generated = generateLevel("campaign/3", { gateBudget: 2, minOptimal: 2 });
  const { code } = sharePayload({ seed: "campaign/3", probes: PROBES, netlist: generated.level.netlist, difference: 0 });
  const first = decodeReplay(code);
  const second = decodeReplay(code);
  assert.equal(JSON.stringify(first.steps), JSON.stringify(second.steps));
  assert.equal(JSON.stringify(first.level.netlist), JSON.stringify(second.level.netlist));
});
