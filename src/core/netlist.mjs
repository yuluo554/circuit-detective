// 网表结构与拓扑排序。网表是纯数据：门类型 + 输入引脚引用 + 输出映射。
// 这里不读取任何时钟、随机数或环境信息。

export const GATE_TYPES = Object.freeze(["NOT", "AND", "OR"]);
export const GATE_ARITY = Object.freeze({ NOT: 1, AND: 2, OR: 2 });
export const DEFAULT_INPUT_COUNT = 4;
export const DEFAULT_OUTPUT_COUNT = 4;

export function gateArity(type) {
  return GATE_ARITY[type] ?? 0;
}

export function signalIds(netlist) {
  const ids = [...netlist.inputs];
  for (const gate of netlist.gates) ids.push(gate.id);
  return ids;
}

export function gateMap(netlist) {
  const map = new Map();
  for (const gate of netlist.gates) map.set(gate.id, gate);
  return map;
}

/**
 * 校验网表结构。返回 {ok, errors}，不抛异常，便于把坏数据挡在仿真之外。
 */
export function validateNetlist(netlist) {
  const errors = [];
  if (!netlist || typeof netlist !== "object") {
    return { ok: false, errors: ["网表必须是对象"] };
  }
  if (!Array.isArray(netlist.inputs) || netlist.inputs.length === 0) {
    errors.push("inputs 必须是非空数组");
  }
  if (!Array.isArray(netlist.outputs) || netlist.outputs.length === 0) {
    errors.push("outputs 必须是非空数组");
  }
  const inputs = Array.isArray(netlist.inputs) ? netlist.inputs : [];
  const outputs = Array.isArray(netlist.outputs) ? netlist.outputs : [];
  if (new Set(inputs).size !== inputs.length) errors.push("inputs 含重复端口名");
  if (new Set(outputs).size !== outputs.length) errors.push("outputs 含重复端口名");
  for (const name of outputs) {
    if (inputs.includes(name)) errors.push(`输出端口不得与输入端口同名: ${name}`);
  }

  const gates = Array.isArray(netlist.gates) ? netlist.gates : [];
  if (!Array.isArray(netlist.gates)) errors.push("gates 必须是数组");

  // 两遍：先收集全部信号名（允许前向引用，组合环靠拓扑排序识别），再校验引脚。
  const known = new Set(inputs);
  const ids = new Set();
  for (const gate of gates) {
    if (!gate || typeof gate !== "object") continue;
    if (typeof gate.id !== "string" || gate.id.length === 0) continue;
    if (ids.has(gate.id)) errors.push(`门 id 重复: ${gate.id}`);
    if (known.has(gate.id)) errors.push(`门 id 与输入端口重名: ${gate.id}`);
    ids.add(gate.id);
    known.add(gate.id);
  }

  for (const gate of gates) {
    if (!gate || typeof gate !== "object") {
      errors.push("门必须是对象");
      continue;
    }
    if (typeof gate.id !== "string" || gate.id.length === 0) {
      errors.push("门缺少字符串 id");
      continue;
    }
    if (!GATE_TYPES.includes(gate.type)) {
      errors.push(`未知门类型: ${gate.type}`);
      continue;
    }
    const arity = gateArity(gate.type);
    if (!Array.isArray(gate.in) || gate.in.length !== arity) {
      errors.push(`门 ${gate.id} 的输入引脚数应为 ${arity}`);
      continue;
    }
    for (const src of gate.in) {
      if (!known.has(src)) errors.push(`门 ${gate.id} 引用了未定义信号: ${src}`);
    }
  }

  const outMap = netlist.outputsMap || netlist.out;
  if (!outMap || typeof outMap !== "object") {
    errors.push("outputsMap 必须存在");
  } else {
    for (const name of outputs) {
      const src = outMap[name];
      if (typeof src !== "string") {
        errors.push(`输出端口 ${name} 未映射到信号`);
      } else if (!known.has(src)) {
        errors.push(`输出端口 ${name} 引用了未定义信号: ${src}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Kahn 拓扑排序；同一层按门 id 字典序，保证求值顺序可复现。
 * cyclic 是拓扑排序覆盖不到的门（组合环成员）。
 */
export function topoOrder(netlist) {
  const gateById = gateMap(netlist);
  const indegree = new Map();
  const dependents = new Map();
  for (const gate of netlist.gates) {
    indegree.set(gate.id, 0);
    dependents.set(gate.id, []);
  }
  for (const gate of netlist.gates) {
    for (const src of gate.in) {
      if (!gateById.has(src)) continue;
      indegree.set(gate.id, indegree.get(gate.id) + 1);
      dependents.get(src).push(gate.id);
    }
  }

  const ready = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();

  const order = [];
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(id);
    const next = dependents.get(id);
    next.sort();
    for (const dependent of next) {
      const degree = indegree.get(dependent) - 1;
      indegree.set(dependent, degree);
      if (degree === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  const ordered = new Set(order);
  const cyclic = netlist.gates.map((gate) => gate.id).filter((id) => !ordered.has(id)).sort();
  return { order, cyclic };
}

/** 固定键顺序的关卡 JSON，字节级一致的前提。 */
export function levelToJson(level) {
  const ordered = {
    format: level.format,
    version: level.version,
    id: level.id,
    seed: level.seed,
    label: level.label,
    difficulty: level.difficulty,
    inputs: level.inputs,
    outputs: level.outputs,
    netlist: {
      inputs: level.netlist.inputs,
      outputs: level.netlist.outputs,
      gates: level.netlist.gates.map((gate) => ({ id: gate.id, type: gate.type, in: gate.in })),
      outputsMap: level.netlist.outputsMap,
    },
    optimal: level.optimal,
  };
  return JSON.stringify(ordered);
}
