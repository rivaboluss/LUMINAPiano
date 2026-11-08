import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoSong } from '../src/demo/song.js';
import { parseMidi } from '../src/midi/parse.js';
import { encodeMidi } from '../src/midi/write.js';
import { createLayout, hitTest, isBlack, noteName } from '../src/piano/layout.js';

function wrap(track) {
  const header = new Uint8Array([
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    0x01, 0xe0
  ]);
  const length = track.length;
  const head = new Uint8Array([
    0x4d, 0x54, 0x72, 0x6b,
    (length >>> 24) & 255,
    (length >>> 16) & 255,
    (length >>> 8) & 255,
    length & 255
  ]);
  const out = new Uint8Array(header.length + head.length + track.length);
  out.set(header, 0);
  out.set(head, header.length);
  out.set(track, header.length + head.length);
  return out;
}

test('layout covers a full piano and hit testing prefers black keys', () => {
  const layout = createLayout(1000, 8);
  assert.equal(layout.whites.length, 52);
  assert.equal(layout.blacks.length, 36);
  assert.equal(isBlack(21), false);
  assert.equal(isBlack(22), true);
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(21), 'A0');
  for (const key of layout.blacks) {
    assert.ok(key.x >= 8);
    assert.ok(key.x + key.w <= 992.5);
  }
  assert.equal(hitTest(layout, layout.whites[0].x + 1, 100, 0, 150), 21);
  const black = layout.blacks[0];
  assert.equal(hitTest(layout, black.x + black.w / 2, 10, 0, 150), black.midi);
});

test('writer and parser round-trip notes and title', () => {
  const bytes = encodeMidi([
    { time: 0, type: 'on', note: 60, velocity: 100 },
    { time: 0.5, type: 'on', note: 64, velocity: 80 },
    { time: 1, type: 'off', note: 60, velocity: 0 },
    { time: 1, type: 'off', note: 64, velocity: 0 }
  ], { bpm: 120, title: '测试' });
  const song = parseMidi(bytes);
  assert.equal(song.title, '测试');
  assert.equal(song.bpm, 120);
  assert.equal(song.notes.length, 2);
  assert.ok(Math.abs(song.notes[0].start) < 0.02);
  assert.ok(Math.abs(song.notes[0].end - 1) < 0.03);
  assert.equal(song.notes[1].midi, 64);
  assert.ok(Math.abs(song.notes[1].start - 0.5) < 0.03);
});

test('parser understands running status and sustain pedal', () => {
  const running = parseMidi(wrap(new Uint8Array([
    0x00, 0x90, 60, 100,
    0x83, 0x60, 64, 90,
    0x83, 0x60, 0x80, 60, 0,
    0x00, 64, 0,
    0x00, 0xff, 0x2f, 0x00
  ])));
  assert.equal(running.notes.length, 2);
  const c4 = running.notes.find((note) => note.midi === 60);
  const e4 = running.notes.find((note) => note.midi === 64);
  assert.ok(Math.abs(c4.end - 1) < 0.03);
  assert.ok(Math.abs(e4.start - 0.5) < 0.03);
  assert.ok(Math.abs(e4.end - 1) < 0.03);

  const sustained = parseMidi(wrap(new Uint8Array([
    0x00, 0xb0, 64, 127,
    0x00, 0x90, 60, 100,
    0x83, 0x60, 0x80, 60, 0,
    0x83, 0x60, 0xb0, 64, 0,
    0x00, 0xff, 0x2f, 0x00
  ])));
  assert.equal(sustained.notes.length, 1);
  assert.ok(Math.abs(sustained.notes[0].end - 1) < 0.03);
});

test('drum channel is skipped unless requested', () => {
  const bytes = wrap(new Uint8Array([
    0x00, 0x99, 36, 100,
    0x00, 0x90, 60, 80,
    0x83, 0x60, 0x80, 60, 0,
    0x83, 0x60, 0x89, 36, 0,
    0x00, 0xff, 0x2f, 0x00
  ]));
  assert.equal(parseMidi(bytes).notes.length, 1);
  assert.equal(parseMidi(bytes, { includeDrums: true }).notes.length, 2);
});

test('demo song is a playable original etude', () => {
  const song = createDemoSong();
  assert.equal(song.title, '星澜');
  assert.ok(song.notes.length > 80);
  assert.ok(song.duration > 20 && song.duration < 40);
  for (const note of song.notes) {
    assert.ok(note.end > note.start);
    assert.ok(note.midi >= 0 && note.midi <= 127);
    assert.ok(note.velocity > 0 && note.velocity <= 127);
  }
  for (let i = 1; i < song.notes.length; i++) {
    assert.ok(song.notes[i].start >= song.notes[i - 1].start);
  }
});

test('parser rejects a file that is not midi', () => {
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3, 4])), /MIDI/);
});
