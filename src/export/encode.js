import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { createSynth } from '../audio/synth.js';
import { formatTime } from '../util.js';

const TAIL = 1.2;

async function yieldToUi() {
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 32);
  });
}

function createBackpressure() {
  let notify = () => {};
  return {
    notify() {
      notify();
    },
    wait(encoder, limit, failed) {
      failed();
      if (encoder.encodeQueueSize <= limit) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          notify = () => {};
          reject(new Error('视频编码超时，请换用最新版 Chrome 或 Edge 再试一次'));
        }, 20000);
        notify = () => {
          try {
            failed();
          } catch (error) {
            clearTimeout(timer);
            notify = () => {};
            reject(error);
            return;
          }
          if (encoder.encodeQueueSize <= limit) {
            clearTimeout(timer);
            notify = () => {};
            resolve();
          }
        };
      });
    }
  };
}

function closeEncoder(encoder) {
  try {
    if (encoder && encoder.state !== 'closed') encoder.close();
  } catch {
    /* already closed */
  }
}

async function firstSupported(kind, candidates) {
  const Encoder = kind === 'video' ? VideoEncoder : AudioEncoder;
  for (const config of candidates) {
    try {
      const support = await Encoder.isConfigSupported(config);
      if (!support.supported) continue;
      const chosen = { ...(support.config || config) };
      if (kind === 'video') chosen.avc = { format: 'avc' };
      return chosen;
    } catch {
      /* try the next profile */
    }
  }
  return null;
}

function videoCodecs(fps) {
  if (fps >= 60) return ['avc1.640032', 'avc1.64002a', 'avc1.4d0032', 'avc1.4d002a', 'avc1.420032', 'avc1.42002a'];
  return ['avc1.640028', 'avc1.4d0028', 'avc1.420028', 'avc1.64001f', 'avc1.4d001f', 'avc1.42001f'];
}

function videoBitrate(width, height, fps) {
  const scale = fps / 30;
  const estimate = width * height * 3.2 * scale;
  return Math.round(Math.min(8_000_000 * scale, Math.max(4_000_000 * scale, estimate)));
}

function videoCandidates(width, height, bitrate, fps) {
  const hardware = ['prefer-hardware', 'no-preference'];
  const list = [];
  for (const hardwareAcceleration of hardware) {
    for (const codec of videoCodecs(fps)) {
      list.push({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        avc: { format: 'avc' },
        hardwareAcceleration,
        latencyMode: 'realtime'
      });
    }
  }
  return list;
}

async function renderSongAudio(song, { speed, volume, sampleRate, samples, onSlice }) {
  const seconds = samples / sampleRate;
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);
  const gain = Math.pow(Math.min(1, Math.max(0, volume)), 1.25);
  const slice = 2.5;
  const release = 2.3;
  const reverb = 3.2;
  const slices = Math.max(1, Math.ceil(seconds / slice));
  for (let index = 0; index < slices; index++) {
    const sliceStart = index * slice;
    const sliceEnd = Math.min(seconds, sliceStart + slice);
    const notes = [];
    let audibleUntil = sliceEnd;
    for (const note of song.notes) {
      const when = note.start / speed;
      if (when < sliceStart || when >= sliceEnd) continue;
      notes.push(note);
      audibleUntil = Math.max(audibleUntil, when + Math.max(0.05, (note.end - note.start) / speed) + release);
    }
    onSlice?.((index + 1) / slices);
    if (!notes.length) {
      await yieldToUi();
      continue;
    }
    const renderSeconds = Math.min(seconds - sliceStart, audibleUntil - sliceStart + reverb);
    const length = Math.max(1, Math.ceil(renderSeconds * sampleRate));
    const ctx = new OfflineAudioContext(2, length, sampleRate);
    const synth = createSynth(ctx);
    synth.master.gain.setValueAtTime(gain, 0);
    for (const note of notes) {
      const when = note.start / speed - sliceStart;
      const duration = Math.max(0.05, (note.end - note.start) / speed);
      synth.playScheduled(note.midi, note.velocity || 80, when, duration, 1);
    }
    const buffer = await ctx.startRendering();
    const offset = Math.round(sliceStart * sampleRate);
    const mixL = buffer.getChannelData(0);
    const mixR = buffer.getChannelData(1);
    const count = Math.min(buffer.length, samples - offset);
    for (let i = 0; i < count; i++) {
      left[offset + i] += mixL[i];
      right[offset + i] += mixR[i];
    }
    await yieldToUi();
  }
  let peak = 0;
  for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  if (peak > 0.98) {
    const scale = 0.98 / peak;
    for (let i = 0; i < samples; i++) {
      left[i] *= scale;
      right[i] *= scale;
    }
  }
  return {
    sampleRate,
    length: samples,
    numberOfChannels: 2,
    getChannelData(channel) {
      return channel === 0 ? left : right;
    }
  };
}

function addChunk(muxer, kind, chunk, meta, fallbackDuration) {
  const duration = chunk.duration ?? fallbackDuration;
  if (chunk.duration != null) {
    if (kind === 'video') muxer.addVideoChunk(chunk, meta);
    else muxer.addAudioChunk(chunk, meta);
    return;
  }
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  if (kind === 'video') muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, duration, meta);
  else muxer.addAudioChunkRaw(data, chunk.type, chunk.timestamp, duration, meta);
}

async function encodeAudio(encoder, buffer, failed, backpressure) {
  const rate = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const chunk = 2048;
  const us = 1e6 / rate;
  for (let offset = 0; offset < buffer.length; offset += chunk) {
    failed();
    const count = Math.min(chunk, buffer.length - offset);
    const data = new Float32Array(count * 2);
    data.set(left.subarray(offset, offset + count), 0);
    data.set(right.subarray(offset, offset + count), count);
    const audio = new AudioData({
      format: 'f32-planar',
      sampleRate: rate,
      numberOfFrames: count,
      numberOfChannels: 2,
      timestamp: Math.round(offset * us),
      data
    });
    try {
      encoder.encode(audio);
    } finally {
      audio.close();
    }
    await backpressure.wait(encoder, 12, failed);
  }
}

export async function encodeSongVideo({ song, canvas, speed, volume, fps, audio = true, paint, onProgress }) {
  const framesPerSecond = Number(fps) === 30 ? 30 : 60;
  const withAudio = audio !== false;
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || (withAudio && typeof AudioEncoder === 'undefined')) {
    throw new Error('请使用最新版 Chrome 或 Edge 导出视频');
  }
  const rate = Math.min(1.5, Math.max(0.5, speed || 1));
  const width = canvas.width - (canvas.width % 2);
  const height = canvas.height - (canvas.height % 2);
  if (width < 2 || height < 2) throw new Error('画面尺寸太小，无法导出');

  const bitrate = videoBitrate(width, height, framesPerSecond);
  const videoConfig = await firstSupported('video', videoCandidates(width, height, bitrate, framesPerSecond));
  const audioConfig = withAudio ? await firstSupported('audio', [{
    codec: 'mp4a.40.2',
    sampleRate: 48000,
    numberOfChannels: 2,
    bitrate: 160000
  }]) : null;
  if (!videoConfig) {
    throw new Error(framesPerSecond >= 60
      ? '当前浏览器不能导出 60 帧的 1080p 视频，请换用最新版 Chrome 或 Edge，或先改成 30 帧'
      : '当前浏览器不能导出可拖动进度的 MP4，请换用最新版 Chrome 或 Edge');
  }
  if (withAudio && !audioConfig) throw new Error('当前浏览器不能导出带声音的 MP4，请换用最新版 Chrome 或 Edge，或关掉导出声音');

  const sampleRate = audioConfig?.sampleRate || 48000;
  const frameUs = Math.round(1e6 / framesPerSecond);
  const frameCount = Math.max(1, Math.round((song.duration / rate + TAIL) * framesPerSecond));
  const samples = Math.max(1, Math.round((frameCount * frameUs / 1e6) * sampleRate));
  const dt = frameUs / 1e6;

  let audioBuffer = null;
  if (withAudio) {
    onProgress?.(0.03, '正在生成声音，不用等曲子播完。', '正在生成声音');
    await yieldToUi();
    audioBuffer = await renderSongAudio(song, {
      speed: rate,
      volume,
      sampleRate,
      samples,
      onSlice: (ratio) => {
        const pct = Math.round(3 + ratio * 7);
        onProgress?.(pct / 100, '正在生成声音，不用等曲子播完。', `正在生成声音 ${pct}%`);
      }
    });
  }

  const target = new ArrayBufferTarget();
  const muxerOptions = {
    target,
    video: { codec: 'avc', width, height, frameRate: framesPerSecond },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  };
  if (withAudio) muxerOptions.audio = { codec: 'aac', numberOfChannels: 2, sampleRate };
  const muxer = new Muxer(muxerOptions);

  let encoderError = null;
  const failed = () => {
    if (encoderError) throw encoderError;
  };
  const report = (error) => {
    encoderError = error instanceof Error ? error : new Error(String(error?.message || '视频编码失败'));
  };
  const videoPressure = createBackpressure();
  const audioPressure = createBackpressure();
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        addChunk(muxer, 'video', chunk, meta, frameUs);
      } catch (error) {
        report(error);
      }
      videoPressure.notify();
    },
    error: report
  });
  const audioEncoder = withAudio ? new AudioEncoder({
    output: (chunk, meta) => {
      try {
        addChunk(muxer, 'audio', chunk, meta, Math.round(1024e6 / sampleRate));
      } catch (error) {
        report(error);
      }
      audioPressure.notify();
    },
    error: report
  }) : null;

  try {
    videoEncoder.configure(videoConfig);
    if (withAudio) {
      audioEncoder.configure(audioConfig);
      onProgress?.(0.1, '正在渲染画面，不用等曲子播完。完成后会自动弹出下载。', `10% · 0:00 / ${formatTime(song.duration)}`);
      await encodeAudio(audioEncoder, audioBuffer, failed, audioPressure);
      await audioEncoder.flush();
      failed();
    } else {
      onProgress?.(0.08, '正在渲染画面，不用等曲子播完。完成后会自动弹出下载。', `8% · 0:00 / ${formatTime(song.duration)}`);
      await yieldToUi();
    }

    for (let i = 0; i < frameCount; i++) {
      failed();
      const wall = (i * frameUs) / 1e6;
      const songTime = Math.min(song.duration, wall * rate);
      paint(songTime, dt, wall);
      const frame = new VideoFrame(canvas, { timestamp: i * frameUs, duration: frameUs });
      try {
        videoEncoder.encode(frame, { keyFrame: i % framesPerSecond === 0 });
      } finally {
        frame.close();
      }
      await videoPressure.wait(videoEncoder, 8, failed);
      failed();
      if (i % 45 === 0 || i === frameCount - 1) {
        const ratio = 0.12 + 0.84 * ((i + 1) / frameCount);
        const pct = Math.round(ratio * 100);
        onProgress?.(
          ratio,
          '正在渲染画面，不用等曲子播完。完成后会自动弹出下载。',
          `${pct}% · ${formatTime(songTime)} / ${formatTime(song.duration)}`
        );
        await yieldToUi();
      }
    }

    await videoEncoder.flush();
    failed();
    onProgress?.(0.99, '正在封装视频，下载会自动弹出。', '100%');
    await yieldToUi();
    muxer.finalize();
    const buffer = target.buffer;
    if (!buffer?.byteLength) throw new Error('没有生成视频');
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (error) {
    if (encoderError) throw new Error(encoderError.message || '视频编码失败');
    throw error;
  } finally {
    closeEncoder(videoEncoder);
    closeEncoder(audioEncoder);
  }
}
