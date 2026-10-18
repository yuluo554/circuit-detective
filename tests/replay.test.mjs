import test from "node:test";
import assert from "node:assert/strict";
import { encodeRecord, decodeRecord, crc16, MAX_CODE_LENGTH } from "../src/core/replay.mjs";
import { normalizeSeed } from "../src/core/rng.mjs";

const netlist = {
  inputs: ["i0", "i1", "i2", "i3"],
  outputs: ["o0", "o1", "o2", "o3"],
  gates: [
    { id: "g01", type: "AND", in: ["i0", "i1"] },
    { id: "g02", type: "NOT", in: ["g01"] },
    { id: "g03", type: "OR", in: ["i2", "g02"] },
  ],
  outputsMap: { o0: "g01", o1: "g02", o2: "g03", o3: "i3" },
};

test("编码 → 解码逐项一致", () => {
  const record = { seed: "2026-10-19", probes: [0, 1, 2, 3, 15], netlist };
  const code = encodeRecord(record);
  const decoded = decodeRecord(code);
  const expectedSeed = normalizeSeed(record.seed);
  assert.equal(decoded.seed, expectedSeed);
  assert.deepEqual(decoded.probes, record.probes);
  assert.equal(decoded.netlist.gates.length, netlist.gates.length);
  assert.equal(decoded.netlist.gates[2].type, "OR");
  assert.equal(decoded.netlist.outputsMap.o2, "g03");
});

test("同一记录编码唯一（无盐、无时间戳）", () => {
  const record = { seed: 7, probes: [1, 2], netlist };
  assert.equal(encodeRecord(record), encodeRecord(record));
});

test("短码只含 URL 安全字符且不超过 64 字符", () => {
  const code = encodeRecord({ seed: "2026-10-19", probes: [0, 1], netlist });
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.ok(code.length <= MAX_CODE_LENGTH);
});

test("篡改一位被 CRC 识别，不错误回放", () => {
  const code = encodeRecord({ seed: 42, probes: [1, 2], netlist });
  const index = Math.floor(code.length / 2);
  const replacement = code[index] === "A" ? "B" : "A";
  const tampered = code.slice(0, index) + replacement + code.slice(index + 1);
  assert.throws(() => decodeRecord(tampered), /校验失败|版本不兼容/);
});

test("版本不认识时明确报不兼容", () => {
  const body = Uint8Array.from([99, 1, 2, 3, 4]);
  const checksum = crc16(body);
  const bytes = new Uint8Array(body.length + 2);
  bytes.set(body);
  bytes[body.length] = checksum >> 8;
  bytes[body.length + 1] = checksum & 0xff;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const code = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.throws(() => decodeRecord(code), /版本不兼容/);
});

test("非法字符与空码显式报错", () => {
  assert.throws(() => decodeRecord(""), /为空/);
  assert.throws(() => decodeRecord("abc$def"), /非法字符/);
});

test("超长记录拒绝编码（不截断、不丢步骤）", () => {
  const many = {
    inputs: ["i0", "i1", "i2", "i3"],
    outputs: ["o0", "o1", "o2", "o3"],
    gates: Array.from({ length: 12 }, (_, i) => ({
      id: `g${String(i + 1).padStart(2, "0")}`,
      type: i % 3 === 0 ? "NOT" : i % 3 === 1 ? "AND" : "OR",
      in: i === 0 ? ["i0"] : i % 3 === 0 ? [`g${String(i).padStart(2, "0")}`] : ["i0", `g${String(i).padStart(2, "0")}`],
    })),
    outputsMap: { o0: "g01", o1: "g02", o2: "g03", o3: "g04" },
  };
  assert.throws(
    () => encodeRecord({ seed: 1, probes: Array.from({ length: 200 }, (_, i) => i & 0xf), netlist: many }),
    /无法生成短码/,
  );
});
