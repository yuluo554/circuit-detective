// 回放短码：版本 + seed + 探测序列 + 提交网表 + CRC。
// 口径见 data/README.md §4.5；编码逐位确定，不含时间戳与机器信息。

import { GATE_TYPES, gateArity } from "./netlist.mjs";
import { normalizeSeed } from "./rng.mjs";

export const RECORD_VERSION = 1;
export const MAX_CODE_LENGTH = 64;
const SIGNAL_BITS = 4; // 首期最多 16 个信号（4 输入 + 12 门）
const MAX_GATES = 12;

class BitWriter {
  constructor() {
    this.bytes = [];
    this.current = 0;
    this.filled = 0;
  }
  write(value, bits) {
    for (let i = bits - 1; i >= 0; i -= 1) {
      this.current = (this.current << 1) | ((value >> i) & 1);
      this.filled += 1;
      if (this.filled === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.filled = 0;
      }
    }
  }
  finish() {
    if (this.filled > 0) {
      this.bytes.push((this.current << (8 - this.filled)) & 0xff);
      this.current = 0;
      this.filled = 0;
    }
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }
  read(bits) {
    let value = 0;
    for (let i = 0; i < bits; i += 1) {
      const byteIndex = this.offset >> 3;
      const bitIndex = 7 - (this.offset & 7);
      const byte = this.bytes[byteIndex] ?? 0;
      value = (value << 1) | ((byte >> bitIndex) & 1);
      this.offset += 1;
    }
    return value;
  }
  get exhausted() {
    return this.offset >= this.bytes.length * 8;
  }
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("短码含非法字符");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function signalIndex(netlist, name) {
  const known = [...netlist.inputs, ...netlist.gates.map((gate) => gate.id)];
  const index = known.indexOf(name);
  if (index < 0 || index > 0xf) throw new Error(`信号不可编码: ${name}`);
  return index;
}

/**
 * @param {{seed: string|number|bigint, probes: number[], netlist: object}} record
 * @returns {string} Base64url 短码
 */
export function encodeRecord(record) {
  const seed = normalizeSeed(record.seed);
  const probeCount = record.probes.length;
  const gateCount = record.netlist.gates.length;
  if (gateCount > MAX_GATES) throw new Error(`门数超过 ${MAX_GATES}，无法编码`);
  if (probeCount > 255) throw new Error("探测步数过多，无法编码");
  if (record.netlist.inputs.length !== 4) throw new Error("首期只支持 4 个输入端口");

  const writer = new BitWriter();
  writer.write(RECORD_VERSION, 8);
  writer.write(Number(seed >> 32n), 32);
  writer.write(Number(seed & 0xffffffffn), 32);
  writer.write(probeCount, 8);
  for (const vector of record.probes) writer.write(vector & 0xf, 4);
  writer.write(gateCount, 4);
  for (const gate of record.netlist.gates) {
    writer.write(GATE_TYPES.indexOf(gate.type), 2);
    writer.write(signalIndex(record.netlist, gate.in[0]), SIGNAL_BITS);
    const arity = gateArity(gate.type);
    writer.write(arity === 2 ? signalIndex(record.netlist, gate.in[1]) : 0, SIGNAL_BITS);
  }
  for (const name of record.netlist.outputs) {
    writer.write(signalIndex(record.netlist, record.netlist.outputsMap[name]), SIGNAL_BITS);
  }
  const body = writer.finish();
  const checksum = crc16(body);
  const out = new Uint8Array(body.length + 2);
  out.set(body, 0);
  out[body.length] = checksum >> 8;
  out[body.length + 1] = checksum & 0xff;
  const code = toBase64Url(out);
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(`本次操作过长，无法生成短码（${code.length} > ${MAX_CODE_LENGTH} 字符）`);
  }
  return code;
}

/** 解码；版本不认识时明确报"版本不兼容"，校验失败时报错而不是错误回放。 */
export function decodeRecord(code) {
  if (typeof code !== "string" || code.length === 0) throw new Error("短码为空");
  if (code.length > MAX_CODE_LENGTH) throw new Error("短码超长，不是本版本产物");
  const bytes = fromBase64Url(code);
  if (bytes.length < 3) throw new Error("短码过短，无法解码");
  const body = bytes.subarray(0, bytes.length - 2);
  const expected = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  if (crc16(body) !== expected) throw new Error("短码校验失败（可能被篡改或截断）");

  const reader = new BitReader(body);
  const version = reader.read(8);
  if (version !== RECORD_VERSION) {
    throw new Error(`版本不兼容：短码版本 ${version}，当前只支持 ${RECORD_VERSION}`);
  }
  const high = BigInt(reader.read(32));
  const low = BigInt(reader.read(32));
  const seed = (high << 32n) | low;
  const probeCount = reader.read(8);
  const probes = [];
  for (let i = 0; i < probeCount; i += 1) probes.push(reader.read(4));

  const gateCount = reader.read(4);
  const inputs = ["i0", "i1", "i2", "i3"];
  const gates = [];
  for (let index = 0; index < gateCount; index += 1) {
    const type = GATE_TYPES[reader.read(2)];
    const in0 = reader.read(SIGNAL_BITS);
    const in1 = reader.read(SIGNAL_BITS);
    gates.push({ type, in0, in1 });
  }
  const outputs = ["o0", "o1", "o2", "o3"];
  const outputIndexes = outputs.map(() => reader.read(SIGNAL_BITS));

  const signals = [...inputs];
  const netlist = { inputs, outputs, gates: [], outputsMap: {} };
  gates.forEach((raw, index) => {
    const id = `g${String(index + 1).padStart(2, "0")}`;
    const arity = gateArity(raw.type);
    const pins = [signals[raw.in0]];
    if (arity === 2) pins.push(signals[raw.in1]);
    if (pins.some((pin) => typeof pin !== "string")) throw new Error(`短码损坏：第 ${index + 1} 个门引用了不存在的信号`);
    netlist.gates.push({ id, type: raw.type, in: pins });
    signals.push(id);
  });
  outputs.forEach((name, index) => {
    const src = signals[outputIndexes[index]];
    if (typeof src !== "string") throw new Error(`短码损坏：输出 ${name} 引用了不存在的信号`);
    netlist.outputsMap[name] = src;
  });

  return { version, seed, seedText: seed.toString(), probes, netlist };
}
