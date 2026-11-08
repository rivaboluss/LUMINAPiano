import { rgba } from '../util.js';

const LEVEL = [0.42, 0.78, 1.15, 1.8];
const CAP = 2800;

function makeSprite(hex, hot) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const radius = size / 2;
  const glow = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  if (hot) {
    glow.addColorStop(0, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.16, rgba(hex, 0.9));
    glow.addColorStop(0.42, rgba(hex, 0.28));
    glow.addColorStop(1, rgba(hex, 0));
  } else {
    glow.addColorStop(0, rgba(hex, 0.88));
    glow.addColorStop(0.3, rgba(hex, 0.42));
    glow.addColorStop(0.66, rgba(hex, 0.12));
    glow.addColorStop(1, rgba(hex, 0));
  }
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function fadeOf(alpha) {
  const age = 1 - alpha;
  const appear = Math.min(1, age / 0.08);
  return appear * Math.pow(alpha, 1.45);
}

export function createParticles() {
  let palette = ['#ffffff'];
  const sprites = new Map();
  const alive = [];
  const pool = [];

  function setPalette(colors) {
    palette = colors.length ? colors : ['#ffffff'];
  }

  function spriteFor(hex, hot) {
    const key = `${hot ? 'h' : 's'}${hex}`;
    let sprite = sprites.get(key);
    if (sprite) return sprite;
    if (sprites.size > 48) sprites.clear();
    sprite = makeSprite(hex, hot);
    sprites.set(key, sprite);
    return sprite;
  }

  function spawn(data) {
    if (alive.length >= CAP) return;
    const particle = pool.pop() || {};
    particle.hex = undefined;
    particle.spin = 0;
    particle.phase = 0;
    particle.grow = 0;
    particle.jitter = 0;
    particle.dim = 1;
    particle.ox = data.x;
    particle.oy = data.y;
    Object.assign(particle, data);
    particle.max = data.life;
    alive.push(particle);
  }

  function emit({ x, y, hex, velocity = 0.6, scale = 1, flash = false }) {
    const color = hex || palette[0] || '#ffffff';
    const wisps = Math.max(2, Math.round((4 + velocity * 3) * scale));
    for (let i = 0; i < wisps; i++) {
      const lean = (Math.random() - 0.5) * 1.8;
      const speed = 14 + Math.random() * 24;
      spawn({
        type: 'ink',
        x: x + (Math.random() - 0.5) * 54,
        y: y - Math.random() * 16,
        vx: Math.sin(lean) * speed * 0.55,
        vy: -speed * (0.1 + Math.random() * 0.16),
        life: 0.62 + Math.random() * 0.4,
        hex: color,
        size: 18 + Math.random() * 16,
        grow: 36 + Math.random() * 24,
        jitter: 110 + Math.random() * 80,
        spin: (Math.random() < 0.5 ? -1 : 1) * (6.5 + Math.random() * 4),
        phase: Math.random() * Math.PI * 2
      });
    }
    const motes = Math.max(3, Math.round((7 + velocity * 6) * scale));
    for (let i = 0; i < motes; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.05;
      const speed = 90 + Math.random() * 130 * (0.75 + velocity * 0.4);
      spawn({
        type: 'mote',
        x: x + (Math.random() - 0.5) * 28,
        y: y - Math.random() * 6,
        vx: Math.cos(angle) * speed * 0.42,
        vy: Math.sin(angle) * speed,
        life: 0.68 + Math.random() * 0.42,
        hex: color,
        size: 1.6 + Math.random() * 1.8,
        jitter: 90 + Math.random() * 70,
        spin: (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 5),
        phase: Math.random() * Math.PI * 2
      });
    }
    if (flash) {
      spawn({
        type: 'flash',
        x,
        y: y - 2,
        vx: 0,
        vy: -12,
        life: 0.16,
        hex: color,
        size: 10 + velocity * 6
      });
    }
  }

  function burst({ x, y, ci = 0, vel = 80, level = 1, big = false, hex }) {
    const velocity = Math.max(0.25, Math.min(1, vel / 127));
    emit({
      x,
      y,
      hex: hex || palette[ci % palette.length],
      velocity,
      scale: level * (big ? 1.28 : 1),
      flash: true
    });
  }

  function puff({ x, y, hex, vel = 70 }) {
    const velocity = Math.max(0.25, Math.min(1, vel / 127));
    emit({ x, y, hex, velocity, scale: 0.58, flash: false });
  }

  function miss({ x, y }) {
    for (let i = 0; i < 10; i++) {
      spawn({
        type: 'spark',
        x,
        y,
        vx: (Math.random() - 0.5) * 220,
        vy: 30 + Math.random() * 220,
        life: 0.22 + Math.random() * 0.22,
        hex: '#ff5d7a',
        size: 1.3
      });
    }
  }

  function ambient(x, y, ci) {
    const hex = palette[ci % palette.length] || palette[0];
    if (Math.random() < 0.62) {
      spawn({
        type: 'mote',
        x,
        y,
        vx: (Math.random() - 0.5) * 18,
        vy: -8 - Math.random() * 14,
        life: 0.7 + Math.random() * 0.5,
        hex,
        size: 1.1 + Math.random() * 0.8,
        jitter: 36,
        spin: (Math.random() < 0.5 ? -1 : 1) * 3,
        phase: Math.random() * Math.PI * 2,
        dim: 0.45
      });
      return;
    }
    spawn({
      type: 'ink',
      x,
      y,
      vx: (Math.random() - 0.5) * 8,
      vy: -6 - Math.random() * 10,
      life: 0.7 + Math.random() * 0.45,
      hex,
      size: 12 + Math.random() * 10,
      grow: 16,
      jitter: 48,
      spin: (Math.random() < 0.5 ? -1 : 1) * 2.4,
      phase: Math.random() * Math.PI * 2,
      dim: 0.4
    });
  }

  function drift(particle, dt, curl, rise, drag) {
    particle.phase += dt * (particle.spin || 3);
    particle.vx += Math.cos(particle.phase) * curl * dt;
    particle.vy += Math.sin(particle.phase * 1.37) * curl * 0.72 * dt;
    const kick = particle.jitter || 40;
    particle.vx += (Math.random() - 0.5) * kick * dt;
    particle.vy += (Math.random() - 0.5) * kick * dt;
    particle.vy -= rise * dt;
    const pull = particle.type === 'ink' ? 0.08 : 0.04;
    const lift = particle.type === 'ink' ? 6 : 78;
    particle.vx -= (particle.x - particle.ox) * pull * dt;
    particle.vy -= (particle.y - (particle.oy - lift)) * pull * dt;
    const damp = Math.exp(-dt * drag);
    particle.vx *= damp;
    particle.vy *= damp;
    particle.oy -= (particle.type === 'ink' ? 4 : 34) * dt;
  }

  function update(dt) {
    for (let i = alive.length - 1; i >= 0; i--) {
      const particle = alive[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        pool.push(particle);
        alive[i] = alive[alive.length - 1];
        alive.pop();
        continue;
      }
      if (particle.type === 'spark') {
        particle.vy += 360 * dt;
        particle.vx *= Math.exp(-dt * 1.3);
      } else if (particle.type === 'ink') {
        drift(particle, dt, 120, 6, 1.05);
        particle.size = Math.min(46, particle.size + (particle.grow || 0) * dt);
      } else if (particle.type === 'mote') {
        drift(particle, dt, 55, 70, 0.32);
      } else if (particle.type === 'flash') {
        particle.size += 70 * dt;
        particle.y += particle.vy * dt;
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
  }

  function colorOf(particle) {
    return particle.hex || palette[0] || '#ffffff';
  }

  function draw(ctx) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const particle of alive) {
      if (particle.type === 'mote') continue;
      const alpha = Math.max(0, particle.life / particle.max);
      const fade = fadeOf(alpha) * (particle.dim || 1);
      if (fade <= 0.01) continue;
      const color = colorOf(particle);
      if (particle.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, alpha * 1.35);
        ctx.strokeStyle = color;
        ctx.lineWidth = particle.size;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x - particle.vx * 0.028, particle.y - particle.vy * 0.028);
        ctx.stroke();
      } else if (particle.type === 'ink') {
        const sprite = spriteFor(color, false);
        const size = particle.size * (0.85 + (1 - alpha) * 0.3);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.min(0.32, fade * 0.38);
        ctx.drawImage(sprite, particle.x - size, particle.y - size, size * 2, size * 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.2, fade * 0.24);
        const glow = size * 0.7;
        ctx.drawImage(sprite, particle.x - glow, particle.y - glow, glow * 2, glow * 2);
      } else if (particle.type === 'flash') {
        const sprite = spriteFor(color, false);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.28, fade * 0.32);
        const size = particle.size;
        ctx.drawImage(sprite, particle.x - size, particle.y - size, size * 2, size * 2);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of alive) {
      if (particle.type !== 'mote') continue;
      const alpha = Math.max(0, particle.life / particle.max);
      const fade = fadeOf(alpha) * (particle.dim || 1);
      if (fade <= 0.01) continue;
      const color = colorOf(particle);
      const sprite = spriteFor(color, true);
      const core = Math.max(1.7, particle.size * 0.85);
      const halo = core * 2.2;
      ctx.globalAlpha = Math.min(1, fade);
      ctx.drawImage(sprite, particle.x - halo, particle.y - halo, halo * 2, halo * 2);
      ctx.globalAlpha = Math.min(1, fade * 1.15);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, core, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, core * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    setPalette,
    burst,
    puff,
    miss,
    ambient,
    update,
    draw,
    count: () => alive.length,
    multiplier: (level) => LEVEL[level] ?? 1
  };
}
