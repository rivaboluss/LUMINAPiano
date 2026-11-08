export function createDemoSong() {
  const bpm = 84;
  const beat = 60 / bpm;
  const lead = 2;
  const notes = [];
  const add = (midi, beatPos, duration, velocity) => {
    const start = beatPos * beat;
    notes.push({
      midi,
      start,
      end: start + Math.max(0.06, duration * beat),
      velocity: Math.max(1, Math.min(127, Math.round(velocity)))
    });
  };

  const bars = [
    { bass: 36, tones: [60, 64, 67, 72] },
    { bass: 43, tones: [59, 62, 67, 71] },
    { bass: 45, tones: [57, 60, 64, 69] },
    { bass: 41, tones: [53, 57, 60, 65] },
    { bass: 36, tones: [60, 64, 67, 72] },
    { bass: 43, tones: [55, 59, 62, 67] },
    { bass: 41, tones: [53, 57, 60, 65] },
    { bass: 36, tones: [48, 55, 60, 64] }
  ];
  const melody = [76, 79, 74, 72, 81, 79, 76, 72, 79, 76, 74, 67, 72, 76, 72, 67];
  const pattern = [0, 1, 2, 3, 2, 1, 2, 0];

  bars.forEach((bar, index) => {
    const start = lead + index * 4;
    add(bar.bass, start, 1.75, 92);
    add(bar.bass + 12, start + 2, 1.45, 78);
    for (let step = 0; step < 8; step++) {
      const lift = index >= 4 && (step === 3 || step === 7) ? 12 : 0;
      add(bar.tones[pattern[step]] + lift, start + step * 0.5, 0.4, 48 + (step % 2) * 16 + (lift ? 12 : 0));
    }
    add(melody[index * 2], start + 0.5, 1.45, 108);
    add(melody[index * 2 + 1], start + 2.5, 1.35, 100);
  });

  const ending = lead + 32;
  for (const midi of [36, 48, 52, 55, 60, 64, 67, 72]) {
    add(midi, ending, 3.8, midi >= 60 ? 114 : 98);
  }

  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const duration = notes[notes.length - 1].end + 0.85;
  const grid = [];
  const total = Math.ceil(duration / beat) + 1;
  for (let i = 0; i < total; i++) grid.push({ t: i * beat, down: i % 4 === 0 });
  return { title: '星澜', bpm, duration, notes, grid };
}
