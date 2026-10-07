// Vertical Video Maker - 1つの16:9動画から9:16縦動画を作成
// オフライン・コマ送りエンコード（ガタつき完全防止）& Apple写真アプリ保存対応
(() => {
  'use strict';

  // 状態管理
  const state = {
    video: null,
    currentFile: null,
    volume: 1,
    muted: false,
    isPlaying: false,
    duration: 0,
    isExporting: false,
    generatedBlob: null,
    audioCtx: null,
    audioSource: null,
    gainNode: null,
    audioDest: null
  };

  // DOM要素取得
  const canvas = document.getElementById('preview-canvas');
  const ctx = canvas.getContext('2d');
  const placeholderOverlay = document.getElementById('placeholder-overlay');
  const fileInput = document.getElementById('video-file-input');
  const dropZone = document.getElementById('drop-zone');
  const uploadCard = document.getElementById('upload-card');
  const fileStatus = document.getElementById('file-status');
  const fileInfo = document.getElementById('file-info');
  const audioControlRow = document.getElementById('audio-control-row');
  const volSlider = document.getElementById('vol-slider');
  const muteBtn = document.getElementById('mute-btn');
  const playBtn = document.getElementById('play-btn');
  const seekBar = document.getElementById('seek-bar');
  const timeDisplay = document.getElementById('time-display');
  const exportBtn = document.getElementById('export-btn');
  const resolutionSelect = document.getElementById('resolution-select');
  const progressWrap = document.getElementById('progress-wrap');
  const progressFill = document.getElementById('progress-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressStatus = document.getElementById('progress-status');
  const downloadWrap = document.getElementById('download-wrap');
  const shareBtn = document.getElementById('share-btn');
  const downloadLink = document.getElementById('download-link');
  const demoBtn = document.getElementById('demo-btn');

  function init() {
    setupUploadEvents();
    setupControls();
    updateCanvasResolution();
    requestAnimationFrame(renderLoop);
  }

  function updateCanvasResolution() {
    const [w, h] = resolutionSelect.value.split('x').map(Number);
    canvas.width = w;
    canvas.height = h;
  }

  // ファイル入力イベント
  function setupUploadEvents() {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) loadVideo(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadVideo(e.dataTransfer.files[0]);
      }
    });

    if (demoBtn) {
      demoBtn.addEventListener('click', loadDemoVideo);
    }
  }

  // 動画読み込み処理
  function loadVideo(fileOrBlob, customName = null) {
    state.currentFile = fileOrBlob;
    const url = URL.createObjectURL(fileOrBlob);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    video.onloadedmetadata = () => {
      if (state.video) URL.revokeObjectURL(state.video.src);

      state.video = video;
      state.duration = video.duration || 0;

      const name = customName || fileOrBlob.name || 'video.mp4';
      fileStatus.textContent = name;
      fileInfo.textContent = `${video.videoWidth}×${video.videoHeight} (${formatTime(state.duration)})`;
      uploadCard.classList.add('loaded');
      audioControlRow.classList.remove('hidden');
      placeholderOverlay.classList.add('hidden');

      initAudioNode(video);

      playBtn.disabled = false;
      seekBar.disabled = false;
      exportBtn.disabled = false;
      timeDisplay.textContent = `00:00 / ${formatTime(state.duration)}`;
    };
  }

  // デモ用動画読み込み
  async function loadDemoVideo() {
    if (demoBtn) demoBtn.disabled = true;
    try {
      const res = await fetch('samples/sample_top.mp4');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      loadVideo(blob, 'sample_top.mp4 (サンプル)');
    } catch (e) {
      alert('サンプル動画の読み込みに失敗しました。ローカルサーバー経由でアクセスしてください。');
    } finally {
      if (demoBtn) demoBtn.disabled = false;
    }
  }

  // Web Audioセットアップ (プレビュー用)
  function initAudioNode(video) {
    if (!state.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new AudioCtx();
      state.audioDest = state.audioCtx.createMediaStreamDestination();
    }
    try {
      if (!state.audioSource) {
        state.audioSource = state.audioCtx.createMediaElementSource(video);
        state.gainNode = state.audioCtx.createGain();
        state.audioSource.connect(state.gainNode);
        state.gainNode.connect(state.audioCtx.destination);
        state.gainNode.connect(state.audioDest);
      }
      updateGain();
    } catch (e) {
      console.warn('Audio setup:', e);
    }
  }

  function updateGain() {
    const val = state.muted ? 0 : state.volume;
    if (state.gainNode) state.gainNode.gain.value = val;
    if (state.video) state.video.volume = val;
  }

  // コントロールUIの設定
  function setupControls() {
    resolutionSelect.addEventListener('change', updateCanvasResolution);

    volSlider.addEventListener('input', (e) => {
      state.volume = parseFloat(e.target.value);
      updateGain();
    });

    muteBtn.addEventListener('click', () => {
      state.muted = !state.muted;
      muteBtn.textContent = state.muted ? '🔇' : '🔊';
      updateGain();
    });

    playBtn.addEventListener('click', togglePlay);

    seekBar.addEventListener('input', (e) => {
      if (!state.video) return;
      const targetTime = (parseFloat(e.target.value) / 100) * state.duration;
      state.video.currentTime = targetTime;
      timeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(state.duration)}`;
    });

    exportBtn.addEventListener('click', startExport);
    shareBtn.addEventListener('click', handleShareToPhotos);
  }

  function togglePlay() {
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
    if (state.isPlaying) {
      pauseVideo();
    } else {
      playVideo();
    }
  }

  function playVideo() {
    if (!state.video) return;
    state.isPlaying = true;
    playBtn.querySelector('.icon').textContent = '⏸';
    playBtn.querySelector('.label').textContent = '一時停止';
    if (state.video.currentTime >= state.duration) state.video.currentTime = 0;
    state.video.play().catch(() => {});
  }

  function pauseVideo() {
    if (!state.video) return;
    state.isPlaying = false;
    playBtn.querySelector('.icon').textContent = '▶';
    playBtn.querySelector('.label').textContent = '再生';
    state.video.pause();
  }

  // リアルタイム描画ループ（プレビュー用）
  function renderLoop() {
    if (!state.isExporting) {
      drawFrame();
      updateTimeline();
    }
    requestAnimationFrame(renderLoop);
  }

  // 3段すべてクリアな16:9動画（計1822.5px）＋ 一番下の余白（97.5px）にぼかし背景を配置
  function drawFrame() {
    const w = canvas.width;
    const h = canvas.height;

    // 16:9動画の1段あたりの高さ (1080px幅なら 607.5px)
    const hVid = (w * 9) / 16;
    const total3VidHeight = hVid * 3; // 1822.5px
    const blankY = total3VidHeight;   // 最下部余白開始位置 (1822.5px)
    const blankH = h - blankY;        // 最下部余白の高さ (97.5px)

    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, w, h);

    const vid = state.video;
    const isReady = vid && vid.readyState >= 2;

    if (isReady) {
      const vidRatio = vid.videoWidth / vid.videoHeight;

      // 1. 一番下の動画の下にできた空白（余白）にぼかし背景を配置
      if (blankH > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, blankY, w, blankH);
        ctx.clip(); // 余白エリアにのみクリッピング

        const scale = 1.3;
        const slotRatio = w / blankH;
        let bgW, bgH;
        if (vidRatio > slotRatio) {
          bgH = blankH * scale;
          bgW = bgH * vidRatio;
        } else {
          bgW = w * scale;
          bgH = bgW / vidRatio;
        }
        const bgX = (w - bgW) / 2;
        const bgY = blankY + (blankH - bgH) / 2;

        ctx.filter = 'blur(25px) brightness(0.65)';
        ctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight, bgX, bgY, bgW, bgH);
        ctx.restore();
      }

      // 2. 3本のクリアな16:9通常動画を上から順に隙間なく連続描画 (一番下もぼかさない！)
      // 上段 (1本目)
      ctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight, 0, 0, w, hVid);
      // 中段 (2本目)
      ctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight, 0, hVid, w, hVid);
      // 下段 (3本目 - ぼかさずクリアなまま！)
      ctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight, 0, hVid * 2, w, hVid);

      // 各段の境界線
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(0, hVid - 1, w, 2);
      ctx.fillRect(0, hVid * 2 - 1, w, 2);
      if (blankH > 0) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, blankY - 1, w, 2);
      }
    } else {
      // 未読み込み時のプレースホルダー枠
      const sections = [
        { y: 0, height: hVid, label: '上段 (16:9 通常クリア)' },
        { y: hVid, height: hVid, label: '中段 (16:9 通常クリア)' },
        { y: hVid * 2, height: hVid, label: '下段 (16:9 通常クリア)' },
        { y: blankY, height: blankH, label: '最下部余白 (ぼかし背景)' }
      ];

      sections.forEach((sec, idx) => {
        if (sec.height <= 0) return;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fillRect(4, sec.y + 4, w - 8, sec.height - 8);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.font = `${Math.floor(w / 38)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sec.label, w / 2, sec.y + sec.height / 2);

        if (idx > 0) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(0, sec.y - 1, w, 2);
        }
      });
    }
  }

  function updateTimeline() {
    if (!state.isPlaying || !state.video || state.duration === 0) return;

    const cur = state.video.currentTime;
    seekBar.value = (cur / state.duration) * 100;
    timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(state.duration)}`;

    if (state.video.ended || cur >= state.duration) {
      pauseVideo();
      seekBar.value = 0;
      state.video.currentTime = 0;
    }
  }

  // シーク完了を確実に待機するヘルパー
  function seekVideo(video, time) {
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 0.005) {
        resolve();
        return;
      }
      let timeoutId;
      const onSeeked = () => {
        clearTimeout(timeoutId);
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      timeoutId = setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }, 1000); // 1秒タイムアウト安全策
      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = time;
    });
  }

  // 書き出しエントリーポイント
  async function startExport() {
    if (state.isExporting || !state.video) return;
    pauseVideo();

    state.isExporting = true;
    exportBtn.disabled = true;
    playBtn.disabled = true;
    seekBar.disabled = true;
    downloadWrap.classList.add('hidden');
    progressWrap.classList.remove('hidden');

    // WebCodecs + Mp4Muxer によるオフラインレンダリングを試行
    const hasWebCodecs = typeof window.VideoEncoder !== 'undefined' && typeof window.Mp4Muxer !== 'undefined';

    try {
      if (hasWebCodecs) {
        await exportWithWebCodecs();
      } else {
        await exportWithMediaRecorder();
      }
    } catch (err) {
      console.error('Export error, fallback:', err);
      await exportWithMediaRecorder();
    } finally {
      state.isExporting = false;
      exportBtn.disabled = false;
      playBtn.disabled = false;
      seekBar.disabled = false;
      state.video.currentTime = 0;
      drawFrame();
    }
  }

  // オフライン・コマ送りエンコード（WebCodecs + Mp4Muxer: 完全な滑らかさ & Apple写真アプリ対応）
  async function exportWithWebCodecs() {
    const w = canvas.width;
    const h = canvas.height;
    const fps = 30;
    const totalFrames = Math.max(1, Math.round(state.duration * fps));

    progressStatus.textContent = '動画解析中...';
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';

    // 音声の事前デコード
    let audioBuffer = null;
    try {
      if (state.currentFile) {
        const arrayBuf = await state.currentFile.arrayBuffer();
        const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioBuffer = await tempCtx.decodeAudioData(arrayBuf);
      }
    } catch (e) {
      console.warn('Audio decoding skipped:', e);
    }

    const hasAudio = audioBuffer && audioBuffer.numberOfChannels > 0 && typeof window.AudioEncoder !== 'undefined';

    // MP4マルチプレクサの作成 (FastStart: Apple写真アプリで即座に認識される構造)
    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: w, height: h },
      audio: hasAudio ? {
        codec: 'aac',
        numberOfChannels: Math.min(2, audioBuffer.numberOfChannels),
        sampleRate: audioBuffer.sampleRate
      } : undefined,
      fastStart: 'in-memory'
    });

    // ビデオエンコーダーの初期化
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('VideoEncoder error:', e)
    });
    videoEncoder.configure({
      codec: 'avc1.420034',
      width: w,
      height: h,
      bitrate: w >= 1080 ? 10_000_000 : 5_000_000,
      framerate: fps
    });

    // 音声エンコーダーとエンコード（映像より先に処理）
    if (hasAudio) {
      try {
        const audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => console.error('AudioEncoder error:', e)
        });
        const channels = Math.min(2, audioBuffer.numberOfChannels);
        audioEncoder.configure({
          codec: 'mp4a.40.2',
          numberOfChannels: channels,
          sampleRate: audioBuffer.sampleRate,
          bitrate: 128_000
        });

        const chunkSize = 2048;
        const totalSamples = audioBuffer.length;
        for (let offset = 0; offset < totalSamples; offset += chunkSize) {
          const count = Math.min(chunkSize, totalSamples - offset);
          const planarData = new Float32Array(count * channels);
          for (let ch = 0; ch < channels; ch++) {
            planarData.set(audioBuffer.getChannelData(ch).subarray(offset, offset + count), ch * count);
          }
          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: audioBuffer.sampleRate,
            numberOfFrames: count,
            numberOfChannels: channels,
            timestamp: Math.round((offset / audioBuffer.sampleRate) * 1_000_000),
            data: planarData
          });
          audioEncoder.encode(audioData);
          audioData.close();
        }
        await audioEncoder.flush();
      } catch (err) {
        console.warn('Audio encode failed:', err);
      }
    }

    // OffscreenCanvas でバックグラウンドレンダリング（プレビューに影響なし）
    const offscreen = new OffscreenCanvas(w, h);
    const offCtx = offscreen.getContext('2d');

    progressStatus.textContent = 'バックグラウンドレンダリング中...';

    for (let i = 0; i < totalFrames; i++) {
      const t = i / fps;

      // シークして実際のフレームがデコードされるまで待機
      await seekVideo(state.video, t);

      // createImageBitmap でビデオフレームが確実にデコードされたことを保証
      const bmp = await createImageBitmap(state.video);

      // OffscreenCanvas に描画（プレビューキャンバスとは独立）
      drawFrameToCtx(offCtx, w, h, bmp);
      bmp.close();

      const timestampMicros = Math.round(t * 1_000_000);
      const videoFrame = new VideoFrame(offscreen, { timestamp: timestampMicros });
      videoEncoder.encode(videoFrame, { keyFrame: i % (fps * 2) === 0 });
      videoFrame.close();

      const pct = Math.floor(((i + 1) / totalFrames) * 100);
      progressFill.style.width = `${pct}%`;
      progressPercent.textContent = `${pct}% (${i + 1}/${totalFrames}コマ)`;

      // UIをブロックしないよう定期的にブレーク
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
    }

    progressStatus.textContent = 'MP4ファイル生成中...';
    await videoEncoder.flush();
    muxer.finalize();

    const buffer = muxer.target.buffer;
    const mp4Blob = new Blob([buffer], { type: 'video/mp4' });
    onExportComplete(mp4Blob, 'mp4');
  }

  // ImageBitmap を使ってオフスクリーンに描画（drawFrameの汎用版）
  function drawFrameToCtx(offCtx, w, h, bmp) {
    const hVid = (w * 9) / 16;
    const total3VidHeight = hVid * 3;
    const blankY = total3VidHeight;
    const blankH = h - blankY;

    offCtx.fillStyle = '#0a0d14';
    offCtx.fillRect(0, 0, w, h);

    if (!bmp) return;

    const vidRatio = bmp.width / bmp.height;

    // ぼかし背景（余白部分）
    if (blankH > 0) {
      offCtx.save();
      offCtx.beginPath();
      offCtx.rect(0, blankY, w, blankH);
      offCtx.clip();
      const scale = 1.3;
      const slotRatio = w / blankH;
      let bgW, bgH;
      if (vidRatio > slotRatio) {
        bgH = blankH * scale;
        bgW = bgH * vidRatio;
      } else {
        bgW = w * scale;
        bgH = bgW / vidRatio;
      }
      const bgX = (w - bgW) / 2;
      const bgY = blankY + (blankH - bgH) / 2;
      offCtx.filter = 'blur(25px) brightness(0.65)';
      offCtx.drawImage(bmp, bgX, bgY, bgW, bgH);
      offCtx.restore();
    }

    // 3段クリア動画
    offCtx.drawImage(bmp, 0, 0, w, hVid);
    offCtx.drawImage(bmp, 0, hVid, w, hVid);
    offCtx.drawImage(bmp, 0, hVid * 2, w, hVid);

    // 境界線
    offCtx.fillStyle = 'rgba(0,0,0,0.4)';
    offCtx.fillRect(0, hVid - 1, w, 2);
    offCtx.fillRect(0, hVid * 2 - 1, w, 2);
    if (blankH > 0) {
      offCtx.fillStyle = 'rgba(0,0,0,0.5)';
      offCtx.fillRect(0, blankY - 1, w, 2);
    }
  }

  // フォールバック: MediaRecorderによるリアルタイム録画
  function exportWithMediaRecorder() {
    return new Promise((resolve) => {
      progressStatus.textContent = 'リアルタイム記録中...';
      state.video.currentTime = 0;

      const canvasStream = canvas.captureStream(30);
      const tracks = [...canvasStream.getVideoTracks()];
      if (state.audioDest && state.audioDest.stream.getAudioTracks().length > 0) {
        tracks.push(...state.audioDest.stream.getAudioTracks());
      }
      const stream = new MediaStream(tracks);

      const mime = 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"';
      const actualMime = MediaRecorder.isTypeSupported(mime) ? mime : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: actualMime, videoBitsPerSecond: 8000000 });

      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const isMp4 = actualMime.includes('mp4');
        const blob = new Blob(chunks, { type: actualMime });
        onExportComplete(blob, isMp4 ? 'mp4' : 'webm');
        resolve();
      };

      recorder.start(100);
      playVideo();

      const start = performance.now();
      const totalMs = state.duration * 1000;
      const interval = setInterval(() => {
        const elapsed = performance.now() - start;
        const pct = Math.min(100, Math.floor((elapsed / totalMs) * 100));
        progressFill.style.width = `${pct}%`;
        progressPercent.textContent = `${pct}%`;
        if (elapsed >= totalMs) {
          clearInterval(interval);
          recorder.stop();
          pauseVideo();
        }
      }, 100);
    });
  }

  // 書き出し完了時の処理
  function onExportComplete(blob, ext) {
    state.generatedBlob = blob;
    const url = URL.createObjectURL(blob);
    const filename = `vertical-9x16-${Date.now()}.${ext}`;

    downloadLink.href = url;
    downloadLink.download = filename;
    downloadLink.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      ファイルとして保存 (${ext.toUpperCase()})
    `;

    progressWrap.classList.add('hidden');
    downloadWrap.classList.remove('hidden');
  }

  // Apple写真アプリへの保存（Web Share API）
  async function handleShareToPhotos() {
    if (!state.generatedBlob) return;
    const file = new File([state.generatedBlob], `vertical-9x16-${Date.now()}.mp4`, { type: 'video/mp4' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: '9:16縦動画',
          text: '写真アプリに保存するには「ビデオを保存」を選択してください。'
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Share error:', err);
        }
      }
    } else {
      alert('このブラウザ/端末は写真アプリへの直接共有に対応していません。\n「ファイルとして保存」をクリックしてダウンロードしてください。');
    }
  }

  function formatTime(sec) {
    if (isNaN(sec) || sec <= 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  window.addEventListener('DOMContentLoaded', init);
})();
