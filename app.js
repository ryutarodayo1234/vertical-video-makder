// Vertical Video Maker - 1つの16:9動画から9:16縦動画を作成
// シーク同期・動画コマ送りエンコード修復版
(() => {
  'use strict';

  // Safari判定 & ctx.filter サポート確認
  const supportsCanvasFilter = (() => {
    try {
      const t = document.createElement('canvas').getContext('2d');
      t.filter = 'blur(1px)';
      return t.filter === 'blur(1px)';
    } catch { return false; }
  })();

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
    if (state.isPlaying) pauseVideo();
    state.currentFile = fileOrBlob;
    const url = URL.createObjectURL(fileOrBlob);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.muted = state.muted;
    video.preload = 'auto';
    video.src = url;

    video.onloadedmetadata = () => {
      if (state.video && state.video !== video) {
        URL.revokeObjectURL(state.video.src);
      }

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

    video.onerror = () => {
      alert('動画ファイルの読み込みに失敗しました。他のフォーマット(MP4等)をお試しください。');
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

  async function togglePlay() {
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      await state.audioCtx.resume();
    }
    if (state.isPlaying) {
      pauseVideo();
    } else {
      await playVideo();
    }
  }

  async function playVideo() {
    if (!state.video) return;
    if (state.video.currentTime >= state.duration) {
      state.video.currentTime = 0;
    }
    try {
      await state.video.play();
      state.isPlaying = true;
      playBtn.querySelector('.icon').textContent = '⏸';
      playBtn.querySelector('.label').textContent = '一時停止';
    } catch (err) {
      console.warn('Playback prevented:', err);
      state.isPlaying = false;
    }
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
      drawFrameToCtx(ctx, canvas.width, canvas.height, state.video);
      updateTimeline();
    }
    requestAnimationFrame(renderLoop);
  }

  // 共通描画関数（プレビュー・エンコード両用）
  function drawFrameToCtx(c, w, h, src) {
    const hVid = (w * 9) / 16;
    const blankY = hVid * 3;
    const blankH = Math.max(0, h - blankY);

    c.fillStyle = '#0a0d14';
    c.fillRect(0, 0, w, h);

    const isReady = src instanceof HTMLVideoElement ? src.readyState >= 2 : !!src;

    if (!isReady) {
      const sections = [
        { y: 0,        height: hVid,   label: '上段 (16:9 通常クリア)' },
        { y: hVid,     height: hVid,   label: '中段 (16:9 通常クリア)' },
        { y: hVid * 2, height: hVid,   label: '下段 (16:9 通常クリア)' },
        { y: blankY,   height: blankH, label: '最下部余白 (ぼかし背景)' }
      ];
      sections.forEach((sec, idx) => {
        if (sec.height <= 0) return;
        c.fillStyle = 'rgba(255,255,255,0.03)';
        c.fillRect(4, sec.y + 4, w - 8, sec.height - 8);
        c.fillStyle = 'rgba(255,255,255,0.25)';
        c.font = `${Math.floor(w / 38)}px sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(sec.label, w / 2, sec.y + sec.height / 2);
        if (idx > 0) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, sec.y - 1, w, 2); }
      });
      return;
    }

    const srcW = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
    const srcH = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
    const vidRatio = (srcW && srcH) ? srcW / srcH : 16 / 9;

    // ぼかし背景（余白部分）
    if (blankH > 0) {
      const scale = 1.3;
      const slotRatio = w / blankH;
      let bgW, bgH;
      if (vidRatio > slotRatio) { bgH = blankH * scale; bgW = bgH * vidRatio; }
      else { bgW = w * scale; bgH = bgW / vidRatio; }
      const bgX = (w - bgW) / 2;
      const bgY = blankY + (blankH - bgH) / 2;

      c.save();
      c.beginPath(); c.rect(0, blankY, w, blankH); c.clip();
      if (supportsCanvasFilter) {
        c.filter = 'blur(25px) brightness(0.65)';
        c.drawImage(src, bgX, bgY, bgW, bgH);
      } else {
        c.globalAlpha = 0.65;
        c.drawImage(src, bgX, bgY, bgW, bgH);
      }
      c.restore();
    }

    // 3段クリア動画
    c.drawImage(src, 0, 0, w, hVid);
    c.drawImage(src, 0, hVid, w, hVid);
    c.drawImage(src, 0, hVid * 2, w, hVid);

    // 境界線
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(0, hVid - 1, w, 2);
    c.fillRect(0, hVid * 2 - 1, w, 2);
    if (blankH > 0) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, blankY - 1, w, 2); }
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

  // タイムテーブル更新（シーク）を確実に同期待機
  function seekVideo(video, time) {
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 0.001) {
        resolve();
        return;
      }

      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          video.removeEventListener('seeked', done);
          // DOM / Video描画の同期用フラッシュ
          setTimeout(resolve, 20);
        }
      };

      video.addEventListener('seeked', done, { once: true });
      video.currentTime = time;

      // セーフティ用フォールバック
      setTimeout(done, 1500);
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

    const hasWebCodecs = typeof window.VideoEncoder !== 'undefined' && typeof window.Mp4Muxer !== 'undefined';

    try {
      if (hasWebCodecs) {
        await exportWithWebCodecs();
      } else {
        await exportWithMediaRecorder();
      }
    } catch (err) {
      console.warn('WebCodecs failed, fallback to MediaRecorder:', err);
      try {
        await exportWithMediaRecorder();
      } catch (e2) {
        console.error('Export error:', e2);
        alert('動画の保存に失敗しました。ブラウザを変更するか動画サイズを下げてみてください。');
      }
    } finally {
      state.isExporting = false;
      exportBtn.disabled = false;
      playBtn.disabled = false;
      seekBar.disabled = false;
      if (state.video) state.video.currentTime = 0;
    }
  }

  // コマ送りエンコード（シーク同期修正版）
  async function exportWithWebCodecs() {
    const w = canvas.width;
    const h = canvas.height;
    const fps = 30;
    const totalFrames = Math.max(1, Math.round(state.duration * fps));

    progressStatus.textContent = '動画解析中...';
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';

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

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('VideoEncoder error:', e)
    });
    videoEncoder.configure({
      codec: 'avc1.420034',
      width: w,
      height: h,
      bitrate: w >= 1080 ? 6_000_000 : 3_000_000,
      framerate: fps
    });

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

    const offCanvas = document.createElement('canvas');
    offCanvas.width = w; offCanvas.height = h;
    const offCtx = offCanvas.getContext('2d');

    progressStatus.textContent = 'レンダリング中...';

    for (let i = 0; i < totalFrames; i++) {
      const t = i / fps;
      // タイムテーブルをシークし、フレーム更新を完全同期
      await seekVideo(state.video, t);
      drawFrameToCtx(offCtx, w, h, state.video);

      const timestampMicros = Math.round(t * 1_000_000);
      const videoFrame = new VideoFrame(offCanvas, { timestamp: timestampMicros });
      videoEncoder.encode(videoFrame, { keyFrame: i % fps === 0 });
      videoFrame.close();

      const pct = Math.floor(((i + 1) / totalFrames) * 100);
      progressFill.style.width = `${pct}%`;
      progressPercent.textContent = `${pct}% (${i + 1}/${totalFrames}コマ)`;

      // メインスレッドに割り込んでUI描画とシーク完了を保証
      if (i % 3 === 0) await new Promise(r => setTimeout(r, 10));
    }

    progressStatus.textContent = 'ファイル生成中...';
    await videoEncoder.flush();
    muxer.finalize();

    const mp4Blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    onExportComplete(mp4Blob, 'mp4');
  }

  // フォールバック: MediaRecorder
  function exportWithMediaRecorder() {
    return new Promise((resolve, reject) => {
      progressStatus.textContent = 'リアルタイム記録中...';
      state.video.currentTime = 0;

      const canvasStream = canvas.captureStream(30);
      const tracks = [...canvasStream.getVideoTracks()];
      if (state.audioDest && state.audioDest.stream.getAudioTracks().length > 0) {
        tracks.push(...state.audioDest.stream.getAudioTracks());
      }
      const stream = new MediaStream(tracks);

      const mimeOptions = [
        'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
        'video/mp4;codecs=avc1',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm'
      ];
      const actualMime = mimeOptions.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || 'video/mp4';

      let recorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: actualMime, videoBitsPerSecond: 5_000_000 });
      } catch (e) {
        try { recorder = new MediaRecorder(stream, { videoBitsPerSecond: 5_000_000 }); }
        catch (e2) { reject(e2); return; }
      }

      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        tracks.forEach(tr => tr.stop());
        const blob = new Blob(chunks, { type: actualMime.includes('webm') ? 'video/webm' : 'video/mp4' });
        onExportComplete(blob, actualMime.includes('webm') ? 'webm' : 'mp4');
        resolve();
      };
      recorder.onerror = (e) => reject(e);

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
          pauseVideo();
          setTimeout(() => {
            if (recorder.state !== 'inactive') recorder.stop();
          }, 200);
        }
      }, 100);
    });
  }

  // 書き出し完了処理
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

  // 共有
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
        if (err.name !== 'AbortError') console.warn('Share error:', err);
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
