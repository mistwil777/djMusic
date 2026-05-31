'use strict';

// ═══════════════════════════════════════════════════════════
//  stems.js — Upload MP3 → Demucs → lecture synchronisée
// ═══════════════════════════════════════════════════════════

const STEMS = {
  tracks: [],          // { id, label, url, buffer, gainNode, source, muted }
  isPlaying: false,
};

const STEM_COLORS = ['#7c3aed','#2563eb','#059669','#dc2626','#d97706','#0891b2','#db2777','#84cc16'];

// ══════════════════════════════════════════════════════════
//  SÉPARATION — POST /api/separate
// ══════════════════════════════════════════════════════════
async function separateStems() {
  const fileInput = document.getElementById('stem-file');
  const model     = document.getElementById('stem-model').value;
  const statusEl  = document.getElementById('stem-status');
  const btn       = document.getElementById('stem-btn');

  if (!fileInput.files.length) {
    statusEl.textContent = 'Sélectionnez un fichier MP3 d\'abord.';
    return;
  }

  const file = fileInput.files[0];
  statusEl.textContent = `Séparation en cours (${model})… cela peut prendre 1 à 5 minutes.`;
  btn.disabled = true;
  stemsStop();
  STEMS.tracks = [];
  document.getElementById('stem-tracks').innerHTML = '';

  const fd = new FormData();
  fd.append('audio', file);
  fd.append('model', model);

  let data;
  try {
    const res = await fetch((window.API_BASE || '') + '/api/separate', { method: 'POST', body: fd });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
    btn.disabled = false;
    return;
  }

  // Initialise l'AudioContext si pas encore fait
  if (!window.ctx) window.djAudioInit?.();

  statusEl.textContent = 'Décodage des stems…';
  const entries = Object.entries(data.stems);
  let colorIdx = 0;

  for (const [id, info] of entries) {
    const color = STEM_COLORS[colorIdx++ % STEM_COLORS.length];
    const track = { id, label: info.label, url: info.url, buffer: null, gainNode: null, source: null, muted: false, color };

    try {
      const resp     = await fetch((window.API_BASE || '') + info.url);
      const arrayBuf = await resp.arrayBuffer();
      track.buffer   = await window.ctx.decodeAudioData(arrayBuf);
    } catch (e) {
      console.warn('Erreur décodage stem', id, e);
    }

    if (track.buffer && window.masterGain) {
      track.gainNode = window.ctx.createGain();
      track.gainNode.gain.value = 1.0;
      track.gainNode.connect(window.masterGain);
    }

    STEMS.tracks.push(track);
  }

  statusEl.textContent = `✓ ${entries.length} stems prêts — appuyez sur ▶ pour lancer.`;
  btn.disabled = false;
  _buildStemRows();
}

// ══════════════════════════════════════════════════════════
//  LECTURE SYNCHRONISÉE
// ══════════════════════════════════════════════════════════
function stemsPlay(ctxTime) {
  if (!window.ctx || !STEMS.tracks.length) return;
  STEMS.isPlaying = true;

  STEMS.tracks.forEach(t => {
    if (!t.buffer || !t.gainNode) return;
    t.gainNode.gain.value = t.muted ? 0 : _getVolume(t.id);

    const src = window.ctx.createBufferSource();
    src.buffer = t.buffer;
    src.loop   = false;
    src.connect(t.gainNode);
    src.start(ctxTime, 0);
    t.source = src;
  });
}

function stemsStop() {
  STEMS.isPlaying = false;
  STEMS.tracks.forEach(t => {
    if (t.source) {
      try { t.source.stop(); } catch (_) {}
      t.source = null;
    }
  });
}

function _getVolume(id) {
  const row = document.querySelector(`.stem-row[data-id="${id}"]`);
  return row ? (row.querySelector('.stem-vol')?.value || 100) / 100 : 1;
}

// ══════════════════════════════════════════════════════════
//  LECTURE SOLO PAR STEM
// ══════════════════════════════════════════════════════════
function stemPlaySolo(t, btn) {
  if (!window.ctx) window.djAudioInit?.();
  if (!t.buffer || !t.gainNode) return;

  // Si déjà en lecture → stop
  if (t.soloSource) {
    try { t.soloSource.stop(); } catch (_) {}
    t.soloSource = null;
    btn.textContent = '▶';
    btn.classList.remove('playing');
    return;
  }

  t.gainNode.gain.value = t.muted ? 0 : _getVolume(t.id);
  const src = window.ctx.createBufferSource();
  src.buffer = t.buffer;
  src.loop   = false;
  src.connect(t.gainNode);
  src.onended = () => {
    t.soloSource = null;
    btn.textContent = '▶';
    btn.classList.remove('playing');
  };
  src.start(0);
  t.soloSource = src;
  btn.textContent = '⏹';
  btn.classList.add('playing');
}

// ══════════════════════════════════════════════════════════
//  ÉVÉNEMENTS SÉQUENCEUR
// ══════════════════════════════════════════════════════════
window.addEventListener('seq:play', e => {
  stemsPlay(e.detail?.when ?? (window.ctx?.currentTime ?? 0));
});
window.addEventListener('seq:stop', () => {
  stemsStop();
});

// ══════════════════════════════════════════════════════════
//  CONSTRUCTION UI — PISTES STEMS
// ══════════════════════════════════════════════════════════
function _buildStemRows() {
  const container = document.getElementById('stem-tracks');
  if (!container) return;
  container.innerHTML = '';

  STEMS.tracks.forEach(t => {
    t.soloSource = null;
    const row = document.createElement('div');
    row.className = 'stem-row';
    row.dataset.id = t.id;

    row.innerHTML = `
      <div class="stem-colorbar" style="background:${t.color}"></div>
      <div class="stem-label">${t.label}</div>
      <button class="stem-play-btn" title="Écouter ce stem">▶</button>
      <button class="stem-mute-btn${t.muted ? ' active' : ''}" title="Mute">M</button>
      <input type="range" class="stem-vol" min="0" max="100" value="100" title="Volume">
      <canvas class="stem-waveform" height="40"></canvas>`;

    const playBtn   = row.querySelector('.stem-play-btn');
    const muteBtn   = row.querySelector('.stem-mute-btn');
    const volSlider = row.querySelector('.stem-vol');

    playBtn.addEventListener('click', () => stemPlaySolo(t, playBtn));

    muteBtn.addEventListener('click', () => {
      t.muted = !t.muted;
      muteBtn.classList.toggle('active', t.muted);
      if (t.gainNode) t.gainNode.gain.value = t.muted ? 0 : volSlider.value / 100;
    });

    volSlider.addEventListener('input', e => {
      if (t.gainNode && !t.muted) t.gainNode.gain.value = e.target.value / 100;
    });

    container.appendChild(row);

    // Waveform après layout
    requestAnimationFrame(() => {
      const cv = row.querySelector('.stem-waveform');
      _drawWaveform(cv, t.buffer, t.color);
    });
  });
}

// ══════════════════════════════════════════════════════════
//  DESSIN WAVEFORM
// ══════════════════════════════════════════════════════════
function _drawWaveform(canvas, buffer, color) {
  if (!buffer || !canvas) return;
  const waveWrap = canvas.closest('.stem-row');
  const w = waveWrap ? Math.max(100, waveWrap.clientWidth - 190) : 400;
  canvas.width  = w;
  canvas.height = 40;

  const c    = canvas.getContext('2d');
  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / w);
  const half = 20;

  c.fillStyle = '#0e0e0e';
  c.fillRect(0, 0, w, 40);
  c.strokeStyle = color + 'cc';
  c.lineWidth   = 1;
  c.beginPath();

  for (let i = 0; i < w; i++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[i * step + j] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    c.moveTo(i, half + min * half * 0.9);
    c.lineTo(i, half + max * half * 0.9);
  }
  c.stroke();
}

// ══════════════════════════════════════════════════════════
//  INIT UI
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('stem-btn')?.addEventListener('click', separateStems);

  // Drag & drop
  const zone = document.getElementById('stem-dropzone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.includes('audio')) {
        const dt = new DataTransfer();
        dt.items.add(file);
        document.getElementById('stem-file').files = dt.files;
        document.getElementById('stem-status').textContent = `Fichier : ${file.name}`;
      }
    });
    zone.addEventListener('click', () => document.getElementById('stem-file').click());
    document.getElementById('stem-file')?.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) document.getElementById('stem-status').textContent = `Fichier : ${f.name}`;
    });
  }
});
