// 独立第二实现（测试专用）：不 import 生产模块，用逐 tick 数组 + 显式真值表重写三值求值。
// 只用于交叉验证；生产代码禁止引用本文件。

export const REF_X = 2;

// 每个 tick 重新做一次拓扑分层，不共享生产实现的门类型表。
function layers(netlist) {
  const depends = new Map();
  const known = new Set(netlist.inputs);
  for (const gate of netlist.gates) depends.set(gate.id, gate.in.filter((src) => !netlist.inputs.includes(src)));
  const done = new Set();
  const result = [];
  let remaining = netlist.gates.map((gate) => gate.id);
  let guard = 0;
  while (remaining.length > 0 && guard <= netlist.gates.length) {
    guard += 1;
    const layer = remaining.filter((id) => depends.get(id).every((src) => done.has(src) || !depends.has(src)));
    if (layer.length === 0) break;
    layer.sort();
    for (const id of layer) done.add(id);
    result.push(layer);
    remaining = remaining.filter((id) => !done.has(id));
  }
  return { result, cyclic: remaining.sort() };
}

function refApply(type, args) {
  switch (type) {
    case "NOT":
      return args[0] === REF_X ? REF_X : 1 - args[0];
    case "AND":
      if (args.some((value) => value === 0)) return 0;
      return args.some((value) => value === REF_X) ? REF_X : 1;
    case "OR":
      if (args.some((value) => value === 1)) return 1;
      return args.some((value) => value === REF_X) ? REF_X : 0;
    default:
      return REF_X;
  }
}

/** 参考实现：返回 {outputs, gateValues, ticks, stable}。 */
export function referenceSimulate(netlist, vector) {
  const { result, cyclic } = layers(netlist);
  const inputValues = {};
  netlist.inputs.forEach((name, index) => {
    const raw = Array.isArray(vector) ? vector[index] : vector[name];
    inputValues[name] = raw === 0 || raw === 1 ? raw : REF_X;
  });

  let previous = {};
  for (const gate of netlist.gates) previous[gate.id] = REF_X;
  const limit = netlist.gates.length + 1;
  let stable = false;
  let ticks = 0;

  for (let tick = 0; tick < limit; tick += 1) {
    ticks = tick + 1;
    const next = {};
    for (const layer of result) {
      for (const id of layer) {
        const gate = netlist.gates.find((candidate) => candidate.id === id);
        const args = gate.in.map((src) => (src in inputValues ? inputValues[src] : previous[src]));
        next[id] = refApply(gate.type, args);
      }
    }
    for (const id of cyclic) next[id] = REF_X;
    const outputs = readOutputs(netlist, next, inputValues);
    if (tick > 0 && sameMap(previous, next)) {
      stable = true;
      previous = next;
      return { outputs, gateValues: next, ticks, stable };
    }
    previous = next;
  }
  const allX = {};
  for (const gate of netlist.gates) allX[gate.id] = REF_X;
  return {
    outputs: readOutputs(netlist, allX, inputValues),
    gateValues: allX,
    ticks,
    stable,
  };
}

function readOutputs(netlist, gateValues, inputValues) {
  const outputs = {};
  for (const name of netlist.outputs) {
    const src = netlist.outputsMap[name];
    outputs[name] = src in inputValues ? inputValues[src] : gateValues[src];
  }
  return outputs;
}

function sameMap(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((key) => a[key] === b[key]);
}
