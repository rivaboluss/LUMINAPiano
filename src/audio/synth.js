function stiffness(midi) {
  const x = (midi - 21) / 87;
  return 0.00008 + 0.0005 * x * x + (midi < 34 ? 0.00022 : 0);
}

function partialHz(freq, n, bend) {
  return freq * n * Math.sqrt(1 + bend * n * n);
}

function ringTime(midi, n) {
  const base = midi < 38 ? 5.2 : midi < 52 ? 3.6 : midi < 68 ? 2.5 : midi < 84 ? 1.28 : 0.58;
  return base / (1 + (n - 1) * 0.78);
}

function damperTime(midi) {
  if (midi < 40) return 0.26;
  if (midi < 58) return 0.15;
  if (midi < 78) return 0.085;
  return 0.048;
}

function makeHall(ctx) {
  const rate = ctx.sampleRate;
  const seconds = 3.15;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  const taps = [0.013, 0.019, 0.028, 0.037, 0.049, 0.063, 0.081, 0.104];
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let low = 0;
    const tone = 0.055 + channel * 0.012;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const white = Math.random() * 2 - 1;
      low += tone * (white - low);
      data[i] = low * Math.exp(-1.45 * t);
    }
    let peak = 0.0001;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const scale = 0.5 / peak;
    for (let i = 0; i < length; i++) data[i] *= scale;
    taps.forEach((tap, index) => {
      const center = Math.floor((tap + channel * 0.0018) * rate);
      const amp = (index % 2 ? 0.42 : -0.36) * Math.pow(0.8, index);
      const width = 10;
      for (let k = -width; k <= width; k++) {
        const at = center + k;
        if (at < 0 || at >= length) continue;
        const window = 0.5 + 0.5 * Math.cos((k / width) * Math.PI);
        data[at] += amp * window;
      }
    });
  }
  return impulse;
}

export function createSynth(ctx) {
  const input = ctx.createGain();
  const body = ctx.createBiquadFilter();
  const air = ctx.createBiquadFilter();
  const dry = ctx.createGain();
  const predelay = ctx.createDelay(0.1);
  const convolver = ctx.createConvolver();
  const wetHighpass = ctx.createBiquadFilter();
  const wetLowpass = ctx.createBiquadFilter();
  const wet = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  const master = ctx.createGain();

  body.type = 'peaking';
  body.frequency.value = 210;
  body.Q.value = 0.8;
  body.gain.value = 3.2;
  air.type = 'highshelf';
  air.frequency.value = 3400;
  air.gain.value = 1.4;
  dry.gain.value = 0.86;
  predelay.delayTime.value = 0.028;
  convolver.buffer = makeHall(ctx);
  wetHighpass.type = 'highpass';
  wetHighpass.frequency.value = 160;
  wetLowpass.type = 'lowpass';
  wetLowpass.frequency.value = 4600;
  wet.gain.value = 0.74;
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 2.4;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.28;
  master.gain.value = 0.78;

  input.connect(body);
  body.connect(air);
  air.connect(dry);
  air.connect(predelay);
  predelay.connect(convolver);
  convolver.connect(wetHighpass);
  wetHighpass.connect(wetLowpass);
  wetLowpass.connect(wet);
  dry.connect(compressor);
  wet.connect(compressor);
  compressor.connect(master);
  master.connect(ctx.destination);

  const rate = ctx.sampleRate;
  const noiseBuffer = ctx.createBuffer(1, rate, rate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

  const live = new Map();
  const scheduled = new Set();

  function releaseVoice(voice) {
    if (!voice || voice.dead) return;
    voice.dead = true;
    const time = ctx.currentTime;
    for (const gain of voice.gains) {
      const param = gain.gain;
      param.cancelScheduledValues(time);
      const current = Math.max(0.0001, param.value || 0.0001);
      param.setValueAtTime(current, time);
      param.setTargetAtTime(0.0001, time + 0.004, voice.damper);
    }
    const stopAt = time + voice.damper * 8 + 0.06;
    for (const node of voice.nodes) {
      try {
        node.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    live.delete(voice.midi);
    scheduled.delete(voice);
  }

  function spawn(midi, velocity, when, duration, gainScale) {
    const amount = Math.max(0.04, Math.min(1, (velocity / 127) * gainScale));
    if (amount <= 0) return null;
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const bend = stiffness(midi);
    const count = midi > 93 ? 3 : midi > 80 ? 4 : 5;
    const weights = [1, 0.56, 0.32, 0.18, 0.1];
    const bright = 0.58 + amount * 0.9;
    const raw = [];
    let sum = 0;
    for (let n = 1; n <= count; n++) {
      const weight = weights[n - 1] * Math.pow(bright, (n - 1) * 0.4);
      raw.push(weight);
      sum += weight;
    }
    const peak = 0.22 * Math.pow(amount, 1.12);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    const open = Math.min(9800, 1500 + amount * 4800 + midi * 24);
    const closed = Math.max(680, Math.min(open * 0.42, 2400 + midi * 10));
    lowpass.frequency.setValueAtTime(open, when);
    lowpass.frequency.exponentialRampToValueAtTime(closed, when + 0.42);
    lowpass.Q.value = 0.55;
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-0.6, Math.min(0.6, (midi - 64) / 48)), when);

    const oscs = [];
    const gains = [];
    const damper = damperTime(midi);
    const releaseAt = when + Math.max(0.05, duration);

    function addTone(hz, amp, partial) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(Math.max(20, hz), when);
      const gain = ctx.createGain();
      const level = Math.max(0.0002, amp);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(level, when + 0.004 + partial * 0.0008);
      gain.gain.setTargetAtTime(0.0001, when + 0.012, ringTime(midi, partial));
      gain.gain.setTargetAtTime(0.0001, releaseAt, damper);
      osc.connect(gain);
      gain.connect(lowpass);
      osc.start(when);
      oscs.push(osc);
      gains.push(gain);
    }

    for (let n = 1; n <= count; n++) {
      const share = raw[n - 1] / sum;
      addTone(partialHz(freq, n, bend), peak * share * (n === 1 ? 1.12 : 1), n);
    }
    if (midi > 33 && midi < 94) {
      const drift = 1.0015 + (midi - 60) * 0.000018;
      addTone(partialHz(freq, 1, bend) * drift, peak * (raw[0] / sum) * 0.36, 1);
    }
    if (midi < 46) {
      addTone(freq * 0.5, peak * 0.1, 4);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const hammer = ctx.createBiquadFilter();
    hammer.type = 'bandpass';
    hammer.frequency.value = 900 + midi * 28;
    hammer.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    const tick = Math.max(0.0002, peak * (0.22 + amount * 0.35));
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.exponentialRampToValueAtTime(tick, when + 0.003);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.032);
    noise.connect(hammer);
    hammer.connect(noiseGain);
    noiseGain.connect(lowpass);
    noise.start(when, Math.random() * 0.8);
    noise.stop(when + 0.04);

    lowpass.connect(panner);
    panner.connect(input);

    const stopAt = releaseAt + damper * 8 + 0.05;
    for (const osc of oscs) osc.stop(stopAt);

    return { midi, gains, nodes: [...oscs, noise], damper, end: stopAt, dead: false };
  }

  return {
    master,
    noteOn(midi, velocity) {
      try {
        const previous = live.get(midi);
        if (previous) releaseVoice(previous);
        const voice = spawn(midi, velocity, ctx.currentTime, 40, 1);
        if (voice) live.set(midi, voice);
      } catch (error) {
        console.warn(error);
      }
    },
    noteOff(midi) {
      const voice = live.get(midi);
      if (voice) releaseVoice(voice);
    },
    playScheduled(midi, velocity, when, duration, gainScale = 1) {
      try {
        const voice = spawn(midi, velocity, Math.max(when, ctx.currentTime), Math.max(0.05, duration), gainScale);
        if (!voice) return;
        scheduled.add(voice);
        const wait = Math.max(30, (voice.end - ctx.currentTime) * 1000 + 40);
        setTimeout(() => scheduled.delete(voice), wait);
      } catch (error) {
        console.warn(error);
      }
    },
    stopScheduled() {
      for (const voice of scheduled) releaseVoice(voice);
      scheduled.clear();
    },
    stopLive() {
      for (const voice of live.values()) releaseVoice(voice);
      live.clear();
    },
    stopAll() {
      this.stopScheduled();
      this.stopLive();
    }
  };
}
