// 子进程：独立解码并重演探测序列，用于跨实例回放一致率。
// 只读 stdin 的 JSON，只写 stdout 的 JSON；不联网、不读时间。

import { decodeRecord } from "../src/core/replay.mjs";
import { simulate } from "../src/core/sim.mjs";

let chunk = "";
for await (const piece of process.stdin) chunk += piece;
const { code, probes } = JSON.parse(chunk);
const record = decodeRecord(code);
const outputs = probes.map((vector) => {
  const bits = [3, 2, 1, 0].map((shift) => (vector >> shift) & 1);
  const result = simulate(record.netlist, bits, { recordTrace: false });
  return { ok: result.ok, outputs: result.outputs };
});
process.stdout.write(JSON.stringify({ seed: record.seedText, outputs }));
