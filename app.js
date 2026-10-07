// Vertical Video Maker - 1つの16:9動画を縦に3段配置（上下ブラー背景＋単一音声）
(() => {
  'use strict';

  // 状態管理 (単一動画・単一音声にスリム化)
  const state = {
    video: null,
    volume: 1,
    muted: false,
    isPlaying: false,
    duration: 0,
    isExporting: false,
    audioCtx: null,
    audioSource: null,
    gainNode: null,
    audioDest: null
  };

  // DOM要素
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

  // ファイルアップロード関連イベント
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

  // デモ用動画の読み込み
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

  // Web Audioのセットアップ (単一音声)
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

  // リアルタイム描画ループ
  function renderLoop() {
    drawFrame();
    updateTimeline();
    requestAnimationFrame(renderLoop);
  }

  // 単一の動画から上・中・下の3段を描画
  function drawFrame() {
    const w = canvas.width;
    const h = canvas.height;
    const slotHeight = h / 3;
    const slotRatio = w / slotHeight; // 1080 / 640 = 1.6875

    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, w, h);

    const vid = state.video;
    const isReady = vid && vid.readyState >= 2;

    for (let i = 0; i < 3; i++) {
      const slotY = i * slotHeight;

      if (isReady) {
        const vidRatio = vid.videoWidth / vid.videoHeight;

        // 1. 背景レイヤー: 拡大＆ぼかし（Blur 25px + 減光）で上下の余白を埋める
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, slotY, w, slotHeight);
        ctx.clip(); // スロット範囲外にはみ出さないようクリッピング

        const scale = 1.25;
        let bgW, bgH;
        if (vidRatio > slotRatio) {
          bgH = slotHeight * scale;
          bgW = bgH * vidRatio;
        } else {
          bgW = w * scale;
          bgH = bgW / vidRatio;
        }
        const bgX = (w - bgW) / 2;
        const bgY = slotY + (slotHeight - bgH) / 2;

        ctx.filter = 'blur(25px) brightness(0.65)';
        ctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight, bgX, bgY, bgW, bgH);
        ctx.restore();

        // 2. 前景レイヤー: 左右ピッタリ（幅100%）、クロップなしで16:9比率を完全保持
        const fgW = w;
        const fgH = fgW / vidRatio; // 16:9なら約 607.5px
        const fgY = slotY + (slotHeight - fgH) / 2;

        ctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight, 0, fgY, fgW, fgH);
      } else {
        // 未読み込み時のプレースホルダー
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fillRect(4, slotY + 4, w - 8, slotHeight - 8);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.font = `${Math.floor(w / 35)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labels = ['上段 (Top)', '中段 (Middle)', '下段 (Bottom)'];
        ctx.fillText(labels[i], w / 2, slotY + slotHeight / 2);
      }

      // スロット境界ライン
      if (i > 0) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, slotY - 1, w, 2);
      }
    }
  }

  // 再生タイムライン更新
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

  // 動画書き出し（MediaRecorder + 単一音声ストリーム）
  async function startExport() {
    if (state.isExporting || !state.video) return;
    state.isExporting = true;
    exportBtn.disabled = true;
    playBtn.disabled = true;
    seekBar.disabled = true;
    downloadWrap.classList.add('hidden');
    progressWrap.classList.remove('hidden');

    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      await state.audioCtx.resume();
    }

    state.video.currentTime = 0;

    // ストリーム合成 (Canvas映像 + 単一の音声トラック)
    const canvasStream = canvas.captureStream(30);
    const combinedTracks = [...canvasStream.getVideoTracks()];

    if (state.audioDest && state.audioDest.stream.getAudioTracks().length > 0) {
      combinedTracks.push(...state.audioDest.stream.getAudioTracks());
    }

    const finalStream = new MediaStream(combinedTracks);

    const mimeTypes = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    const selectedMime = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
    const isMp4 = selectedMime.includes('mp4');

    const recorder = new MediaRecorder(finalStream, {
      mimeType: selectedMime,
      videoBitsPerSecond: canvas.width >= 1080 ? 8000000 : 4000000
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: selectedMime });
      const videoUrl = URL.createObjectURL(blob);
      const ext = isMp4 ? 'mp4' : 'webm';

      downloadLink.href = videoUrl;
      downloadLink.download = `vertical-9x16-${Date.now()}.${ext}`;
      downloadLink.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
        完成した動画を保存 (${ext.toUpperCase()})
      `;

      progressWrap.classList.add('hidden');
      downloadWrap.classList.remove('hidden');

      state.isExporting = false;
      exportBtn.disabled = false;
      playBtn.disabled = false;
      seekBar.disabled = false;
      pauseVideo();
    };

    recorder.start(100);
    playVideo();

    const startTime = performance.now();
    const totalMs = state.duration * 1000;

    const progressInterval = setInterval(() => {
      if (!state.isExporting) {
        clearInterval(progressInterval);
        return;
      }
      const elapsed = performance.now() - startTime;
      const percent = Math.min(100, Math.floor((elapsed / totalMs) * 100));
      progressFill.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}%`;

      if (elapsed >= totalMs) {
        clearInterval(progressInterval);
        recorder.stop();
      }
    }, 100);
  }

  function formatTime(sec) {
    if (isNaN(sec) || sec <= 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  window.addEventListener('DOMContentLoaded', init);
})();
