// 三值 unit-delay 仿真核。口径单点定义在 data/README.md §4.1。
// 纯整数运算；输入取上一 tick 的值；组合环成员恒为 X。
// 本模块不读时钟、不读随机数、不做任何渲染。

import { gateArity, topoOrder, validateNetlist } from "./netlist.mjs";

export const X = 2;

function applyGate(type, values) {
  if (type === "NOT") {
    const v = values[0];
    if (v === X) return X;
    return v === 0 ? 1 : 0;
  }
  if (type === "AND") {
    let sawX = false;
    for (const v of values) {
      if (v === 0) return 0;
      if (v === X) sawX = true;
    }
    return sawX ? X : 1;
  }
  if (type === "OR") {
    let sawX = false;
    for (const v of values) {
      if (v === 1) return 1;
      if (v === X) sawX = true;
    }
    return sawX ? X : 0;
  }
  return X;
}

/**
 * 求值一个网表。
 * @param {object} netlist {inputs, outputs, gates, outputsMap}
 * @param {number[]|object} inputVector 数组（按 inputs 顺序）或对象（端口名→0/1）
 * @param {{maxTicks?: number, recordTrace?: boolean}} [options]
 * @returns {{outputs: object, gates: object, stable: boolean, ticks: number,
 *   trace: Array<object>, diagnostics: string[], ok: boolean, errors: string[]}}
 */
export function simulate(netlist, inputVector, options = {}) {
  const check = validateNetlist(netlist);
  if (!check.ok) {
    return {
      ok: false,
      errors: check.errors,
      outputs: {},
      gates: {},
      stable: false,
      ticks: 0,
      trace: [],
      diagnostics: ["网表不合法"],
    };
  }

  const values = readInputVector(netlist.inputs, inputVector);
  const { order, cyclic } = topoOrder(netlist);
  const gateById = new Map(netlist.gates.map((gate) => [gate.id, gate]));
  const limit = options.maxTicks ?? netlist.gates.length + 1;
  const trace = [];

  let prev = new Map();
  for (const gate of netlist.gates) prev.set(gate.id, X);

  let current = new Map(prev);
  let outputs = readOutputs(netlist, current, values);
  let stable = false;
  let ticks = 0;
  const diagnostics = [];

  if (cyclic.length > 0) {
    diagnostics.push(`组合环 ${cyclic.join(",")} 恒为 X`);
  }

  for (let tick = 0; tick < limit; tick += 1) {
    ticks = tick + 1;
    const next = new Map();
    for (const id of order) {
      const gate = gateById.get(id);
      const arity = gateArity(gate.type);
      const args = new Array(arity);
      for (let i = 0; i < arity; i += 1) {
        const src = gate.in[i];
        args[i] = Object.hasOwn(values, src) ? values[src] : (prev.get(src) ?? X);
      }
      next.set(id, applyGate(gate.type, args));
    }
    for (const id of cyclic) next.set(id, X);

    const nextOutputs = readOutputs(netlist, next, values);
    if (options.recordTrace !== false) {
      trace.push({ tick, gates: Object.fromEntries(next), outputs: { ...nextOutputs } });
    }

    if (tick > 0 && mapsEqual(prev, next) && objectsEqual(outputs, nextOutputs)) {
      stable = true;
      current = next;
      outputs = nextOutputs;
      break;
    }
    prev = next;
    current = next;
    outputs = nextOutputs;
  }

  if (!stable) {
    diagnostics.push(`未在 ${limit} tick 内稳定，按全 X 处理`);
    const allX = new Map();
    for (const gate of netlist.gates) allX.set(gate.id, X);
    current = allX;
    outputs = readOutputs(netlist, allX, values);
  }

  return {
    ok: true,
    errors: [],
    outputs,
    gates: Object.fromEntries(current),
    stable,
    ticks,
    trace,
    diagnostics,
  };
}

function readInputVector(inputs, inputVector) {
  const result = {};
  if (Array.isArray(inputVector)) {
    inputs.forEach((name, index) => {
      const raw = inputVector[index];
      result[name] = raw === 0 || raw === 1 ? raw : X;
    });
    return result;
  }
  for (const name of inputs) {
    const raw = inputVector?.[name];
    result[name] = raw === 0 || raw === 1 ? raw : X;
  }
  return result;
}

function readOutputs(netlist, gateValues, inputValues) {
  const outputs = {};
  for (const name of netlist.outputs) {
    const src = netlist.outputsMap[name];
    outputs[name] = Object.hasOwn(inputValues, src) ? inputValues[src] : (gateValues.get(src) ?? X);
  }
  return outputs;
}

function mapsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

function objectsEqual(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

/** 4 输入的全部 16 行组合，按 [A,B,C,D] 从 0000 到 1111 排序。 */
export function inputCombinations(count) {
  const rows = [];
  const total = 1 << count;
  for (let i = 0; i < total; i += 1) {
    const row = [];
    for (let bit = 0; bit < count; bit += 1) row.push((i >> (count - 1 - bit)) & 1);
    rows.push(row);
  }
  return rows;
}

/**
 * 全表求值（不抽样）。行序 = inputCombinations 的顺序。
 */
export function truthTable(netlist) {
  const rows = inputCombinations(netlist.inputs.length);
  return rows.map((row) => {
    const result = simulate(netlist, row, { recordTrace: false });
    return { input: row, outputs: result.outputs, stable: result.stable, ok: result.ok };
  });
}

/**
 * 把真值表压成每个输出端口一个 16 位掩码：bit i 对应第 i 行的输出。
 * 含 X 的行在掩码里记 0，并由 hasX 标出，调用方不得把含 X 的表当作可用关卡。
 */
export function truthTableMasks(netlist) {
  const table = truthTable(netlist);
  const masks = {};
  const hasX = {};
  for (const name of netlist.outputs) {
    let mask = 0;
    let xSeen = false;
    table.forEach((row, index) => {
      const value = row.outputs[name];
      if (value === X) {
        xSeen = true;
      } else if (value === 1) {
        mask |= 1 << index;
      }
    });
    masks[name] = mask;
    hasX[name] = xSeen;
  }
  return { table, masks, hasX };
}

export function firstMismatch(actualNetlist, expectedNetlist) {
  const actual = truthTable(actualNetlist);
  const expected = truthTable(expectedNetlist);
  for (let row = 0; row < expected.length; row += 1) {
    for (const name of expectedNetlist.outputs) {
      if (actual[row]?.outputs?.[name] !== expected[row].outputs[name]) {
        return {
          row,
          input: expected[row].input,
          output: name,
          expected: expected[row].outputs[name],
          actual: actual[row]?.outputs?.[name] ?? null,
        };
      }
    }
  }
  return null;
}
