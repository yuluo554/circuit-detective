// Canvas2D 渲染：黑色芯片盒 + 左侧四个拨杆 + 右侧四个灯。
// 渲染层不参与任何判定：只消费 sim 返回的 outputs。

const LAMP_X = 700;
const LAMP_Y0 = 150;
const LAMP_GAP = 82;
const LEVER_X = 150;
const LEVER_Y0 = 150;
const LEVER_GAP = 82;

export function drawBoard(ctx, state) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  // 背景网格
  ctx.save();
  ctx.strokeStyle = "#1d222b";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  // 芯片盒
  const box = { x: 260, y: 70, w: 360, h: 420 };
  ctx.save();
  ctx.fillStyle = "#0c0e12";
  ctx.strokeStyle = "#3a414d";
  ctx.lineWidth = 2;
  roundRect(ctx, box.x, box.y, box.w, box.h, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#5c6370";
  ctx.font = "12px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("BLACK BOX", box.x + box.w / 2, box.y + 30);
  ctx.fillStyle = "#333a45";
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.arc(box.x + 40 + i * 22, box.y + box.h - 26, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 输入拨杆
  for (let index = 0; index < state.inputs.length; index += 1) {
    const on = state.values[index] === 1;
    const cy = LEVER_Y0 + index * LEVER_GAP;
    drawLever(ctx, LEVER_X, cy, on, index);
    drawWire(ctx, LEVER_X + 34, cy, box.x + 22, LEVER_Y0 + index * 60);
  }

  // 输出灯
  for (let index = 0; index < state.outputs.length; index += 1) {
    const cy = LAMP_Y0 + index * LAMP_GAP;
    drawLamp(ctx, LAMP_X, cy, state.lamps[index], index);
    drawWire(ctx, box.x + box.w - 22, LEVER_Y0 + index * 60, LAMP_X - 40, cy);
  }

  // 输入小标签（只写 A/B/C/D，不出现"门"字样，见 D1）
  ctx.save();
  ctx.fillStyle = "#6d7481";
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";
  state.inputs.forEach((name, index) => {
    ctx.fillText(String.fromCharCode(65 + index), LEVER_X - 56, LEVER_Y0 + index * LEVER_GAP + 4);
  });
  state.outputs.forEach((name, index) => {
    ctx.fillText(String(index + 1), LAMP_X + 58, LAMP_Y0 + index * LAMP_GAP + 4);
  });
  ctx.restore();
}

function drawLever(ctx, x, y, on, index) {
  ctx.save();
  ctx.fillStyle = on ? "#2a2418" : "#171b22";
  ctx.strokeStyle = on ? "#e0b062" : "#3a414d";
  ctx.lineWidth = 2;
  roundRect(ctx, x - 26, y - 20, 52, 40, 10);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = on ? "#e0b062" : "#4a515e";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + 8);
  ctx.lineTo(x + (on ? 12 : -12), y - 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y + 8, 3, 0, Math.PI * 2);
  ctx.fillStyle = on ? "#e0b062" : "#4a515e";
  ctx.fill();
  ctx.restore();
}

function drawLamp(ctx, x, y, value, index) {
  ctx.save();
  ctx.strokeStyle = "#3a414d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  ctx.stroke();

  const lit = value === 1;
  const unknown = value === 2;
  if (lit || unknown) {
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 30);
    glow.addColorStop(0, lit ? "rgba(111,208,140,0.85)" : "rgba(165,139,216,0.75)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = lit ? "#6fd08c" : unknown ? "#a58bd8" : "#232830";
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWire(ctx, x1, y1, x2, y2) {
  ctx.save();
  ctx.strokeStyle = "#2c333e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const midX = (x1 + x2) / 2;
  ctx.bezierCurveTo(midX, y1, midX, y2, x2, y2);
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
