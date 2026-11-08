export const MIDI_MIN = 21;
export const MIDI_MAX = 108;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function isBlack(midi) {
  const pc = midi % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function noteName(midi) {
  const oct = Math.floor(midi / 12) - 1;
  return NAMES[((midi % 12) + 12) % 12] + oct;
}

export function createLayout(width, pad = 8) {
  const whites = [];
  const blacks = [];
  const byMidi = new Array(128).fill(null);
  const usable = Math.max(88, width - pad * 2);
  let whiteCount = 0;
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    if (!isBlack(midi)) whiteCount++;
  }
  const whiteW = usable / whiteCount;
  let index = 0;
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    if (isBlack(midi)) continue;
    const key = { midi, x: pad + index * whiteW, w: whiteW, black: false };
    whites.push(key);
    byMidi[midi] = key;
    index++;
  }
  const blackW = whiteW * 0.57;
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    if (!isBlack(midi)) continue;
    const prev = byMidi[midi - 1];
    const pc = midi % 12;
    let shift = 0;
    if (pc === 1 || pc === 6) shift = -whiteW * 0.05;
    else if (pc === 3) shift = whiteW * 0.02;
    else if (pc === 8) shift = whiteW * 0.07;
    else if (pc === 10) shift = whiteW * 0.13;
    const center = prev.x + whiteW + shift;
    let x = center - blackW / 2;
    x = Math.max(pad, Math.min(x, pad + usable - blackW));
    const key = { midi, x, w: blackW, black: true };
    blacks.push(key);
    byMidi[midi] = key;
  }
  return { whites, blacks, byMidi, whiteW, blackW, pad, width };
}

export function hitTest(layout, x, y, keyTop, keyH) {
  if (!layout || y < keyTop || y > keyTop + keyH) return null;
  if (y <= keyTop + keyH * 0.67) {
    for (let i = layout.blacks.length - 1; i >= 0; i--) {
      const key = layout.blacks[i];
      if (x >= key.x && x <= key.x + key.w) return key.midi;
    }
  }
  for (const key of layout.whites) {
    if (x >= key.x && x < key.x + key.w) return key.midi;
  }
  return null;
}
