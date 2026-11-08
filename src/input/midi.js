export function describeMessage(data) {
  if (!data || data.length < 2) return null;
  const status = data[0];
  if (status >= 0xf0) return null;
  const command = status & 0xf0;
  const data1 = data[1];
  const data2 = data.length > 2 ? data[2] : 0;
  if (command === 0x90 && data2 > 0) return { type: 'on', note: data1, velocity: data2 };
  if (command === 0x80 || (command === 0x90 && data2 === 0)) return { type: 'off', note: data1 };
  if (command === 0xb0 && (data1 === 64 || data1 === 66)) return { type: 'pedal', down: data2 >= 64 };
  return null;
}

export async function openMidi(onEvent, onAccess) {
  if (!navigator.requestMIDIAccess) {
    throw new Error('当前浏览器不能连接电钢琴，请用 Chrome 或 Edge 打开');
  }
  const access = await navigator.requestMIDIAccess();
  const bind = () => {
    for (const input of access.inputs.values()) {
      input.onmidimessage = (event) => {
        const message = describeMessage(event.data);
        if (message) onEvent(message, event.target);
      };
    }
    onAccess(access);
  };
  access.onstatechange = bind;
  bind();
  return access;
}
