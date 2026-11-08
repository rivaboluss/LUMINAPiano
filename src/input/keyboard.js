import { noteName } from '../piano/layout.js';

const WHITE = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
const WHITE_SEMI = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17];
const BLACK = { KeyW: 1, KeyE: 3, KeyT: 6, KeyY: 8, KeyU: 10, KeyO: 13, KeyP: 15 };

export function bindComputerKeyboard({ onDown, onUp, onOctave, initialOctave = 0 }) {
  let octave = initialOctave;
  const held = new Map();

  function label() {
    const start = 60 + octave * 12;
    return `${noteName(start)} – ${noteName(start + 17)}`;
  }

  function releaseAll() {
    for (const midi of held.values()) onUp(midi);
    held.clear();
  }

  function setOctave(next) {
    const value = Math.max(-3, Math.min(3, next | 0));
    if (value === octave) return;
    releaseAll();
    octave = value;
    onOctave?.(label(), octave);
  }

  function midiFrom(code) {
    const white = WHITE.indexOf(code);
    if (white >= 0) return 60 + octave * 12 + WHITE_SEMI[white];
    if (Object.prototype.hasOwnProperty.call(BLACK, code)) return 60 + octave * 12 + BLACK[code];
    return null;
  }

  function blocked(event) {
    const tag = event.target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable;
  }

  function down(event) {
    if (event.repeat || blocked(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyZ') {
      setOctave(octave - 1);
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyX') {
      setOctave(octave + 1);
      event.preventDefault();
      return;
    }
    const midi = midiFrom(event.code);
    if (midi == null || midi < 21 || midi > 108 || held.has(event.code)) return;
    held.set(event.code, midi);
    onDown(midi, event.shiftKey ? 68 : 108);
    event.preventDefault();
  }

  function up(event) {
    const midi = held.get(event.code);
    if (midi == null) return;
    held.delete(event.code);
    onUp(midi);
  }

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', releaseAll);
  onOctave?.(label(), octave);
  return { setOctave, label };
}
