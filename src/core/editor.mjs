// 门编辑器草稿模型：纯数据 + 纯函数，不碰 DOM、不读时钟。
// 草稿里的引脚允许为空（未接线），提交前用 validateDraft 一次性给出全部问题。
// 位置只是画布坐标（32×32 吸附），不参与任何判定。

import { GATE_TYPES, gateArity, topoOrder, validateNetlist } from "./netlist.mjs";

export const GRID = 32;
export const MAX_DRAFT_GATES = 12;
export const MAX_SIGNALS = 16; // 4 输入 + 12 门，与短码位宽一致

export function snapCoordinate(value, grid = GRID) {
  return Math.round(value / grid) * grid;
}

/** 新建草稿：输出端口先全部留空，玩家自己接。 */
export function createDraft(level) {
  return {
    inputs: [...level.inputs],
    outputs: [...level.outputs],
    gates: [],
    outputsMap: Object.fromEntries(level.outputs.map((name) => [name, null])),
    nextGateNumber: 1,
  };
}

export function signalList(draft) {
  return [...draft.inputs, ...draft.gates.map((gate) => gate.id)];
}

export function gateById(draft, id) {
  return draft.gates.find((gate) => gate.id === id) ?? null;
}

function nextGateId(draft) {
  const taken = new Set([...draft.inputs, ...draft.outputs, ...draft.gates.map((gate) => gate.id)]);
  for (let n = draft.nextGateNumber; n < 1000; n += 1) {
    const id = `g${String(n).padStart(2, "0")}`;
    if (!taken.has(id)) return { id, next: n + 1 };
  }
  return { id: null, next: draft.nextGateNumber };
}

/**
 * 摆一个零件。位置按 32 网格吸附；返回错误对象而不是抛异常。
 */
export function addGate(draft, type, position = {}) {
  if (!GATE_TYPES.includes(type)) {
    return { ok: false, errors: [{ code: "gate-type", message: `没有这种零件: ${String(type)}` }] };
  }
  if (draft.gates.length >= MAX_DRAFT_GATES) {
    return {
      ok: false,
      errors: [{ code: "gate-limit", message: `最多摆 ${MAX_DRAFT_GATES} 个零件` }],
    };
  }
  const { id, next } = nextGateId(draft);
  if (!id) return { ok: false, errors: [{ code: "gate-limit", message: "没有可用的零件编号" }] };
  const gate = {
    id,
    type,
    in: new Array(gateArity(type)).fill(null),
    x: snapCoordinate(Number.isFinite(position.x) ? position.x : 320),
    y: snapCoordinate(Number.isFinite(position.y) ? position.y : 160),
  };
  draft.gates.push(gate);
  draft.nextGateNumber = next;
  return { ok: true, id, gate };
}

export function moveGate(draft, id, position) {
  const gate = gateById(draft, id);
  if (!gate) return { ok: false, errors: [{ code: "gate-missing", message: "选中的零件已经不在了" }] };
  gate.x = snapCoordinate(position.x);
  gate.y = snapCoordinate(position.y);
  return { ok: true };
}

/** 删除零件，同时清掉所有指向它的接线（含输出映射），不留悬空引用。 */
export function removeGate(draft, id) {
  const index = draft.gates.findIndex((gate) => gate.id === id);
  if (index < 0) return { ok: false, errors: [{ code: "gate-missing", message: "选中的零件已经不在了" }] };
  draft.gates.splice(index, 1);
  for (const gate of draft.gates) {
    gate.in = gate.in.map((src) => (src === id ? null : src));
  }
  for (const name of draft.outputs) {
    if (draft.outputsMap[name] === id) draft.outputsMap[name] = null;
  }
  return { ok: true };
}

export function clearDraft(draft) {
  draft.gates = [];
  draft.nextGateNumber = 1;
  for (const name of draft.outputs) draft.outputsMap[name] = null;
}

/** 目标可以是 {gate, pin} 或 {output}。source 为信号名。 */
export function connectSignal(draft, source, target) {
  if (!signalList(draft).includes(source)) {
    return { ok: false, errors: [{ code: "signal-unknown", message: "这个信号不存在" }] };
  }
  if (target && typeof target.gate === "string") {
    const gate = gateById(draft, target.gate);
    if (!gate) return { ok: false, errors: [{ code: "gate-missing", message: "目标零件不存在" }] };
    const pin = Number(target.pin);
    if (!Number.isInteger(pin) || pin < 0 || pin >= gate.in.length) {
      return { ok: false, errors: [{ code: "pin-range", message: "这个输入端不存在" }] };
    }
    if (source === gate.id) {
      return { ok: false, errors: [{ code: "self-loop", message: "零件不能接自己的输出" }] };
    }
    gate.in[pin] = source;
    return { ok: true };
  }
  if (target && typeof target.output === "string") {
    if (!draft.outputs.includes(target.output)) {
      return { ok: false, errors: [{ code: "output-missing", message: "这个输出端口不存在" }] };
    }
    draft.outputsMap[target.output] = source;
    return { ok: true };
  }
  return { ok: false, errors: [{ code: "target-missing", message: "没有可接的位置" }] };
}

export function disconnectPin(draft, gateId, pin) {
  const gate = gateById(draft, gateId);
  if (!gate) return { ok: false, errors: [{ code: "gate-missing", message: "目标零件不存在" }] };
  gate.in[pin] = null;
  return { ok: true };
}

export function setOutput(draft, name, source) {
  if (!draft.outputs.includes(name)) {
    return { ok: false, errors: [{ code: "output-missing", message: "这个输出端口不存在" }] };
  }
  if (source !== null && !signalList(draft).includes(source)) {
    return { ok: false, errors: [{ code: "signal-unknown", message: "这个信号不存在" }] };
  }
  draft.outputsMap[name] = source;
  return { ok: true };
}

function draftNetlist(draft) {
  return {
    inputs: draft.inputs,
    outputs: draft.outputs,
    gates: draft.gates.map((gate) => ({ id: gate.id, type: gate.type, in: [...gate.in] })),
    outputsMap: { ...draft.outputsMap },
  };
}

/**
 * 提交前校验。返回 {ok, errors:[{code,message,gateId,pin}]}，一次列全，不抛异常。
 *
 * 口径（与 K8 / §4.3 一致）：只有"输出锥内"的零件参与校验与计分。
 * 玩家多摆的未使用零件既不惩罚，也不因为它们没接线就卡住提交；
 * 但它们也不会被算进门数（countedGates 只看输出锥）。
 */
export function validateDraft(draft) {
  const errors = [];
  const signals = new Set(signalList(draft));
  if (draft.gates.length === 0) {
    errors.push({ code: "empty", message: "还没有摆零件" });
  }
  if (draft.inputs.length + draft.gates.length > MAX_SIGNALS) {
    errors.push({ code: "signal-limit", message: `信号总数不能超过 ${MAX_SIGNALS} 个` });
  }

  for (const name of draft.outputs) {
    const src = draft.outputsMap[name];
    if (src === null || typeof src !== "string") {
      errors.push({ code: "output-unmapped", message: `输出端口 ${name} 还没接` });
    } else if (!signals.has(src)) {
      errors.push({ code: "output-unknown", message: `输出端口 ${name} 接到了不存在的信号` });
    }
  }

  const used = reachableGates(draft);
  for (const gate of draft.gates) {
    if (!used.has(gate.id)) continue; // 未使用零件：不计分，也不参与校验
    gate.in.forEach((src, pin) => {
      if (src === null) {
        errors.push({
          code: "pin-unconnected",
          message: `零件 ${gate.id} 的输入端 ${pin + 1} 还没接`,
          gateId: gate.id,
          pin,
        });
      } else if (!signals.has(src)) {
        errors.push({
          code: "pin-unknown",
          message: `零件 ${gate.id} 的输入端 ${pin + 1} 接到了不存在的信号`,
          gateId: gate.id,
          pin,
        });
      }
    });
  }

  // 环检测只看向输出锥内的零件；未使用零件之间的环不影响结果。
  const { cyclic } = topoOrder({ ...draftNetlist(draft), gates: draft.gates.filter((gate) => used.has(gate.id)) });
  if (cyclic.length > 0) {
    errors.push({ code: "cycle", message: `接线绕成了环（${cyclic.join(",")}），结果会一直是未知` });
  }

  if (errors.length === 0) {
    const structural = validateNetlist(reachableNetlist(draft, used));
    for (const message of structural.errors) errors.push({ code: "netlist", message });
  }
  return {
    ok: errors.length === 0,
    errors,
    netlist: errors.length === 0 ? reachableNetlist(draft, used) : null,
  };
}

/** 只保留输出锥内的零件：未使用的草稿零件不进入提交网表，也不参与计分。 */
export function reachableNetlist(draft, used = reachableGates(draft)) {
  return {
    inputs: [...draft.inputs],
    outputs: [...draft.outputs],
    gates: draft.gates
      .filter((gate) => used.has(gate.id))
      .map((gate) => ({ id: gate.id, type: gate.type, in: gate.in.map((src) => src ?? "") })),
    outputsMap: Object.fromEntries(draft.outputs.map((name) => [name, draft.outputsMap[name] ?? ""])),
  };
}

/** 从输出端口反向可达的零件集合（输出锥的并集）。 */
export function reachableGates(draft) {
  const byId = new Map(draft.gates.map((gate) => [gate.id, gate]));
  const seen = new Set();
  const stack = [];
  for (const name of draft.outputs) {
    const src = draft.outputsMap[name];
    if (typeof src === "string") stack.push(src);
  }
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const src of byId.get(id).in) {
      if (typeof src === "string") stack.push(src);
    }
  }
  return seen;
}

/** 无条件取网表（供预览/编码）；未接线的引脚用空串占位，交给校验层报错。 */
export function toNetlist(draft) {
  const netlist = draftNetlist(draft);
  for (const gate of netlist.gates) gate.in = gate.in.map((src) => src ?? "");
  for (const name of netlist.outputs) netlist.outputsMap[name] = netlist.outputsMap[name] ?? "";
  return netlist;
}
