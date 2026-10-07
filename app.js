// 縦動画メーカー (Vertical Video Maker) - 16:9動画3本を縦に並べて9:16に変換
(() => {
  'use strict';

  // 状態管理
  const state = {
    videos: [null, null, null],     // HTMLVideoElement x 3
    volumes: [1, 1, 1],             // 音量 (0~1)
    muted: [false, false, false],   // ミュート状態
    isPlaying: false,
    duration: 0,
    isExporting: false,
    audioCtx: null,
    audioSources: [null, null, null],
    gainNodes: [null, null, null],
    audioDest: null
  };

  // DOM要素取得
  const canvas = document.getElementById('preview-canvas');
  const ctx = canvas.getContext('2d');
  const placeholderOverlay = document.getElementById('placeholder-overlay');
  const playBtn = document.getElementById('play-btn');
  const seekBar = document.getElementById('seek-bar');
  const timeDisplay = document.getElementById('time-display');
  const exportBtn = document.getElementById('export-btn');
  const resolutionSelect = document.getElementById('resolution-select');
  const durationSelect = document.getElementById('duration-select');
  const progressWrap = document.getElementById('progress-wrap');
  const progressFill = document.getElementById('progress-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressStatus = document.getElementById('progress-status');
  const downloadWrap = document.getElementById('download-wrap');
  const downloadLink = document.getElementById('download-link');

  // 初期化
  function init() {
    setupSlots();
    setupControls();
    updateCanvasResolution();
    requestAnimationFrame(renderLoop);
  }

  // 解像度更新
  function updateCanvasResolution() {
    const [w, h] = resolutionSelect.value.split('x').map(Number);
    canvas.width = w;
    canvas.height = h;
  }

  // スロット設定
  function setupSlots() {
    for (let i = 0; i < 3; i++) {
      const idx = i;
      const fileInput = document.getElementById(`file-${idx}`);
      const dropZone = document.getElementById(`drop-zone-${idx}`);
      const volSlider = document.getElementById(`vol-${idx}`);
      const muteBtn = document.getElementById(`mute-${idx}`);

      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) loadVideo(idx, e.target.files[0]);
      });

      // ドラッグ&ドロップ
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          loadVideo(idx, e.dataTransfer.files[0]);
        }
      });

      // 音量 & ミュート
      volSlider.addEventListener('input', (e) => {
        state.volumes[idx] = parseFloat(e.target.value);
        updateGain(idx);
      });

      muteBtn.addEventListener('click', () => {
        state.muted[idx] = !state.muted[idx];
        muteBtn.textContent = state.muted[idx] ? '🔇' : '🔊';
        updateGain(idx);
      });
    }
  }

  // 動画ロード
  function loadVideo(index, fileOrBlob, customName = null) {
    const url = URL.createObjectURL(fileOrBlob);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    video.onloadedmetadata = () => {
      // 古いリソース解放
      if (state.videos[index]) URL.revokeObjectURL(state.videos[index].src);

      state.videos[index] = video;
      const displayName = customName || fileOrBlob.name || `動画 ${index + 1}`;
      document.getElementById(`filename-${index}`).textContent = displayName;
      document.querySelector(`.slot-card[data-slot="${index}"]`).classList.add('loaded');
      document.getElementById(`controls-${index}`).classList.remove('hidden');

      initAudioNode(index, video);
      updateTotalDuration();
      checkReadyState();
    };
  }

  // Web Audioのセットアップ
  function initAudioNode(index, video) {
    if (!state.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new AudioContext();
      state.audioDest = state.audioCtx.createMediaStreamDestination();
    }
    try {
      if (!state.audioSources[index]) {
        const source = state.audioCtx.createMediaElementSource(video);
        const gain = state.audioCtx.createGain();
        source.connect(gain);
        gain.connect(state.audioCtx.destination);
        gain.connect(state.audioDest);

        state.audioSources[index] = source;
        state.gainNodes[index] = gain;
      }
      updateGain(index);
    } catch (e) {
      // 一部環境でMediaElementAudioSourceNodeの再接続制限を吸収
      console.warn('Audio setup notice:', e);
    }
  }

  function updateGain(index) {
    if (state.gainNodes[index]) {
      const vol = state.muted[index] ? 0 : state.volumes[index];
      state.gainNodes[index].gain.value = vol;
    }
    if (state.videos[index]) {
      state.videos[index].volume = state.muted[index] ? 0 : state.volumes[index];
    }
  }

  // 全体再生時間の計算
  function updateTotalDuration() {
    const loaded = state.videos.filter(Boolean);
    if (loaded.length === 0) return;

    const durations = loaded.map(v => v.duration).filter(d => !isNaN(d) && d > 0);
    if (durations.length === 0) return;

    state.duration = durationSelect.value === 'longest' 
      ? Math.max(...durations) 
      : Math.min(...durations);

    timeDisplay.textContent = `00:00 / ${formatTime(state.duration)}`;
  }

  // 準備完了チェック
  function checkReadyState() {
    const loadedCount = state.videos.filter(Boolean).length;
    const allReady = loadedCount === 3;
    playBtn.disabled = loadedCount === 0;
    seekBar.disabled = loadedCount === 0;
    exportBtn.disabled = !allReady;

    if (loadedCount > 0) {
      placeholderOverlay.classList.add('hidden');
    }
  }

  // コントロールUIの設定
  function setupControls() {
    resolutionSelect.addEventListener('change', updateCanvasResolution);
    durationSelect.addEventListener('change', updateTotalDuration);

    playBtn.addEventListener('click', togglePlay);

    seekBar.addEventListener('input', (e) => {
      const targetTime = (parseFloat(e.target.value) / 100) * state.duration;
      state.videos.forEach(v => {
        if (v) v.currentTime = targetTime % (v.duration || targetTime);
      });
      timeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(state.duration)}`;
    });
    
    exportBtn.addEventListener('click', startExport);

    const demoBtn = document.getElementById('demo-btn');
    if (demoBtn) {
      demoBtn.addEventListener('click', loadDemoVideos);
    }
  }

  // デモ用サンプル動画の自動読み込み
  async function loadDemoVideos() {
    const demoBtn = document.getElementById('demo-btn');
    if (demoBtn) demoBtn.disabled = true;

    const sampleFiles = [
      { path: 'samples/sample_top.mp4', name: 'sample_top.mp4 (赤)' },
      { path: 'samples/sample_mid.mp4', name: 'sample_mid.mp4 (青)' },
      { path: 'samples/sample_bot.mp4', name: 'sample_bot.mp4 (緑)' }
    ];

    try {
      for (let i = 0; i < sampleFiles.length; i++) {
        const item = sampleFiles[i];
        const res = await fetch(item.path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        loadVideo(i, blob, item.name);
      }
    } catch (err) {
      console.error('サンプル動画の読み込みに失敗しました:', err);
      alert('サンプル動画の読み込みに失敗しました。ローカルサーバー（http://localhost:...）で起動しているか確認してください。');
    } finally {
      if (demoBtn) demoBtn.disabled = false;
    }
  }

  function togglePlay() {
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
    if (state.isPlaying) {
      pauseAll();
    } else {
      playAll();
    }
  }

  function playAll() {
    state.isPlaying = true;
    playBtn.querySelector('.icon').textContent = '⏸';
    playBtn.querySelector('.label').textContent = '一時停止';
    state.videos.forEach(v => {
      if (v) {
        if (v.currentTime >= (v.duration || state.duration)) v.currentTime = 0;
        v.play().catch(() => {});
      }
    });
  }

  function pauseAll() {
    state.isPlaying = false;
    playBtn.querySelector('.icon').textContent = '▶';
    playBtn.querySelector('.label').textContent = '再生';
    state.videos.forEach(v => {
      if (v) v.pause();
    });
  }

  // Canvas描画ループ（リアルタイムプレビュー）
  function renderLoop() {
    drawFrame();
    updateTimeline();
    requestAnimationFrame(renderLoop);
  }

  // 各フレームの描画処理（左右中央クロップで隙間なく埋める）
  function drawFrame() {
    const w = canvas.width;
    const h = canvas.height;
    const slotHeight = h / 3;
    const slotRatio = w / slotHeight; // 1080 / 640 = 1.6875

    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 3; i++) {
      const vid = state.videos[i];
      const slotY = i * slotHeight;

      if (vid && vid.readyState >= 2) {
        const vidRatio = vid.videoWidth / vid.videoHeight;

        // 1. 背景レイヤー: 拡大＆ぼかし（Blur）で上下の余白を埋める
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, slotY, w, slotHeight);
        ctx.clip(); // スロット範囲外にはみ出さないようクリッピング

        // ブラー境界の抜けを防ぐため少し拡大 (1.2倍)
        const scale = 1.2;
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
        const fgH = fgW / vidRatio; // 16:9動画なら約 607.5px
        const fgY = slotY + (slotHeight - fgH) / 2; // 上下中央配置

        ctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight, 0, fgY, fgW, fgH);
      } else {
        // 空スロットのプレースホルダー枠
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fillRect(4, slotY + 4, w - 8, slotHeight - 8);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.font = `${Math.floor(w / 35)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labels = ['上段 (Top)', '中段 (Middle)', '下段 (Bottom)'];
        ctx.fillText(labels[i], w / 2, slotY + slotHeight / 2);
      }

      // スロット境界の極細ライン
      if (i > 0) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, slotY - 1, w, 2);
      }
    }
  }

  // タイムラインとループ同期
  function updateTimeline() {
    if (!state.isPlaying || state.duration === 0) return;

    // 基準時間の取得（最長動画または再生中の動画基準）
    const primaryVid = state.videos.find(v => v && !v.paused) || state.videos.find(Boolean);
    if (!primaryVid) return;

    const cur = primaryVid.currentTime;
    seekBar.value = (cur / state.duration) * 100;
    timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(state.duration)}`;

    // 各動画のループ処理
    state.videos.forEach(v => {
      if (v && v.ended) {
        if (durationSelect.value === 'longest') {
          v.currentTime = 0;
          v.play().catch(() => {});
        }
      }
    });

    // 終了判定
    if (cur >= state.duration) {
      pauseAll();
      seekBar.value = 0;
      state.videos.forEach(v => { if (v) v.currentTime = 0; });
    }
  }

  // 書き出し（エクスポート）
  async function startExport() {
    if (state.isExporting) return;
    state.isExporting = true;
    exportBtn.disabled = true;
    playBtn.disabled = true;
    seekBar.disabled = true;
    downloadWrap.classList.add('hidden');
    progressWrap.classList.remove('hidden');

    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      await state.audioCtx.resume();
    }

    // 全動画を先頭に戻す
    state.videos.forEach(v => {
      if (v) v.currentTime = 0;
    });

    // MediaStreamの生成（Canvas映像 + Web Audio音声）
    const canvasStream = canvas.captureStream(30); // 30fps
    const combinedTracks = [...canvasStream.getVideoTracks()];

    if (state.audioDest && state.audioDest.stream.getAudioTracks().length > 0) {
      combinedTracks.push(...state.audioDest.stream.getAudioTracks());
    }

    const finalStream = new MediaStream(combinedTracks);

    // 最適なmimeTypeの決定
    const mimeTypes = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    let selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';
    const isMp4 = selectedMime.includes('mp4');

    const recorder = new MediaRecorder(finalStream, {
      mimeType: selectedMime,
      videoBitsPerSecond: canvas.width >= 1080 ? 8000000 : 4000000 // 8Mbps or 4Mbps
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
        動画を保存 (${ext.toUpperCase()})
      `;

      progressWrap.classList.add('hidden');
      downloadWrap.classList.remove('hidden');

      state.isExporting = false;
      exportBtn.disabled = false;
      playBtn.disabled = false;
      seekBar.disabled = false;
      pauseAll();
    };

    // 再生と録画を開始
    recorder.start(100);
    playAll();

    // 録画進行監視
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

  // 時間フォーマット補助 (秒 -> mm:ss)
  function formatTime(sec) {
    if (isNaN(sec) || sec <= 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // 起動
  window.addEventListener('DOMContentLoaded', init);
})();
