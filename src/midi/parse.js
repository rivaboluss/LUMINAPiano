function readVLQ(bytes, offset, end) {
  let value = 0;
  let count = 0;
  while (offset < end && count < 5) {
    const byte = bytes[offset++];
    value = (value << 7) | (byte & 0x7f);
    count++;
    if ((byte & 0x80) === 0) return { value, offset };
  }
  return { value, offset };
}

function decodeBytes(data) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/\0/g, '').trim();
  } catch {
    return new TextDecoder('latin1').decode(data).replace(/\0/g, '').trim();
  }
}

function parseTrack(bytes, start, end, trackIndex) {
  let offset = start;
  let tick = 0;
  let running = 0;
  const events = [];

  while (offset < end) {
    const delta = readVLQ(bytes, offset, end);
    offset = delta.offset;
    tick += delta.value;
    if (offset >= end) break;

    let status = bytes[offset];
    if (status < 0x80) {
      if (!running) break;
      status = running;
    } else {
      offset++;
      running = status >= 0xf0 ? 0 : status;
    }

    if (status === 0xff) {
      if (offset >= end) break;
      const type = bytes[offset++];
      const length = readVLQ(bytes, offset, end);
      offset = length.offset;
      const dataEnd = Math.min(end, offset + length.value);
      const data = bytes.subarray(offset, dataEnd);
      offset += length.value;
      if (type === 0x2f) break;
      if (type === 0x51 && data.length >= 3) {
        events.push({
          tick,
          order: 0,
          kind: 'tempo',
          uspq: (data[0] << 16) | (data[1] << 8) | data[2]
        });
      } else if ((type === 0x03 || type === 0x01) && data.length) {
        const text = decodeBytes(data);
        if (text) events.push({ tick, order: 0, kind: 'name', text });
      }
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      const length = readVLQ(bytes, offset, end);
      offset = length.offset + length.value;
      continue;
    }

    const command = status & 0xf0;
    const channel = status & 0x0f;
    const size = command === 0xc0 || command === 0xd0 ? 1 : 2;
    if (offset + size > end) break;
    const data1 = bytes[offset++];
    const data2 = size === 2 ? bytes[offset++] : 0;

    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      events.push({ tick, order: 1, kind: 'note', type: 'off', channel, midi: data1, vel: data2, track: trackIndex });
    } else if (command === 0x90) {
      events.push({ tick, order: 3, kind: 'note', type: 'on', channel, midi: data1, vel: data2, track: trackIndex });
    } else if (command === 0xb0 && (data1 === 64 || data1 === 66)) {
      events.push({ tick, order: 2, kind: 'pedal', channel, down: data2 >= 64 });
    }
  }

  return events;
}

function makeToSec(tempos, division) {
  const list = tempos.slice().sort((a, b) => a.tick - b.tick);
  if (!list.length || list[0].tick > 0) list.unshift({ tick: 0, uspq: 500000 });
  const compact = [];
  for (const item of list) {
    if (compact.length && compact[compact.length - 1].tick === item.tick) compact[compact.length - 1] = item;
    else compact.push(item);
  }
  const segments = [];
  let seconds = 0;
  for (let i = 0; i < compact.length; i++) {
    segments.push({ tick: compact[i].tick, seconds, uspq: compact[i].uspq || 500000 });
    if (i + 1 < compact.length) {
      const delta = compact[i + 1].tick - compact[i].tick;
      seconds += (delta * (compact[i].uspq || 500000)) / (division * 1000000);
    }
  }
  return (tick) => {
    let segment = segments[0];
    for (const item of segments) {
      if (item.tick <= tick) segment = item;
      else break;
    }
    return segment.seconds + ((tick - segment.tick) * segment.uspq) / (division * 1000000);
  };
}

function finishNote(bucket, channel, midi, endTick, info) {
  bucket.push({
    midi,
    velocity: info.vel,
    startTick: info.tick,
    endTick: Math.max(endTick, info.tick + 1),
    track: info.track
  });
}

export function parseMidi(buffer, options = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 14) throw new Error('文件太小，不是有效的 MIDI');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const text = (length) => {
    let value = '';
    for (let i = 0; i < length; i++) value += String.fromCharCode(bytes[offset++]);
    return value;
  };
  const u16 = () => {
    const value = view.getUint16(offset);
    offset += 2;
    return value;
  };
  const u32 = () => {
    const value = view.getUint32(offset);
    offset += 4;
    return value;
  };

  if (text(4) !== 'MThd') throw new Error('不是标准 MIDI 文件');
  const headerLength = u32();
  const headerStart = offset;
  u16();
  const trackCount = u16();
  let division = u16();
  offset = headerStart + headerLength;
  if (!division) division = 480;

  const merged = [];
  for (let track = 0; track < trackCount && offset + 8 <= bytes.length; track++) {
    if (text(4) !== 'MTrk') break;
    const length = u32();
    const end = Math.min(bytes.length, offset + length);
    merged.push(...parseTrack(bytes, offset, end, track));
    offset = end;
  }
  merged.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const tempos = [];
  let title = '';
  let lastTick = 0;
  const timed = [];
  for (const event of merged) {
    lastTick = Math.max(lastTick, event.tick);
    if (event.kind === 'tempo') tempos.push(event);
    else if (event.kind === 'name' && !title) title = event.text;
    else if (event.kind === 'note' || event.kind === 'pedal') {
      if (!options.includeDrums && event.channel === 9 && event.kind === 'note') continue;
      timed.push(event);
    }
  }

  let toSec;
  if (division & 0x8000) {
    const frames = Math.abs(((division >> 8) & 0xff) - 256);
    const ticksPerSecond = Math.max(1, frames * (division & 0xff));
    toSec = (tick) => tick / ticksPerSecond;
  } else {
    toSec = makeToSec(tempos, division);
  }

  const active = Array.from({ length: 16 }, () => new Map());
  const hanging = Array.from({ length: 16 }, () => new Map());
  const sustain = Array(16).fill(false);
  const rawNotes = [];

  for (const event of timed) {
    if (event.kind === 'pedal') {
      sustain[event.channel] = event.down;
      if (!event.down) {
        for (const [midi, info] of hanging[event.channel]) finishNote(rawNotes, event.channel, midi, event.tick, info);
        hanging[event.channel].clear();
      }
      continue;
    }
    if (event.type === 'off') {
      const info = active[event.channel].get(event.midi);
      if (!info) continue;
      active[event.channel].delete(event.midi);
      if (sustain[event.channel]) hanging[event.channel].set(event.midi, info);
      else finishNote(rawNotes, event.channel, event.midi, event.tick, info);
      continue;
    }
    const previous = active[event.channel].get(event.midi);
    if (previous) {
      active[event.channel].delete(event.midi);
      finishNote(rawNotes, event.channel, event.midi, event.tick, previous);
    }
    const held = hanging[event.channel].get(event.midi);
    if (held) {
      hanging[event.channel].delete(event.midi);
      finishNote(rawNotes, event.channel, event.midi, event.tick, held);
    }
    active[event.channel].set(event.midi, { tick: event.tick, vel: event.vel, track: event.track });
  }

  for (let channel = 0; channel < 16; channel++) {
    for (const [midi, info] of active[channel]) finishNote(rawNotes, channel, midi, lastTick, info);
    for (const [midi, info] of hanging[channel]) finishNote(rawNotes, channel, midi, lastTick, info);
  }

  const notes = [];
  for (const note of rawNotes) {
    if (note.midi < 0 || note.midi > 127 || note.velocity <= 0) continue;
    const start = toSec(note.startTick);
    let end = toSec(note.endTick);
    if (end < start + 0.045) end = start + 0.045;
    notes.push({ midi: note.midi, start, end, velocity: note.velocity });
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);

  const firstTempo = tempos.length ? tempos[0].uspq : 500000;
  const bpm = Math.max(1, Math.round(60000000 / firstTempo));
  const lastEnd = notes.reduce((max, note) => Math.max(max, note.end), 0);
  const duration = Math.max(lastEnd, toSec(lastTick)) + 0.45;
  const grid = [];
  if (!(division & 0x8000)) {
    const step = division;
    for (let tick = 0; tick <= lastTick + step; tick += step) {
      const quarter = Math.round(tick / step);
      grid.push({ t: toSec(tick), down: quarter % 4 === 0 });
    }
  } else {
    for (let time = 0; time <= duration; time += 0.5) grid.push({ t: time, down: Math.round(time * 2) % 8 === 0 });
  }

  return {
    title: title || '未命名曲目',
    bpm,
    duration,
    notes,
    grid
  };
}
