import { createEngine } from './audio/engine.js';
import { createDemoSong } from './demo/song.js';
import { encodeSongVideo } from './export/encode.js';
import { createVideoCapture } from './export/video.js';
import { bindComputerKeyboard } from './input/keyboard.js';
import { openMidi } from './input/midi.js';
import { parseMidi } from './midi/parse.js';
import { encodeMidi } from './midi/write.js';
import { downloadBlob, formatTime, safeName } from './util.js';
import { createRenderer } from './visual/renderer.js';

const STORE = 'lumina-settings-v1';
const PRESET_COLORS = [
  '#3dfff2', '#4cc9f0', '#5b8cff', '#7b6cff',
  '#c77dff', '#f72585', '#ff5d8f', '#ff8a3d',
  '#ffe566', '#b6f25c', '#2ee6a6', '#ffffff'
];
const defaults = {
  theme: 'neon',
  particle: 2,
  flow: 78,
  volume: 82,
  speed: 100,
  guide: true,
  liveSound: true,
  darkness: 42,
  blur: 0,
  keyLift: 32,
  clean: false,
  labels: true,
  grid: true,
  bgPulse: false,
  exportFps: 60,
  exportAudio: true,
  flowColors: [],
  smokeColors: [],
  mode: 'free',
  loop: false,
  drums: false,
  octave: 0
};

const settings = { ...defaults, ...loadSettings() };
const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const engine = createEngine();
const renderer = createRenderer(canvas);
const capture = createVideoCapture(canvas, () => engine.tapAudio());
renderer.setAfterPaint(() => capture.requestFrame());

const els = {
  play: $('btn-play'),
  stop: $('btn-stop'),
  rec: $('btn-rec'),
  exportMidi: $('btn-export-midi'),
  songClear: $('btn-song-clear'),
  video: $('btn-video'),
  exportVideo: $('btn-export-video'),
  seek: $('seek'),
  time: $('time-label'),
  meta: $('song-meta'),
  midi: $('midi-select'),
  midiStatus: $('midi-status'),
  live: $('chk-live'),
  guide: $('chk-guide'),
  loop: $('chk-loop'),
  drums: $('chk-drums'),
  labels: $('chk-labels'),
  grid: $('chk-grid'),
  bgPulse: $('chk-bg-pulse'),
  exportFps: $('export-fps'),
  exportAudio: $('chk-export-audio'),
  clean: $('chk-clean'),
  speed: $('speed'),
  speedLabel: $('speed-label'),
  volume: $('volume'),
  volumeLabel: $('volume-label'),
  flow: $('flow'),
  flowLabel: $('flow-label'),
  dark: $('darkness'),
  darkLabel: $('dark-label'),
  blur: $('blur'),
  blurLabel: $('blur-label'),
  lift: $('lift'),
  liftLabel: $('lift-label'),
  theme: $('theme'),
  particle: $('particle'),
  flowSwatches: $('flow-swatches'),
  smokeSwatches: $('smoke-swatches'),
  flowTheme: $('flow-theme'),
  smokeTheme: $('smoke-theme'),
  octave: $('octave-label'),
  toast: $('toast'),
  badge: $('rec-badge'),
  modes: [...document.querySelectorAll('#mode-seg button')]
};

let midiAccess = null;
let selectedId = '*';
let liveTouched = false;
let autoMuted = false;
let lastBuffer = null;
let lastName = '';
let lastTake = null;
let seeking = false;
let videoMode = null;
let exportPhase = null;
let toastTimer = 0;
let frameAcc = 0;

renderer.setPlayingGetter(() => engine.isPlaying());
renderer.setTimeGetter(() => engine.getSongTime());
renderer.setNowGetter(() => engine.now());
renderer.onFrame((dt) => {
  frameAcc += dt;
  if (frameAcc < 0.1) return;
  frameAcc = 0;
  updateSeek();
});

engine.on('seek', (time) => {
  const song = engine.getSong();
  renderer.setSong(song);
  renderer.beginRun(song, time);
  updateSeek();
});
engine.on('state', () => sync());
engine.on('noteon', ({ midi, velocity }) => {
  renderer.liveDown(midi, velocity);
  if (settings.mode === 'rhythm') renderer.tryHit(midi, engine.getSongTime());
});
engine.on('noteoff', ({ midi }) => renderer.liveUp(midi));
engine.on('pedal', ({ down }) => renderer.setSustain(down));
engine.on('ended', () => {
  if (engine.getSong()) renderer.showResult(settings.mode === 'rhythm' ? 'rhythm' : 'done');
  sync();
});

applySettings();
bindControls();
renderer.start();
refreshMidi();
window.addEventListener('pointerdown', () => engine.resume());
window.addEventListener('resize', () => renderer.resize());

const typing = bindComputerKeyboard({
  initialOctave: settings.octave,
  onDown: (midi, velocity) => {
    if (exportPhase) return;
    engine.resume();
    engine.inputNoteOn(midi, velocity);
  },
  onUp: (midi) => {
    if (exportPhase) return;
    engine.inputNoteOff(midi);
  },
  onOctave: (label, octave) => {
    settings.octave = octave;
    els.octave.textContent = label;
    saveSettings();
  }
});

const params = new URLSearchParams(location.search);
if (params.has('demo')) {
  loadSong(createDemoSong(), '星澜');
  if (params.has('play')) engine.resume().then(() => engine.play());
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}');
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {
    /* ignore private mode */
  }
}

function sanitizeColors(value) {
  if (!Array.isArray(value)) return [];
  const colors = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const hex = item.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex) || colors.includes(hex)) continue;
    colors.push(hex);
    if (colors.length >= 8) break;
  }
  return colors;
}

function renderSwatches(kind) {
  const selected = kind === 'flow' ? settings.flowColors : settings.smokeColors;
  const box = kind === 'flow' ? els.flowSwatches : els.smokeSwatches;
  const button = kind === 'flow' ? els.flowTheme : els.smokeTheme;
  button.classList.toggle('on', selected.length === 0);
  const extras = selected.filter((hex) => !PRESET_COLORS.includes(hex));
  box.replaceChildren();
  for (const hex of [...PRESET_COLORS, ...extras]) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `swatch${selected.includes(hex) ? ' on' : ''}`;
    chip.style.setProperty('--c', hex);
    chip.title = hex;
    chip.setAttribute('aria-label', hex);
    chip.onclick = () => togglePaletteColor(kind, hex);
    box.appendChild(chip);
  }
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.className = 'color-custom';
  picker.value = selected.at(-1) || '#3dfff2';
  picker.title = '自定义颜色';
  picker.setAttribute('aria-label', kind === 'flow' ? '自定义瀑布流颜色' : '自定义烟雾颜色');
  picker.addEventListener('change', () => togglePaletteColor(kind, picker.value.toLowerCase(), true));
  box.appendChild(picker);
}

function togglePaletteColor(kind, hex, addOnly = false) {
  const key = kind === 'flow' ? 'flowColors' : 'smokeColors';
  const current = settings[key];
  let next;
  if (!addOnly && current.includes(hex)) next = current.filter((item) => item !== hex);
  else if (current.includes(hex)) next = current;
  else next = [...current, hex].slice(0, 8);
  settings[key] = next;
  if (kind === 'flow') renderer.setFlowColors(next);
  else renderer.setSmokeColors(next);
  renderSwatches(kind);
  saveSettings();
}

function clearPalette(kind) {
  const key = kind === 'flow' ? 'flowColors' : 'smokeColors';
  settings[key] = [];
  if (kind === 'flow') renderer.setFlowColors([]);
  else renderer.setSmokeColors([]);
  renderSwatches(kind);
  saveSettings();
}

function flowLookAhead(value) {
  return 7.4 - (Number(value) / 100) * 6;
}

function flowText(value) {
  if (value < 25) return '缓慢';
  if (value < 45) return '舒缓';
  if (value < 65) return '标准';
  if (value < 82) return '较快';
  return '极快';
}

function applySettings() {
  renderer.setTheme(settings.theme);
  renderer.setMode(settings.mode);
  renderer.setParticleLevel(settings.particle);
  renderer.setLookAhead(flowLookAhead(settings.flow));
  renderer.setDarkness(settings.darkness / 100);
  renderer.setBlur(settings.blur);
  renderer.setKeyLift(settings.keyLift ?? 32);
  renderer.setClean(settings.clean);
  renderer.setShowLabels(settings.labels);
  renderer.setShowGrid(settings.grid !== false);
  renderer.setBgPulse(settings.bgPulse === true);
  settings.exportFps = Number(settings.exportFps) === 30 ? 30 : 60;
  settings.exportAudio = settings.exportAudio !== false;
  settings.flowColors = sanitizeColors(settings.flowColors);
  settings.smokeColors = sanitizeColors(settings.smokeColors);
  renderer.setFlowColors(settings.flowColors);
  renderer.setSmokeColors(settings.smokeColors);
  renderSwatches('flow');
  renderSwatches('smoke');
  engine.setMode(settings.mode);
  engine.setGuide(settings.guide);
  engine.setLiveSound(settings.liveSound);
  engine.setLoop(settings.loop);
  engine.setVolume(settings.volume / 100);
  engine.setSpeed(settings.speed / 100);
  els.theme.value = settings.theme;
  els.particle.value = String(settings.particle);
  els.flow.value = settings.flow;
  els.flowLabel.textContent = flowText(settings.flow);
  els.dark.value = settings.darkness;
  els.darkLabel.textContent = `${settings.darkness}%`;
  els.blur.value = settings.blur;
  els.blurLabel.textContent = String(settings.blur);
  els.lift.value = settings.keyLift ?? 32;
  els.liftLabel.textContent = String(settings.keyLift ?? 32);
  els.volume.value = settings.volume;
  els.volumeLabel.textContent = `${settings.volume}%`;
  els.speed.value = settings.speed;
  els.speedLabel.textContent = `${(settings.speed / 100).toFixed(2)}×`;
  els.live.checked = settings.liveSound;
  els.guide.checked = settings.guide;
  els.loop.checked = settings.loop;
  els.drums.checked = settings.drums;
  els.labels.checked = settings.labels;
  els.grid.checked = settings.grid;
  els.bgPulse.checked = settings.bgPulse === true;
  els.exportFps.value = String(settings.exportFps);
  els.exportAudio.checked = settings.exportAudio;
  els.clean.checked = settings.clean;
  for (const button of els.modes) button.classList.toggle('active', button.dataset.mode === settings.mode);
}

function setMode(mode, reset = true) {
  settings.mode = mode;
  engine.setMode(mode);
  renderer.setMode(mode);
  if (mode === 'free' && engine.isPlaying()) engine.pause();
  for (const button of els.modes) button.classList.toggle('active', button.dataset.mode === mode);
  const song = engine.getSong();
  if (reset && song) renderer.beginRun(song, engine.getSongTime());
  saveSettings();
  sync();
}

function sync() {
  const song = engine.getSong();
  const playing = engine.isPlaying();
  const exporting = exportPhase != null;
  els.play.textContent = playing ? '暂停' : '播放';
  els.rec.textContent = engine.isRecording() ? '停止录音' : '录制演奏';
  els.rec.classList.toggle('primary', engine.isRecording());
  els.video.textContent = videoMode === 'manual' ? '停止并保存' : '录制画面';
  els.video.disabled = exporting;
  els.exportVideo.textContent = '导出整曲视频';
  els.exportVideo.disabled = videoMode != null || exporting;
  els.songClear.disabled = !song || exporting;
  $('welcome').hidden = !!song;
  els.exportFps.disabled = exporting;
  els.exportAudio.disabled = exporting;
  els.meta.textContent = song ? `${song.title} · ${song.bpm} BPM · ${song.notes.length} 音符` : '还没有曲目';
  els.badge.hidden = videoMode !== 'manual';
  els.badge.querySelector('span').textContent = 'REC';
  $('export-mask').hidden = !exporting;
  updateSeek();
}

function updateSeek() {
  const song = engine.getSong();
  if (!song) {
    els.seek.max = '1';
    els.seek.value = '0';
    els.time.textContent = '0:00 / 0:00';
    return;
  }
  els.seek.max = String(song.duration);
  if (!seeking) els.seek.value = String(engine.getSongTime());
  els.time.textContent = `${formatTime(engine.getSongTime())} / ${formatTime(song.duration)}`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3400);
}

function loadSong(song, filename) {
  if (filename && (!song.title || song.title === '未命名曲目')) {
    song.title = filename.replace(/\.(mid|midi)$/i, '');
  }
  engine.load(song);
  if (!song.notes.length) toast('没有可演奏的音符。如果这是打击乐，勾选包含打击乐后再试');
  else if (settings.mode === 'free') setMode('auto');
  else sync();
}

async function readBuffer(file) {
  return new Uint8Array(await file.arrayBuffer());
}

function clearSong() {
  if (exportPhase) return;
  lastBuffer = null;
  lastName = '';
  engine.stop();
  engine.load(null);
  if (settings.mode !== 'free') setMode('free');
  else sync();
}

async function importMidi(file) {
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) return toast('MIDI 文件太大');
  try {
    lastBuffer = await readBuffer(file);
    lastName = file.name;
    loadSong(parseMidi(lastBuffer, { includeDrums: settings.drums }), file.name);
    toast(`已导入 ${file.name}`);
  } catch (error) {
    toast(error.message || '无法解析这个 MIDI');
  }
}

async function importImage(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) return toast('图片太大');
  try {
    const bitmap = await createImageBitmap(file);
    renderer.setBackground(bitmap);
    toast('背景已换上');
  } catch {
    toast('这张图片打不开');
  }
}

async function refreshMidi() {
  try {
    midiAccess = await openMidi(onMidi, () => fillDevices());
    fillDevices();
  } catch (error) {
    const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError' || /permission|not granted|denied/i.test(error?.message || '');
    els.midiStatus.textContent = denied ? '未授予 MIDI 权限' : '无法连接设备';
    toast(denied
      ? '还不能连接电钢琴。请在浏览器地址栏允许 MIDI，并用 Chrome 或 Edge 打开。'
      : (error.message || '没有拿到 MIDI 权限'));
  }
}

function fillDevices() {
  const current = els.midi.value || selectedId || '*';
  els.midi.innerHTML = '';
  els.midi.add(new Option('全部设备', '*'));
  let count = 0;
  if (midiAccess) {
    for (const input of midiAccess.inputs.values()) {
      els.midi.add(new Option(input.name || 'MIDI 设备', input.id));
      count++;
    }
  }
  if ([...els.midi.options].some((option) => option.value === current)) els.midi.value = current;
  selectedId = els.midi.value || '*';
  if (!count) els.midiStatus.textContent = '没有检测到电钢琴';
}

function onMidi(message, input) {
  if (exportPhase) return;
  if (selectedId !== '*' && input?.id !== selectedId) return;
  if (!autoMuted && !liveTouched && settings.liveSound) {
    autoMuted = true;
    settings.liveSound = false;
    els.live.checked = false;
    engine.setLiveSound(false);
    saveSettings();
    toast('已检测到电钢琴，已关闭电脑发声，避免声音叠在一起');
  }
  if (message.type === 'on') engine.inputNoteOn(message.note, message.velocity);
  else if (message.type === 'off') engine.inputNoteOff(message.note);
  else engine.inputPedal(message.down);
  els.midiStatus.textContent = input?.name || '已连接';
}

async function togglePlay() {
  if (exportPhase) return;
  await engine.resume();
  const song = engine.getSong();
  if (!song) return toast('请先导入 MIDI，或播放演示曲');
  if (engine.isPlaying()) {
    engine.pause();
    sync();
    return;
  }
  if (settings.mode === 'free') setMode('auto');
  if (engine.getSongTime() >= song.duration - 0.05) engine.seek(0);
  engine.play();
  sync();
}

async function stopCapture() {
  const ext = capture.ext;
  const blob = await capture.stop();
  renderer.endCapture();
  const prefix = safeName(engine.getSong()?.title || 'live');
  videoMode = null;
  if (blob?.size) downloadBlob(blob, `Lumina-${prefix}.${ext}`);
  else toast('没有录到画面');
  sync();
}

async function toggleVideo() {
  if (exportPhase) return;
  if (capture.active) {
    await stopCapture();
    return;
  }
  try {
    await engine.resume();
    renderer.beginCapture();
    capture.start();
    videoMode = 'manual';
    toast('开始录制画面，再点一次即可保存');
    sync();
  } catch (error) {
    renderer.endCapture();
    toast(error.message || '无法开始录制');
  }
}

function beginExportScreen() {
  exportPhase = 'render';
  $('export-note').textContent = '正在直接渲染整曲，不用等它播完。请留在这个页面。完成后会自动弹出下载。';
  $('export-bar-fill').style.width = '0%';
  $('export-progress').textContent = '0%';
}

function showExportProgress(ratio, note, detail) {
  exportPhase = ratio >= 0.98 ? 'save' : 'render';
  if (note) $('export-note').textContent = note;
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  $('export-bar-fill').style.width = `${pct}%`;
  $('export-progress').textContent = detail || `${pct}%`;
}

async function exportSongVideo() {
  if (exportPhase) return;
  if (capture.active) return toast('请先停止当前录制');
  const song = engine.getSong();
  if (!song?.notes.length) return toast('请先导入曲目或播放演示曲');
  const prevMode = settings.mode;
  const prevLoop = engine.isLoop();
  let suspended = false;
  let capturing = false;
  try {
    engine.pause();
    engine.setLoop(false);
    if (prevMode !== 'auto') setMode('auto', false);
    engine.stop();
    beginExportScreen();
    videoMode = 'song';
    sync();
    renderer.suspend();
    suspended = true;
    renderer.beginExport();
    capturing = true;
    renderer.prepareExport(song);
    const blob = await encodeSongVideo({
      song,
      canvas,
      speed: settings.speed / 100,
      volume: settings.volume / 100,
      fps: settings.exportFps,
      audio: settings.exportAudio,
      paint: (songTime, dt, now) => renderer.paintExport(songTime, dt, now),
      onProgress: showExportProgress
    });
    showExportProgress(1, '渲染完成，正在保存。下载会自动弹出。', '100%');
    if (blob?.size) downloadBlob(blob, `Lumina-${safeName(song.title)}.mp4`);
    else toast('没有生成视频');
  } catch (error) {
    toast(error?.message || '导出失败');
  } finally {
    if (capturing) renderer.endCapture();
    renderer.beginRun(engine.getSong(), engine.getSongTime());
    if (suspended) renderer.resume();
    videoMode = null;
    exportPhase = null;
    engine.setLoop(prevLoop);
    if (prevMode !== settings.mode) setMode(prevMode);
    else sync();
  }
}

function bindPointer() {
  const pointers = new Map();
  const pos = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const velocityFrom = (y) => {
    const rect = canvas.getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (y - rect.height * 0.78) / (rect.height * 0.22)));
    return Math.round(52 + rel * 70);
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (exportPhase) return;
    if (event.button !== 0) return;
    engine.resume();
    const [x, y] = pos(event);
    const midi = renderer.hitTest(x, y);
    if (midi == null) return;
    pointers.set(event.pointerId, midi);
    canvas.setPointerCapture(event.pointerId);
    engine.inputNoteOn(midi, velocityFrom(y));
  });
  canvas.addEventListener('pointermove', (event) => {
    const [x, y] = pos(event);
    const midi = renderer.hitTest(x, y);
    renderer.setHovered(midi);
    if (!pointers.has(event.pointerId)) return;
    const prev = pointers.get(event.pointerId);
    if (midi === prev) return;
    if (prev != null) engine.inputNoteOff(prev);
    pointers.set(event.pointerId, midi);
    if (midi != null) engine.inputNoteOn(midi, velocityFrom(y));
  });
  const release = (event) => {
    const prev = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    renderer.setHovered(null);
    if (prev != null) engine.inputNoteOff(prev);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}

function bindKeys() {
  window.addEventListener('keydown', (event) => {
    if (exportPhase) {
      event.preventDefault();
      return;
    }
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.code === 'Space') {
      if (tag === 'BUTTON') return;
      event.preventDefault();
      togglePlay();
    } else if (event.code === 'Escape') {
      engine.stop();
      sync();
    } else if (event.code === 'Digit1') setMode('free');
    else if (event.code === 'Digit2') setMode('auto');
    else if (event.code === 'Digit3') setMode('rhythm');
    else if (event.code === 'KeyR' && !event.repeat) toggleRecord();
    else if (event.code === 'KeyV' && !event.repeat) toggleVideo();
    else if (event.altKey && event.code === 'KeyF') {
      event.preventDefault();
      toggleFull();
    }
  });
}

function toggleRecord() {
  if (engine.isRecording()) {
    lastTake = engine.stopRecording();
    const notes = lastTake.filter((event) => event.type === 'on').length;
    toast(notes ? `录好了 ${notes} 个音符，可以导出 MIDI` : '没有录到音符');
  } else {
    engine.startRecording();
    toast('正在录制你的演奏');
  }
  sync();
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

function bindControls() {
  bindPointer();
  bindKeys();
  $('btn-collapse').onclick = () => document.body.classList.add('chrome-hidden');
  $('btn-open').onclick = () => document.body.classList.remove('chrome-hidden');
  $('btn-midi-refresh').onclick = () => refreshMidi();
  els.midi.onchange = () => {
    selectedId = els.midi.value;
  };
  els.live.onchange = () => {
    liveTouched = true;
    settings.liveSound = els.live.checked;
    engine.setLiveSound(settings.liveSound);
    saveSettings();
  };
  $('btn-midi').onclick = () => $('file-midi').click();
  $('file-midi').onchange = (event) => {
    importMidi(event.target.files?.[0]);
    event.target.value = '';
  };
  els.songClear.onclick = () => clearSong();
  $('btn-demo').onclick = () => {
    lastBuffer = null;
    loadSong(createDemoSong(), '星澜');
    toast('已载入演示曲《星澜》');
  };
  els.play.onclick = () => togglePlay();
  els.stop.onclick = async () => {
    if (exportPhase) return;
    if (videoMode) await stopCapture();
    engine.stop();
    sync();
  };
  els.seek.addEventListener('pointerdown', () => {
    if (exportPhase) return;
    seeking = true;
  });
  els.seek.addEventListener('input', () => {
    if (exportPhase) return;
    engine.seek(Number(els.seek.value));
  });
  window.addEventListener('pointerup', () => {
    seeking = false;
  });
  els.loop.onchange = () => {
    if (exportPhase) {
      els.loop.checked = false;
      return;
    }
    settings.loop = els.loop.checked;
    engine.setLoop(settings.loop);
    saveSettings();
  };
  els.speed.oninput = () => {
    if (exportPhase) {
      els.speed.value = String(settings.speed);
      return;
    }
    settings.speed = Number(els.speed.value);
    engine.setSpeed(settings.speed / 100);
    els.speedLabel.textContent = `${(settings.speed / 100).toFixed(2)}×`;
    saveSettings();
  };
  els.volume.oninput = () => {
    settings.volume = Number(els.volume.value);
    engine.setVolume(settings.volume / 100);
    els.volumeLabel.textContent = `${settings.volume}%`;
    saveSettings();
  };
  els.guide.onchange = () => {
    settings.guide = els.guide.checked;
    engine.setGuide(settings.guide);
    saveSettings();
  };
  els.drums.onchange = () => {
    settings.drums = els.drums.checked;
    saveSettings();
    if (!lastBuffer) return;
    try {
      loadSong(parseMidi(lastBuffer, { includeDrums: settings.drums }), lastName);
    } catch (error) {
      toast(error.message || '重新解析失败');
    }
  };
  for (const button of els.modes) button.onclick = () => setMode(button.dataset.mode);
  els.rec.onclick = () => toggleRecord();
  els.exportMidi.onclick = () => {
    if (!lastTake?.length) return toast('还没有录音');
    const bytes = encodeMidi(lastTake, { bpm: 120, title: 'LUMINA 录音' });
    downloadBlob(new Blob([bytes], { type: 'audio/midi' }), 'Lumina-recording.mid');
  };
  $('btn-oct-down').onclick = () => typing.setOctave(settings.octave - 1);
  $('btn-oct-up').onclick = () => typing.setOctave(settings.octave + 1);
  $('btn-bg').onclick = () => $('file-bg').click();
  $('file-bg').onchange = (event) => {
    importImage(event.target.files?.[0]);
    event.target.value = '';
  };
  $('btn-bg-clear').onclick = () => renderer.clearBackground();
  els.dark.oninput = () => {
    settings.darkness = Number(els.dark.value);
    renderer.setDarkness(settings.darkness / 100);
    els.darkLabel.textContent = `${settings.darkness}%`;
    saveSettings();
  };
  els.blur.oninput = () => {
    settings.blur = Number(els.blur.value);
    renderer.setBlur(settings.blur);
    els.blurLabel.textContent = String(settings.blur);
    saveSettings();
  };
  els.lift.oninput = () => {
    settings.keyLift = Number(els.lift.value);
    renderer.setKeyLift(settings.keyLift);
    els.liftLabel.textContent = String(settings.keyLift);
    saveSettings();
  };
  els.theme.onchange = () => {
    settings.theme = els.theme.value;
    renderer.setTheme(settings.theme);
    saveSettings();
  };
  els.flowTheme.onclick = () => clearPalette('flow');
  els.smokeTheme.onclick = () => clearPalette('smoke');
  els.particle.onchange = () => {
    settings.particle = Number(els.particle.value);
    renderer.setParticleLevel(settings.particle);
    saveSettings();
  };
  els.flow.oninput = () => {
    settings.flow = Number(els.flow.value);
    renderer.setLookAhead(flowLookAhead(settings.flow));
    els.flowLabel.textContent = flowText(settings.flow);
    saveSettings();
  };
  els.labels.onchange = () => {
    settings.labels = els.labels.checked;
    renderer.setShowLabels(settings.labels);
    saveSettings();
  };
  els.grid.onchange = () => {
    settings.grid = els.grid.checked;
    renderer.setShowGrid(settings.grid);
    saveSettings();
  };
  els.bgPulse.onchange = () => {
    settings.bgPulse = els.bgPulse.checked;
    renderer.setBgPulse(settings.bgPulse);
    saveSettings();
  };
  els.exportFps.onchange = () => {
    settings.exportFps = Number(els.exportFps.value) === 30 ? 30 : 60;
    saveSettings();
  };
  els.exportAudio.onchange = () => {
    settings.exportAudio = els.exportAudio.checked;
    saveSettings();
  };
  els.clean.onchange = () => {
    settings.clean = els.clean.checked;
    renderer.setClean(settings.clean);
    saveSettings();
  };
  els.video.onclick = () => toggleVideo();
  els.exportVideo.onclick = () => exportSongVideo();
  $('btn-full').onclick = () => toggleFull();

  window.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (exportPhase) return;
    $('dropmask').hidden = false;
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) $('dropmask').hidden = true;
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    $('dropmask').hidden = true;
    if (exportPhase) return;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.(mid|midi)$/i.test(file.name)) importMidi(file);
    else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) importImage(file);
    else toast('请拖入 MIDI 或图片');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && videoMode === 'manual') toast('页面切到后台后，录制的视频可能会卡顿');
  });
}

document.fonts?.load('800 64px Oxanium');
document.fonts?.load('700 28px "Noto Sans SC"');
sync();
