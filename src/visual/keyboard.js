import { noteName } from '../piano/layout.js';
import { rgba } from '../util.js';

const BLACK_H = 0.67;
const SPECTRUM = [
  [0, [92, 214, 255]],
  [0.22, [96, 232, 186]],
  [0.46, [186, 244, 132]],
  [0.66, [255, 214, 132]],
  [0.84, [255, 168, 198]],
  [1, [206, 168, 255]]
];

function pressed(midi, glow) {
  return !!glow.get(midi)?.held;
}

function tint(midi, glow, theme) {
  return glow.get(midi)?.color || theme.accent;
}

function spectrum(x, width) {
  const t = Math.max(0, Math.min(1, x / Math.max(1, width)));
  let i = 1;
  while (i < SPECTRUM.length && SPECTRUM[i][0] < t) i++;
  const [t0, c0] = SPECTRUM[i - 1];
  const [t1, c1] = SPECTRUM[Math.min(i, SPECTRUM.length - 1)];
  const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  const mix = c0.map((channel, index) => Math.round(channel + (c1[index] - channel) * u));
  return mix;
}

function rgbaAt(x, width, alpha) {
  const [r, g, b] = spectrum(x, width);
  return `rgba(${r},${g},${b},${alpha})`;
}

function whitePath(ctx, x, y, w, h) {
  const r = Math.min(2.6, w * 0.2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.closePath();
}

function paintWhite(ctx, key, opts) {
  const { keyTop, keyH, theme, glow, width } = opts;
  const down = pressed(key.midi, glow);
  const x = key.x + 0.7;
  const w = Math.max(1, key.w - 1.4);
  const h = keyH;
  ctx.save();
  whitePath(ctx, x, keyTop, w, h);
  ctx.clip();
  const body = ctx.createLinearGradient(0, keyTop, 0, keyTop + h);
  body.addColorStop(0, '#e4e7eb');
  body.addColorStop(0.12, '#c4c8cc');
  body.addColorStop(0.4, '#a0a19f');
  body.addColorStop(0.7, '#8c8c8a');
  body.addColorStop(1, '#969694');
  ctx.fillStyle = body;
  ctx.fillRect(x, keyTop, w, h);
  if (down) {
    ctx.fillStyle = rgba(tint(key.midi, glow, theme), 0.58);
    ctx.fillRect(x, keyTop, w, h);
  }
  const spill = ctx.createLinearGradient(0, keyTop, 0, keyTop + h * 0.22);
  spill.addColorStop(0, rgbaAt(key.x + key.w / 2, width, 0.5));
  spill.addColorStop(1, rgbaAt(key.x + key.w / 2, width, 0));
  ctx.fillStyle = spill;
  ctx.fillRect(x, keyTop, w, h * 0.22);
  ctx.restore();
}

function blackBox(key, keyTop, keyH) {
  const h = keyH * BLACK_H;
  const x = key.x + 1;
  const w = Math.max(3, key.w - 2);
  return { x, y: keyTop, w, h };
}

function facePoints(box) {
  const { x, y, w, h } = box;
  const faceH = Math.min(9.6, Math.max(6.3, h * 0.08));
  const bottom = y + h - 1;
  const top = bottom - faceH;
  const topInset = Math.max(1.5, w * 0.24);
  const botInset = Math.max(0.8, w * 0.1);
  return {
    top,
    bottom,
    tl: [x + topInset, top],
    tr: [x + w - topInset, top],
    br: [x + w - botInset, bottom],
    bl: [x + botInset, bottom]
  };
}

function paintBlack(ctx, key, opts) {
  const { keyTop, keyH, theme, glow, width } = opts;
  const down = pressed(key.midi, glow);
  const box = blackBox(key, keyTop, keyH);
  const { x, y, w, h } = box;
  const face = facePoints(box);

  ctx.fillStyle = down ? tint(key.midi, glow, theme) : '#09090b';
  ctx.fillRect(x, y, w, h);

  const rail = Math.max(1, Math.min(2.2, w * 0.12));
  ctx.fillStyle = down ? 'rgba(255,255,255,0.28)' : '#3e3e44';
  ctx.fillRect(x, y, rail, h);
  ctx.fillStyle = down ? 'rgba(0,0,0,0.28)' : '#2a2a30';
  ctx.fillRect(x + w - rail, y, rail, h);

  const spill = ctx.createLinearGradient(0, y, 0, y + h * 0.2);
  spill.addColorStop(0, rgbaAt(x + w / 2, width, 0.75));
  spill.addColorStop(1, rgbaAt(x + w / 2, width, 0));
  ctx.fillStyle = spill;
  ctx.fillRect(x + rail, y, w - rail * 2, h * 0.2);

  ctx.beginPath();
  ctx.moveTo(face.tl[0], face.tl[1]);
  ctx.lineTo(face.tr[0], face.tr[1]);
  ctx.lineTo(face.br[0], face.br[1]);
  ctx.lineTo(face.bl[0], face.bl[1]);
  ctx.closePath();
  const faceFill = ctx.createLinearGradient(0, face.top, 0, face.bottom);
  faceFill.addColorStop(0, down ? 'rgba(0,0,0,0.2)' : '#1a1a1e');
  faceFill.addColorStop(1, down ? 'rgba(0,0,0,0.45)' : '#34343a');
  ctx.fillStyle = faceFill;
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.beginPath();
  ctx.moveTo(face.bl[0], face.top - 2);
  ctx.lineTo(face.br[0], face.top - 2);
  ctx.lineTo(face.tr[0], face.top);
  ctx.lineTo(face.tl[0], face.top);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(face.bl[0], face.bl[1]);
  ctx.lineTo(face.tl[0], face.tl[1]);
  ctx.lineTo(face.tr[0], face.tr[1]);
  ctx.lineTo(face.br[0], face.br[1]);
  ctx.strokeStyle = down ? 'rgba(255,255,255,0.72)' : 'rgba(188,188,196,0.9)';
  ctx.lineWidth = Math.max(1, w * 0.07);
  ctx.lineJoin = 'miter';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(face.tl[0] + w * 0.08, face.top);
  ctx.lineTo(face.tr[0] - w * 0.08, face.top);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(1, h * 0.014);
  ctx.stroke();
}

function paintTopLine(ctx, keyTop, width) {
  const line = ctx.createLinearGradient(0, 0, width, 0);
  for (const [stop, color] of SPECTRUM) {
    line.addColorStop(stop, `rgb(${color[0]},${color[1]},${color[2]})`);
  }
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.55)';
  ctx.shadowBlur = 5;
  ctx.fillStyle = line;
  ctx.fillRect(0, keyTop, width, 1.5);
  ctx.restore();
}

export function drawKeyboard(ctx, opts) {
  const { layout, keyTop, keyH, width, height, theme, glow, showLabels, hover } = opts;
  if (!layout) return;

  ctx.fillStyle = '#050505';
  ctx.fillRect(0, keyTop, width, height - keyTop + 4);

  for (const key of layout.whites) paintWhite(ctx, key, opts);
  for (const key of layout.blacks) {
    ctx.fillStyle = '#050505';
    ctx.fillRect(key.x, keyTop, key.w, keyH * BLACK_H + 1.5);
  }
  for (const key of layout.blacks) paintBlack(ctx, key, opts);
  paintTopLine(ctx, keyTop, width);

  if (showLabels) {
    ctx.font = '11px Oxanium, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const key of layout.whites) {
      if (key.midi % 12 !== 0 || key.w < 13) continue;
      ctx.fillStyle = pressed(key.midi, glow) ? 'rgba(16, 18, 22, 0.78)' : 'rgba(78, 80, 84, 0.72)';
      ctx.fillText(noteName(key.midi), key.x + key.w / 2, keyTop + keyH - 7);
    }
  }

  if (hover != null) {
    const key = layout.byMidi[hover];
    if (key) {
      ctx.strokeStyle = rgba(theme.accent, 0.9);
      ctx.lineWidth = 1;
      if (key.black) {
        const box = blackBox(key, keyTop, keyH);
        ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
      } else {
        ctx.strokeRect(key.x + 0.7, keyTop + 0.5, Math.max(1, key.w - 1.4), keyH - 1);
      }
    }
  }
}
