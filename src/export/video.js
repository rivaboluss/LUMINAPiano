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
  let videoTrack = null;
  let chunks = [];
  let extension = 'webm';

  function start() {
    if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不能导出视频');
    const [mime, ext] = pickMime();
    extension = ext;
    const stream = canvas.captureStream(0);
    videoTrack = stream.getVideoTracks()[0] || null;
    const audio = getAudioStream();
    for (const track of audio.getAudioTracks()) stream.addTrack(track);
    chunks = [];
    const pixels = Math.max(1, canvas.width * canvas.height);
    const videoBitsPerSecond = Math.round(Math.min(6_500_000, Math.max(1_800_000, pixels * 1.8)));
    recorder = new MediaRecorder(stream, mime ? {
      mimeType: mime,
      videoBitsPerSecond,
      audioBitsPerSecond: 160_000
    } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.start(500);
    requestFrame();
    return extension;
  }

  function requestFrame() {
    if (!videoTrack || videoTrack.readyState !== 'live') return;
    try { videoTrack.requestFrame(); } catch { /* older browsers sample on their own */ }
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
        videoTrack = null;
        resolve(null);
        return;
      }
      videoTrack = null;
      current.stop();
    });
  }

  return {
    start,
    stop,
    requestFrame,
    get active() {
      return !!recorder && recorder.state === 'recording';
    },
    get ext() {
      return extension;
    }
  };
}
