import { clamp, lowerBound } from '../util.js';
import { createSynth } from './synth.js';

export function createEngine() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextClass();
  const synth = createSynth(ctx);
  const listeners = new Map();
  const fingers = new Map();
  const sustained = new Map();

  let song = null;
  let playing = false;
  let songTimeAtStart = 0;
  let anchorAudio = ctx.currentTime;
  let anchorPerf = performance.now();
  let speed = 1;
  let loop = false;
  let mode = 'free';
  let guide = true;
  let liveSound = true;
  let pedal = false;
  let schedCursor = 0;
  let recording = null;
  let recDest = null;

  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name).delete(fn);
  }

  function emit(name, payload) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  function now() {
    return performance.now() / 1000;
  }

  function getSongTime() {
    if (!playing) return songTimeAtStart;
    return songTimeAtStart + ((performance.now() - anchorPerf) / 1000) * speed;
  }

  function markAnchors() {
    anchorPerf = performance.now();
    anchorAudio = ctx.currentTime;
  }

  function shouldPlaySong() {
    return mode === 'auto' || (mode === 'rhythm' && guide);
  }

  function schedule() {
    if (!playing || !song) return;
    const time = getSongTime();
    const horizon = time + 0.3;
    const audible = shouldPlaySong() && ctx.state === 'running';
    const scale = mode === 'rhythm' ? 0.4 : 1;
    while (schedCursor < song.notes.length && song.notes[schedCursor].start <= horizon) {
      const note = song.notes[schedCursor++];
      if (!audible || note.start < time - 0.04) continue;
      const delay = Math.max(0, (note.start - time) / speed);
      synth.playScheduled(note.midi, note.velocity, ctx.currentTime + delay, Math.max(0.05, (note.end - note.start) / speed), scale);
    }
  }

  function tick() {
    if (!playing || !song) return;
    schedule();
    if (getSongTime() < song.duration) return;
    if (loop) {
      seek(0);
      return;
    }
    playing = false;
    songTimeAtStart = song.duration;
    synth.stopScheduled();
    emit('ended');
    emit('state');
  }

  function seek(time) {
    const duration = song ? song.duration : 0;
    songTimeAtStart = clamp(time, 0, duration);
    markAnchors();
    synth.stopScheduled();
    schedCursor = song ? lowerBound(song.notes, songTimeAtStart - 0.001) : 0;
    emit('seek', songTimeAtStart);
  }

  function endLogical(midi) {
    synth.noteOff(midi);
    const time = now();
    emit('noteoff', { midi, time });
    if (recording) recording.events.push({ time: Math.max(0, time - recording.t0), type: 'off', note: midi, velocity: 0 });
  }

  const timer = setInterval(tick, 25);

  return {
    ctx,
    on,
    now,
    getSongTime,
    isPlaying: () => playing,
    isLoop: () => loop,
    getSong: () => song,
    getMode: () => mode,
    isRecording: () => !!recording,
    async resume() {
      if (ctx.state !== 'running') await ctx.resume();
    },
    load(next) {
      song = next;
      playing = false;
      songTimeAtStart = 0;
      markAnchors();
      schedCursor = 0;
      synth.stopScheduled();
      emit('seek', 0);
      emit('state');
    },
    play() {
      if (!song) return false;
      if (songTimeAtStart >= song.duration - 0.03) songTimeAtStart = 0;
      playing = true;
      markAnchors();
      schedCursor = lowerBound(song.notes, Math.max(0, songTimeAtStart - 0.001));
      emit('state');
      return true;
    },
    pause() {
      if (!playing) return;
      songTimeAtStart = getSongTime();
      playing = false;
      synth.stopScheduled();
      emit('state');
    },
    stop() {
      playing = false;
      songTimeAtStart = 0;
      markAnchors();
      schedCursor = 0;
      synth.stopScheduled();
      emit('seek', 0);
      emit('state');
    },
    seek,
    setSpeed(value) {
      const next = clamp(value, 0.5, 1.5);
      if (playing) {
        const time = getSongTime();
        speed = next;
        songTimeAtStart = time;
        markAnchors();
        synth.stopScheduled();
        if (song) schedCursor = lowerBound(song.notes, time - 0.001);
      } else {
        speed = next;
      }
    },
    setLoop(value) {
      loop = !!value;
    },
    setMode(next) {
      mode = next;
      if (!playing || !song) return;
      synth.stopScheduled();
      schedCursor = lowerBound(song.notes, getSongTime() - 0.001);
    },
    setGuide(value) {
      guide = !!value;
      if (!playing || !song) return;
      synth.stopScheduled();
      schedCursor = lowerBound(song.notes, getSongTime() - 0.001);
    },
    setLiveSound(value) {
      liveSound = !!value;
      if (!liveSound) {
        synth.stopLive();
        return;
      }
      for (const [midi, velocity] of fingers) synth.noteOn(midi, velocity);
      for (const [midi, velocity] of sustained) synth.noteOn(midi, velocity);
    },
    setVolume(value) {
      const time = ctx.currentTime;
      synth.master.gain.cancelScheduledValues(time);
      synth.master.gain.setTargetAtTime(Math.pow(clamp(value, 0, 1), 1.25), time, 0.02);
    },
    inputNoteOn(midi, velocity) {
      if (fingers.has(midi) || sustained.has(midi)) {
        fingers.delete(midi);
        sustained.delete(midi);
        endLogical(midi);
      }
      const vel = clamp(velocity | 0, 1, 127);
      fingers.set(midi, vel);
      if (liveSound) synth.noteOn(midi, vel);
      const time = now();
      emit('noteon', { midi, velocity: vel, time });
      if (recording) recording.events.push({ time: Math.max(0, time - recording.t0), type: 'on', note: midi, velocity: vel });
    },
    inputNoteOff(midi) {
      if (!fingers.has(midi)) return;
      const velocity = fingers.get(midi);
      fingers.delete(midi);
      if (pedal) {
        sustained.set(midi, velocity);
        return;
      }
      endLogical(midi);
    },
    inputPedal(down) {
      pedal = !!down;
      emit('pedal', { down: pedal });
      if (pedal) return;
      for (const midi of sustained.keys()) endLogical(midi);
      sustained.clear();
    },
    startRecording() {
      const time = now();
      recording = { t0: time, events: [] };
      for (const [midi, velocity] of fingers) recording.events.push({ time: 0, type: 'on', note: midi, velocity });
      for (const [midi, velocity] of sustained) recording.events.push({ time: 0, type: 'on', note: midi, velocity });
      emit('state');
    },
    stopRecording() {
      if (!recording) return [];
      const time = Math.max(0, now() - recording.t0);
      const active = new Set();
      for (const event of recording.events) {
        if (event.type === 'on') active.add(event.note);
        else active.delete(event.note);
      }
      for (const midi of active) recording.events.push({ time, type: 'off', note: midi, velocity: 0 });
      const events = recording.events;
      recording = null;
      emit('state');
      return events;
    },
    tapAudio() {
      if (!recDest) {
        recDest = ctx.createMediaStreamDestination();
        synth.master.connect(recDest);
      }
      return recDest.stream;
    },
    dispose() {
      clearInterval(timer);
      synth.stopAll();
    }
  };
}
