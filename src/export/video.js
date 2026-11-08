function pickMime() {
  const types = [
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm']
  ];
  return types.find(([type]) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) || ['', 'webm'];
}

export function createVideoCapture(canvas, getAudioStream) {
  let recorder = null;
  let chunks = [];
  let extension = 'webm';

  function start() {
    if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不能导出视频');
    const [mime, ext] = pickMime();
    extension = ext;
    const stream = canvas.captureStream(60);
    const audio = getAudioStream();
    for (const track of audio.getAudioTracks()) stream.addTrack(track);
    chunks = [];
    recorder = new MediaRecorder(stream, mime ? {
      mimeType: mime,
      videoBitsPerSecond: 10_000_000,
      audioBitsPerSecond: 160_000
    } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.start(200);
    return extension;
  }

  function stop() {
    return new Promise((resolve, reject) => {
      if (!recorder) {
        resolve(null);
        return;
      }
      const current = recorder;
      const type = current.mimeType || (extension === 'mp4' ? 'video/mp4' : 'video/webm');
      current.onerror = () => reject(new Error('视频录制失败'));
      current.onstop = () => {
        const blob = new Blob(chunks, { type });
        chunks = [];
        recorder = null;
        resolve(blob);
      };
      if (current.state === 'inactive') {
        recorder = null;
        resolve(null);
        return;
      }
      current.stop();
    });
  }

  return {
    start,
    stop,
    get active() {
      return !!recorder && recorder.state === 'recording';
    },
    get ext() {
      return extension;
    }
  };
}
