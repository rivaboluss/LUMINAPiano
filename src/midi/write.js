const PPQ = 480;

function encodeVLQ(value) {
  let n = Math.max(0, value | 0);
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.push((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes.reverse();
}

function u16(value) {
  return [(value >> 8) & 255, value & 255];
}

function u32(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function chunk(type, data) {
  return [...type, ...u32(data.length), ...data];
}

export function encodeMidi(events, options = {}) {
  const bpm = Math.max(20, Math.min(400, options.bpm || 120));
  const title = options.title || 'LUMINA';
  const uspq = Math.round(60000000 / bpm);
  const data = [0x00, 0xff, 0x51, 0x03, (uspq >> 16) & 255, (uspq >> 8) & 255, uspq & 255];
  const titleBytes = [...new TextEncoder().encode(title)];
  data.push(0x00, 0xff, 0x03, ...encodeVLQ(titleBytes.length), ...titleBytes);

  const sorted = events
    .filter((event) => event && event.note >= 0 && event.note <= 127)
    .map((event) => ({
      tick: Math.max(0, Math.round(event.time * (bpm / 60) * PPQ)),
      type: event.type === 'on' ? 'on' : 'off',
      note: event.note | 0,
      velocity: Math.max(1, Math.min(127, event.velocity || 1))
    }))
    .sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));

  let lastTick = 0;
  for (const event of sorted) {
    data.push(...encodeVLQ(event.tick - lastTick));
    lastTick = event.tick;
    if (event.type === 'on') data.push(0x90, event.note, event.velocity);
    else data.push(0x80, event.note, 0);
  }
  data.push(0x00, 0xff, 0x2f, 0x00);

  const bytes = [
    ...chunk([0x4d, 0x54, 0x68, 0x64], [...u16(0), ...u16(1), ...u16(PPQ)]),
    ...chunk([0x4d, 0x54, 0x72, 0x6b], data)
  ];
  return new Uint8Array(bytes);
}
