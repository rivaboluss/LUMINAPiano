import { createLayout, hitTest } from '../piano/layout.js';
import { clamp, formatTime, lowerBound, rgba, roundRect } from '../util.js';
import { getTheme } from './theme.js';
import { createParticles } from './particles.js';
import { drawKeyboard } from './keyboard.js';

const HIT_EARLY = 0.11;
const HIT_LATE = 0.14;
const PERFECT = 0.045;
const GREAT = 0.085;
const JUDGE = {
  perfect: ['PERFECT', '#fff4c2'],
  great: ['GREAT', '#9efcff'],
  good: ['GOOD', '#d7c6ff'],
  miss: ['MISS', '#ff6b8a']
};
const SCORE = { perfect: 300, great: 200, good: 100 };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const particles = createParticles();
  const stars = Array.from({ length: 90 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.78,
    r: Math.random() * 1.3 + 0.3,
    p: Math.random() * Math.PI * 2,
    s: 0.6 + Math.random() * 1.6
  }));

  let theme = getTheme('neon');
  let flowColors = [];
  let smokeColors = [];
  let dpr = 1;
  let width = 1;
  let height = 1;
  let keyH = 180;
  let keyLift = 32;
  let hitY = 400;
  let recording = false;
  let pixelBudget = 2560 * 1440;
  let bgPulse = false;
  let stillBg = null;
  let layout = null;
  let lookAhead = 2.6;
  let particleLevel = 2;
  let darkness = 0.45;
  let blur = 0;
  let clean = false;
  let showLabels = true;
  let showGrid = true;
  let mode = 'free';
  let sustain = false;
  let hover = null;
  let bgImage = null;
  let bgCache = null;
  let bgKey = '';
  let vignette = null;
  let wash = null;
  const orbSprites = new Map();
  let songRef = null;
  let energy = 0;
  let combo = 0;
  let maxCombo = 0;
  let comboScale = 1;
  let score = 0;
  let counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  let judge = null;
  let result = null;
  let fxCursor = 0;
  let missCursor = 0;
  const glow = new Map();
  const liveHolds = new Map();
  const chartHolds = new Map();
  const releases = [];
  let liveNotes = [];
  let getPlaying = () => false;
  let getSongTime = () => 0;
  let getNow = () => performance.now() / 1000;
  let onFrameCb = null;
  let afterPaint = null;
  let last = performance.now();
  let raf = 0;
  let suspended = false;

  particles.setPalette([theme.accent]);

  function layoutFrame(nextWidth, nextHeight) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    const lift = Math.max(0, Math.min(keyLift, height * 0.22));
    const room = Math.max(1, height - lift);
    let nextKey = Math.min(room * 0.28, 220);
    const waterfall = Math.min(room * 0.62, 160);
    if (room - nextKey < waterfall) nextKey = Math.max(72, room - waterfall);
    keyH = nextKey;
    hitY = Math.max(48, height - keyH - lift);
    layout = createLayout(width, 8);
    vignette = null;
    wash = null;
    stillBg = null;
    bgKey = '';
  }

  function resize() {
    if (recording) return;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    let next = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = cssW * cssH * next * next;
    if (pixels > pixelBudget) next *= Math.sqrt(pixelBudget / pixels);
    dpr = Math.max(0.35, next);
    canvas.width = Math.max(2, Math.round(cssW * dpr));
    canvas.height = Math.max(2, Math.round(cssH * dpr));
    if (canvas.width % 2) canvas.width -= 1;
    if (canvas.height % 2) canvas.height -= 1;
    layoutFrame(cssW, cssH);
  }

  function particleMul() {
    return particles.multiplier(particleLevel);
  }

  function refreshGlow(midi, velocity) {
    const live = liveHolds.has(midi);
    const chart = chartHolds.get(midi) || 0;
    if (live || chart > 0) {
      const prev = glow.get(midi);
      glow.set(midi, {
        held: true,
        vel: velocity || prev?.vel || liveHolds.get(midi) || 80,
        color: noteColor('flow', midi)
      });
      return;
    }
    glow.delete(midi);
  }

  function paletteOf(kind) {
    const custom = kind === 'smoke' ? smokeColors : flowColors;
    return custom.length ? custom : [theme.accent];
  }

  function noteColor(kind, midi) {
    const colors = paletteOf(kind);
    if (colors.length === 1) return colors[0];
    const t = (clamp(midi, 21, 108) - 21) / 87;
    return colors[Math.min(colors.length - 1, Math.floor(t * colors.length))];
  }

  function burstAt(midi, velocity, big) {
    const key = layout?.byMidi[clamp(midi, 21, 108)];
    if (!key) return;
    particles.burst({
      x: key.x + key.w / 2,
      y: hitY,
      hex: noteColor('smoke', midi),
      vel: velocity,
      level: particleMul(),
      big
    });
    energy = Math.min(1, energy + (big ? 0.48 : 0.16) + velocity / 520);
  }

  function accuracy() {
    const total = counts.perfect + counts.great + counts.good + counts.miss;
    if (!total) return 100;
    return (counts.perfect * 100 + counts.great * 80 + counts.good * 50) / total;
  }

  function popJudge(kind) {
    const [text, color] = JUDGE[kind];
    judge = { text, color, life: 0.68, max: 0.68 };
  }

  function registerJudge(note, kind) {
    note.judged = kind;
    if (kind === 'miss') {
      combo = 0;
      counts.miss++;
      const key = layout?.byMidi[clamp(note.midi, 21, 108)];
      if (key) particles.miss({ x: key.x + key.w / 2, y: hitY });
    } else {
      combo++;
      maxCombo = Math.max(maxCombo, combo);
      counts[kind]++;
      score += Math.round(SCORE[kind] * (1 + Math.min(combo, 80) / 80));
      comboScale = 1.4;
      burstAt(note.midi, note.velocity, kind === 'perfect' || note.velocity > 104);
    }
    popJudge(kind);
  }

  function chartDown(note, visual) {
    chartHolds.set(note.midi, (chartHolds.get(note.midi) || 0) + 1);
    releases.push({ time: note.end, midi: note.midi });
    refreshGlow(note.midi, note.velocity);
    if (visual) burstAt(note.midi, note.velocity, note.velocity > 102);
  }

  function processReleases(songTime) {
    for (let i = releases.length - 1; i >= 0; i--) {
      if (releases[i].time > songTime) continue;
      const midi = releases[i].midi;
      releases.splice(i, 1);
      const count = (chartHolds.get(midi) || 1) - 1;
      if (count <= 0) chartHolds.delete(midi);
      else chartHolds.set(midi, count);
      refreshGlow(midi, 0);
    }
  }

  function fallSpan() {
    return Math.max(120, hitY);
  }

  function yAt(time, songTime) {
    return hitY - ((time - songTime) / lookAhead) * fallSpan();
  }

  function noteBox(midi) {
    const key = layout?.byMidi[clamp(midi, 21, 108)];
    if (!key) return null;
    const w = Math.max(4, key.black ? key.w * 0.84 : key.w * 0.68);
    return { x: key.x + (key.w - w) / 2, w, key };
  }

  function drawCover(target, image, w, h) {
    const ratio = image.width / image.height;
    const canvasRatio = w / h;
    let dw;
    let dh;
    let dx;
    let dy;
    if (ratio > canvasRatio) {
      dh = h;
      dw = h * ratio;
      dx = (w - dw) / 2;
      dy = 0;
    } else {
      dw = w;
      dh = w / ratio;
      dx = 0;
      dy = (h - dh) / 2;
    }
    target.drawImage(image, dx, dy, dw, dh);
  }

  function backgroundSource() {
    if (!bgImage) return null;
    const key = `${width}x${height}:${blur}`;
    if (bgCache && bgKey === key) return bgCache;
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(width));
    off.height = Math.max(1, Math.round(height));
    const g = off.getContext('2d');
    if (blur > 0) g.filter = `blur(${blur}px)`;
    drawCover(g, bgImage, off.width, off.height);
    bgCache = off;
    bgKey = key;
    return off;
  }

  function backdrop() {
    if (wash && wash.w === width && wash.h === height && wash.theme === theme.id) return wash;
    const plate = document.createElement('canvas');
    plate.width = Math.max(1, Math.round(width * dpr));
    plate.height = Math.max(1, Math.round(height * dpr));
    const g = plate.getContext('2d');
    const base = g.createLinearGradient(0, 0, 0, plate.height);
    base.addColorStop(0, theme.bg[0]);
    base.addColorStop(0.55, theme.bg[1]);
    base.addColorStop(1, theme.bg[2]);
    g.fillStyle = base;
    g.fillRect(0, 0, plate.width, plate.height);
    plate.w = width;
    plate.h = height;
    plate.theme = theme.id;
    wash = plate;
    return plate;
  }

  function orbSprite(color) {
    const cached = orbSprites.get(color);
    if (cached) return cached;
    const size = 256;
    const plate = document.createElement('canvas');
    plate.width = plate.height = size;
    const g = plate.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, rgba(color, 0.85));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    orbSprites.set(color, plate);
    return plate;
  }

  function drawStars(now) {
    for (const star of stars) {
      const alpha = 0.25 + Math.sin(now * star.s + star.p) * 0.2;
      ctx.fillStyle = `rgba(230,245,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * hitY, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawOrbs(target, now, pulse) {
    const orbs = [
      [0.25, 0.3, theme.accent],
      [0.75, 0.42, theme.accent2],
      [0.5, 0.7, theme.palette[4]]
    ];
    target.save();
    target.globalCompositeOperation = 'lighter';
    const span = Math.max(width, height) * (pulse ? 0.56 + energy * 0.1 : 0.5);
    orbs.forEach((orb, index) => {
      const driftX = pulse ? Math.sin(now * 0.08 + index) * 0.06 : 0;
      const driftY = pulse ? Math.cos(now * 0.06 + index) * 0.04 : 0;
      const x = width * (orb[0] + driftX);
      const y = height * (orb[1] + driftY);
      target.globalAlpha = pulse ? 0.2 + energy * 0.08 : 0.16;
      target.drawImage(orbSprite(orb[2]), x - span / 2, y - span / 2, span, span);
    });
    target.restore();
  }

  function drawVignette(target) {
    if (!vignette) {
      vignette = document.createElement('canvas');
      vignette.width = Math.max(1, Math.round(width));
      vignette.height = Math.max(1, Math.round(height));
      const g = vignette.getContext('2d');
      const grad = g.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height * 0.45, height * 0.78);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.62)');
      g.fillStyle = grad;
      g.fillRect(0, 0, width, height);
    }
    target.drawImage(vignette, 0, 0, width, height);
  }

  function stillBackground() {
    if (stillBg && stillBg.w === width && stillBg.h === height && stillBg.theme === theme.id && stillBg.dpr === dpr) return stillBg;
    const plate = document.createElement('canvas');
    plate.width = Math.max(1, Math.round(width * dpr));
    plate.height = Math.max(1, Math.round(height * dpr));
    const g = plate.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(backdrop(), 0, 0, width, height);
    drawOrbs(g, 0, false);
    drawVignette(g);
    plate.w = width;
    plate.h = height;
    plate.theme = theme.id;
    plate.dpr = dpr;
    stillBg = plate;
    return plate;
  }

  function drawBackground(now) {
    if (!bgImage && !bgPulse) {
      ctx.drawImage(stillBackground(), 0, 0, width, height);
      drawStars(now);
      return;
    }
    if (!bgImage) {
      ctx.drawImage(backdrop(), 0, 0, width, height);
      drawOrbs(ctx, now, true);
      drawStars(now);
    } else {
      const source = backgroundSource();
      if (source) ctx.drawImage(source, 0, 0, width, height);
      ctx.fillStyle = `rgba(0,0,0,${darkness})`;
      ctx.fillRect(0, 0, width, height);
    }
    drawVignette(ctx);
  }

  function drawGrid(songTime, now) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, hitY);
    ctx.clip();
    if (showGrid && layout) {
      ctx.globalAlpha = theme.grid * (bgImage ? 0.22 : 0.4);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const key of layout.whites) {
        ctx.moveTo(key.x, 0);
        ctx.lineTo(key.x, hitY);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (showGrid && songRef && mode !== 'free' && songRef.grid) {
      for (const beat of songRef.grid) {
        const y = yAt(beat.t, songTime);
        if (y < -8 || y > hitY) continue;
        ctx.strokeStyle = beat.down ? rgba(theme.accent, bgImage ? 0.28 : 0.4) : 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else if (showGrid) {
      const spacing = 70;
      const travel = fallSpan();
      const shift = ((now * (travel / lookAhead) * 0.25) % spacing + spacing) % spacing;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      for (let y = hitY - shift; y > 0; y -= spacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }
    if (theme.scan > 0) {
      const y = ((now * 42) % (hitY + 80)) - 40;
      const grad = ctx.createLinearGradient(0, y - 26, 0, y + 26);
      grad.addColorStop(0, rgba(theme.accent, 0));
      grad.addColorStop(0.5, rgba(theme.accent, theme.scan));
      grad.addColorStop(1, rgba(theme.accent, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 26, width, 52);
    }
    ctx.restore();
  }

  function drawBar(x, y, w, h, _midi, velocity, alpha = 1) {
    if (h < 2 || w < 2) return;
    const color = noteColor('flow', _midi);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(color, 0.28);
    ctx.fillRect(x - 3, y, w + 6, h);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.92;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x + w / 2 - 0.5, y, 1, h);
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = alpha * (0.85 + velocity / 500);
    ctx.fillRect(x, y + h - 3, w, 3);
    ctx.restore();
  }

  function drawFalling(songTime) {
    const notes = songRef.notes;
    let index = lowerBound(notes, songTime - 30);
    for (; index < notes.length; index++) {
      const note = notes[index];
      if (note.start > songTime + lookAhead) break;
      if (note.judged === 'perfect' || note.judged === 'great' || note.judged === 'good') continue;
      if (note.end < songTime - 0.4) continue;
      const box = noteBox(note.midi);
      if (!box) continue;
      let top = yAt(note.end, songTime);
      let bottom = yAt(note.start, songTime);
      let alpha = 1;
      if (songTime >= note.start && note.judged !== 'miss') bottom = hitY;
      if (note.judged === 'miss') {
        alpha = 1 - (songTime - note.start - HIT_LATE) / 0.4;
        if (alpha <= 0) continue;
        bottom = Math.min(bottom, hitY + 10);
      }
      if (bottom <= 0 || top >= hitY) continue;
      drawBar(box.x, top, box.w, bottom - top, note.midi, note.velocity, alpha);
    }
  }

  function drawRising(now) {
    const travel = fallSpan();
    const px = travel / lookAhead;
    for (const note of liveNotes) {
      const end = note.end ?? now;
      const age = now - end;
      if (note.end != null && age > lookAhead) continue;
      const box = noteBox(note.midi);
      if (!box) continue;
      const dur = Math.max(0.03, end - note.start);
      const bottom = note.end == null ? hitY : hitY - age * px;
      const top = bottom - dur * px;
      if (bottom < 0) continue;
      drawBar(box.x, top, box.w, bottom - top, note.midi, note.vel, 1);
    }
  }

  function drawHitLine(now) {
    const pulse = 0.28 + energy * 0.45 + Math.sin(now * 3) * 0.04;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = combo >= 20 ? '#ffe566' : '#ffffff';
    ctx.shadowBlur = 6 + energy * 8;
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    ctx.fillRect(0, hitY, width, 1);
    ctx.restore();
    if (sustain) {
      ctx.fillStyle = rgba(theme.accent2, 0.16);
      ctx.fillRect(0, hitY - 16, width, 14);
    }
  }

  function drawHud(songTime, playing, now) {
    if (clean) {
      if (songRef && songRef.duration > 0) {
        ctx.fillStyle = rgba(theme.accent, 0.85);
        ctx.fillRect(0, 0, width * clamp(songTime / songRef.duration, 0, 1), 3);
      }
      return;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (songRef || playing) {
      if (!playing) {
        ctx.font = '600 22px "Noto Sans SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(songRef?.title || '自由演奏', width / 2, 36);
      }
      if (songRef) {
        ctx.font = '600 16px Oxanium, "Segoe UI", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.74)';
        ctx.fillText(`${formatTime(songTime)}  /  ${formatTime(songRef.duration)}`, width - 22, 36);
        ctx.textAlign = 'center';
      }
      if (mode === 'rhythm' && songRef) {
        ctx.font = '700 18px Oxanium, sans-serif';
        ctx.fillStyle = theme.accent;
        ctx.fillText(`${accuracy().toFixed(2)}%`, width / 2, 66);
      }
      if (mode === 'rhythm' && songRef && !playing && !result) {
        ctx.font = '16px "Noto Sans SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.62)';
        ctx.fillText('音游模式：跟着下落的音符弹奏', width / 2, hitY * 0.2);
      }
    }

    if (mode === 'rhythm' && combo >= 2 && !result) {
      ctx.save();
      ctx.translate(width / 2, hitY * 0.58);
      ctx.scale(comboScale, comboScale);
      ctx.textAlign = 'center';
      ctx.font = '800 68px Oxanium, sans-serif';
      ctx.fillStyle = combo >= 20 ? '#ffe566' : '#ffffff';
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = 16;
      ctx.fillText(String(combo), 0, 0);
      ctx.shadowBlur = 0;
      ctx.font = '700 15px Oxanium, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText('COMBO', 0, 38);
      ctx.restore();
    }

    if (judge && judge.life > 0) {
      const progress = 1 - judge.life / judge.max;
      const alpha = progress < 0.12 ? progress / 0.12 : Math.max(0, 1 - (progress - 0.12) / 0.88);
      const scale = 1.24 - 0.24 * Math.min(1, progress * 4);
      ctx.save();
      ctx.translate(width / 2, hitY * 0.45);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.font = '800 40px Oxanium, sans-serif';
      ctx.fillStyle = judge.color;
      ctx.fillText(judge.text, 0, 0);
      ctx.restore();
    }

    if (result) drawResult();

    if (songRef && songRef.duration > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, 0, width, 3);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(0, 0, width * clamp(songTime / songRef.duration, 0, 1), 3);
    }
  }

  function drawResult() {
    const alpha = Math.min(1, result.age * 2.2);
    const cardW = Math.min(480, width * 0.72);
    const cardH = result.kind === 'rhythm' ? 246 : 132;
    const x = (width - cardW) / 2;
    const y = hitY * 0.26;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(6,8,16,0.78)';
    if (roundRect(ctx, x, y, cardW, cardH, 18)) {
      ctx.fill();
      ctx.strokeStyle = rgba(theme.accent, 0.45);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 28px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(result.kind === 'rhythm' ? '判定完成' : '演奏完成', width / 2, y + 46);
    if (result.kind === 'rhythm') {
      ctx.font = '800 44px Oxanium, sans-serif';
      ctx.fillStyle = theme.accent;
      ctx.fillText(`${accuracy().toFixed(2)}%`, width / 2, y + 104);
      ctx.font = '16px "Noto Sans SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.84)';
      ctx.fillText(`分数 ${score}    最高连击 ${maxCombo}`, width / 2, y + 148);
      ctx.fillText(`PERFECT ${counts.perfect}   GREAT ${counts.great}   GOOD ${counts.good}   MISS ${counts.miss}`, width / 2, y + 184);
    } else if (songRef) {
      ctx.font = '18px "Noto Sans SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(songRef.title, width / 2, y + 92);
    }
    ctx.restore();
  }

  function attract(dt) {
    if (particleLevel > 0 && Math.random() < dt * 0.45) {
      const key = layout.whites[(Math.random() * layout.whites.length) | 0];
      particles.puff({
        x: key.x + key.w / 2,
        y: hitY,
        hex: noteColor('smoke', key.midi),
        vel: 64
      });
    }
  }

  function stepAndDraw(dt, now, songTime, playing) {
    if (!layout) resize();
    energy *= Math.exp(-dt * 1.45);
    comboScale += (1 - comboScale) * Math.min(1, dt * 8);
    if (judge) {
      judge.life -= dt;
      if (judge.life <= 0) judge = null;
    }
    if (result) result.age += dt;

    processReleases(songTime);

    if (playing && songRef && mode === 'auto') {
      const notes = songRef.notes;
      while (fxCursor < notes.length && notes[fxCursor].start <= songTime + 0.012) {
        const note = notes[fxCursor++];
        if (note.judged === 'skip') continue;
        if (songTime - note.start > 0.1) continue;
        chartDown(note, true);
      }
    }
    if (playing && songRef && mode === 'rhythm') {
      const notes = songRef.notes;
      while (missCursor < notes.length && notes[missCursor].start + HIT_LATE < songTime) {
        const note = notes[missCursor++];
        if (note.judged) continue;
        registerJudge(note, 'miss');
      }
    }

    if (liveNotes.length > 80) {
      liveNotes = liveNotes.filter((note) => note.end == null || now - note.end < lookAhead + 0.6);
    }
    if (particleLevel > 0 && Math.random() < dt * (bgImage ? 2.5 : 6)) {
      particles.ambient(Math.random() * width, Math.random() * hitY * 0.75, (Math.random() * 12) | 0);
    }
    if (particleLevel > 0 && layout) {
      const rate = dt * 6 * particleMul();
      const seed = (midi, vel) => {
        if (Math.random() > rate) return;
        const key = layout.byMidi[clamp(midi, 21, 108)];
        if (!key) return;
        particles.puff({
          x: key.x + key.w / 2 + (Math.random() - 0.5) * key.w * 0.3,
          y: hitY,
          hex: noteColor('smoke', midi),
          vel
        });
      };
      for (const [midi, vel] of liveHolds) seed(midi, vel || 80);
      for (const [midi, count] of chartHolds) {
        if (count > 0 && !liveHolds.has(midi)) seed(midi, 76);
      }
    }
    particles.update(dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    drawBackground(now);
    drawGrid(songTime, now);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, hitY);
    ctx.clip();
    if (songRef && mode !== 'free') drawFalling(songTime);
    else drawRising(now);
    if (!songRef && liveHolds.size === 0 && glow.size === 0) attract(dt);
    particles.draw(ctx);
    ctx.restore();
    drawKeyboard(ctx, {
      layout,
      keyTop: hitY,
      keyH,
      width,
      height,
      theme,
      glow,
      showLabels,
      energy,
      hover
    });
    drawHitLine(now);
    drawHud(songTime, playing, now);
  }

  function frame(ts) {
    if (suspended) return;
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
    last = ts;
    stepAndDraw(dt, getNow(), getSongTime(), getPlaying());
    if (suspended) return;
    afterPaint?.();
    onFrameCb?.(dt);
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      resize();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    resize,
    beginCapture() {
      pixelBudget = 1920 * 1080;
      recording = false;
      resize();
      recording = true;
    },
    beginExport() {
      recording = false;
      dpr = 1;
      canvas.width = 1920;
      canvas.height = 1080;
      layoutFrame(1920, 1080);
      recording = true;
    },
    setBgPulse(value) {
      bgPulse = !!value;
      stillBg = null;
    },
    suspend() {
      suspended = true;
      cancelAnimationFrame(raf);
      raf = 0;
    },
    resume() {
      if (!suspended && raf) return;
      suspended = false;
      last = 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    prepareExport(song) {
      this.beginRun(song, 0);
      energy = 0;
      judge = null;
    },
    paintExport(songTime, dt, now) {
      stepAndDraw(dt, now, songTime, true);
    },
    endCapture() {
      if (!recording && pixelBudget === 2560 * 1440) return;
      recording = false;
      pixelBudget = 2560 * 1440;
      resize();
    },
    setTheme(id) {
      theme = getTheme(id);
      wash = null;
      stillBg = null;
      particles.setPalette(smokeColors.length ? smokeColors : [theme.accent]);
      document.documentElement.dataset.theme = theme.id;
    },
    setFlowColors(colors) {
      flowColors = colors;
    },
    setSmokeColors(colors) {
      smokeColors = colors;
      particles.setPalette(colors.length ? colors : [theme.accent]);
    },
    setBackground(image) {
      bgImage = image;
      bgKey = '';
    },
    clearBackground() {
      bgImage = null;
      bgCache = null;
    },
    setMode(next) {
      mode = next;
    },
    setLookAhead(value) {
      lookAhead = clamp(value, 1.15, 8);
    },
    setParticleLevel(level) {
      particleLevel = clamp(level | 0, 0, 3);
    },
    setDarkness(value) {
      darkness = clamp(value, 0, 0.85);
    },
    setBlur(value) {
      blur = clamp(value, 0, 18);
      bgKey = '';
    },
    setClean(value) {
      clean = !!value;
    },
    setShowLabels(value) {
      showLabels = !!value;
    },
    setShowGrid(value) {
      showGrid = !!value;
    },
    setKeyLift(value) {
      keyLift = clamp(value, 0, 180);
      resize();
    },
    setSong(song) {
      songRef = song;
    },
    setSustain(value) {
      sustain = !!value;
    },
    setHovered(midi) {
      hover = midi;
    },
    setPlayingGetter(fn) {
      getPlaying = fn;
    },
    setTimeGetter(fn) {
      getSongTime = fn;
    },
    setNowGetter(fn) {
      getNow = fn;
    },
    onFrame(fn) {
      onFrameCb = fn;
    },
    setAfterPaint(fn) {
      afterPaint = fn;
    },
    hitTest(x, y) {
      return hitTest(layout, x, y, hitY, keyH);
    },
    beginRun(song, time) {
      songRef = song;
      chartHolds.clear();
      releases.length = 0;
      particles.clear();
      for (const midi of [...glow.keys()]) {
        if (!liveHolds.has(midi)) glow.delete(midi);
      }
      result = null;
      score = 0;
      combo = 0;
      maxCombo = 0;
      counts = { perfect: 0, great: 0, good: 0, miss: 0 };
      if (!song) {
        fxCursor = 0;
        missCursor = 0;
        return;
      }
      for (const note of song.notes) {
        note.judged = note.start < time - HIT_LATE ? 'skip' : undefined;
      }
      fxCursor = 0;
      while (fxCursor < song.notes.length && song.notes[fxCursor].start < time - 0.03) fxCursor++;
      missCursor = 0;
      while (missCursor < song.notes.length && song.notes[missCursor].judged === 'skip') missCursor++;
      if (mode === 'auto' && time > 0.08) {
        for (const note of song.notes) {
          if (note.start < time - 0.03 && note.end > time) chartDown(note, false);
        }
      }
    },
    liveDown(midi, velocity) {
      liveHolds.set(midi, velocity);
      refreshGlow(midi, velocity);
      const now = getNow();
      for (let i = liveNotes.length - 1; i >= 0; i--) {
        if (liveNotes[i].midi === midi && liveNotes[i].end == null) liveNotes[i].end = now;
      }
      liveNotes.push({ midi, vel: velocity, start: now, end: null });
      if (mode === 'free') burstAt(midi, velocity, velocity > 110);
      else if (mode === 'auto') burstAt(midi, velocity * 0.7, false);
      energy = Math.min(1, energy + 0.12 + velocity / 700);
    },
    liveUp(midi) {
      liveHolds.delete(midi);
      refreshGlow(midi, 0);
      const now = getNow();
      for (let i = liveNotes.length - 1; i >= 0; i--) {
        if (liveNotes[i].midi === midi && liveNotes[i].end == null) {
          liveNotes[i].end = now;
          break;
        }
      }
    },
    tryHit(midi, time) {
      if (mode !== 'rhythm' || !songRef || !getPlaying()) return false;
      const notes = songRef.notes;
      let best = null;
      let bestDt = Infinity;
      for (let i = missCursor; i < notes.length; i++) {
        const note = notes[i];
        if (note.start - time > HIT_EARLY) break;
        if (note.judged || note.midi !== midi) continue;
        const dt = Math.abs(note.start - time);
        const window = note.start >= time ? HIT_EARLY : HIT_LATE;
        if (dt <= window && dt < bestDt) {
          best = note;
          bestDt = dt;
        }
      }
      if (!best) {
        const key = layout?.byMidi[clamp(midi, 21, 108)];
        if (key) particles.miss({ x: key.x + key.w / 2, y: hitY });
        return false;
      }
      const kind = bestDt <= PERFECT ? 'perfect' : bestDt <= GREAT ? 'great' : 'good';
      registerJudge(best, kind);
      return true;
    },
    showResult(kind) {
      result = { kind, age: 0 };
    }
  };
}
