'use strict';

// ═══════════════════════════════════════════════════════════
//  Séquenceur — djMusic
// ═══════════════════════════════════════════════════════════

const TRACK_H       = 72;    // hauteur d'une piste px
const LOOKAHEAD_S   = 0.12;  // fenêtre de planification (s)
const SCHED_MS      = 25;    // intervalle scheduler (ms)

const TRACK_PALETTE = ['#7c3aed','#2563eb','#059669','#dc2626','#d97706','#0891b2','#db2777','#84cc16'];
const NOTE_COLORS   = ['#f87171','#fb923c','#fbbf24','#a3e635','#4ade80','#34d399','#22d3ee','#60a5fa','#818cf8','#a78bfa','#e879f9','#f472b6'];
const DRUM_COLORS   = { kick:'#f87171',snare:'#fb923c',hh_closed:'#fbbf24',hh_open:'#a3e635',tom1:'#4ade80',tom2:'#34d399',clap:'#22d3ee',crash:'#818cf8' };
const NOTES_SEQ     = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// ── État global ────────────────────────────────────────────
const SEQ = {
  bpm: 120, totalBars: 16, beatsPerBar: 4,
  state: 'stopped',           // 'stopped' | 'playing' | 'recording'
  tracks: [],
  looping: true,

  // Runtime
  loopStartCtxTime: 0,        // ctx.currentTime du début du loop actuel
  loopScheduled: false,       // events du loop actuel déjà planifiés ?
  schedulerTimer: null,
  rafId: null,

  // Recording
  recordingTrackId: null,
  pendingNotes: {},            // noteId -> event en cours

  // Région de boucle (1-indexé, en mesures)
  loopInBar:  1,
  loopOutBar: null,            // null = totalBars
};
window.SEQ = SEQ;

let _trkSeq = 1;

// ── Helpers tempo ──────────────────────────────────────────
const totalBeats      = () => SEQ.totalBars * SEQ.beatsPerBar;
const loopInBeat      = () => ((SEQ.loopInBar  ?? 1) - 1) * SEQ.beatsPerBar;
const loopOutBeat     = () =>  (SEQ.loopOutBar ?? SEQ.totalBars) * SEQ.beatsPerBar;
const loopRegionBeats = () => loopOutBeat() - loopInBeat();
const beatSec         = () => 60 / SEQ.bpm;
const loopSec         = () => loopRegionBeats() * beatSec();
const currentBeat     = () => {
  if (SEQ.state === 'stopped') return loopInBeat();
  const elapsed = (window.ctx?.currentTime || 0) - SEQ.loopStartCtxTime;
  return loopInBeat() + Math.min(elapsed / beatSec(), loopRegionBeats() - 0.001);
};

// ══════════════════════════════════════════════════════════
//  GESTION DES PISTES
// ══════════════════════════════════════════════════════════
function addTrack(instrument = 'synth', name = null) {
  const id    = 'trk' + _trkSeq++;
  const color = TRACK_PALETTE[(SEQ.tracks.length) % TRACK_PALETTE.length];
  SEQ.tracks.push({
    id, instrument, color,
    name:   name || (instrument[0].toUpperCase() + instrument.slice(1) + ' ' + _trkSeq),
    muted:  false,
    events: []
  });
  _rebuildUI();
  return id;
}

function removeTrack(id) {
  if (SEQ.tracks.length <= 1) return;
  SEQ.tracks = SEQ.tracks.filter(t => t.id !== id);
  if (SEQ.recordingTrackId === id) SEQ.recordingTrackId = SEQ.tracks[0]?.id || null;
  _rebuildUI();
}

const getTrack = id => SEQ.tracks.find(t => t.id === id);

// ══════════════════════════════════════════════════════════
//  TRANSPORT
// ══════════════════════════════════════════════════════════
function seqPlay() {
  if (SEQ.state !== 'stopped') return;
  if (!window.ctx) window.djAudioInit?.();
  if (!window.ctx) return;
  SEQ.state = 'playing';
  _startTransport();
}

function seqRecord(trackId) {
  if (SEQ.state !== 'stopped') return;
  if (!window.ctx) window.djAudioInit?.();
  if (!window.ctx) return;
  if (trackId) SEQ.recordingTrackId = trackId;
  if (!SEQ.recordingTrackId && SEQ.tracks.length > 0) SEQ.recordingTrackId = SEQ.tracks[0].id;
  SEQ.state = 'recording';
  SEQ.pendingNotes = {};
  _startTransport();
}

function seqStop() {
  if (SEQ.state === 'stopped') return;

  // Finalise les notes non relâchées avant le stop
  if (SEQ.state === 'recording') {
    const beat = currentBeat();
    Object.values(SEQ.pendingNotes).forEach(pn => {
      pn.durationBeats = Math.max(0.05, beat - pn.startBeat);
      getTrack(SEQ.recordingTrackId)?.events.push({ ...pn });
    });
    SEQ.pendingNotes = {};
  }

  SEQ.state = 'stopped';
  clearInterval(SEQ.schedulerTimer);
  cancelAnimationFrame(SEQ.rafId);
  SEQ.loopScheduled = false;

  _updatePlayheadPos(loopInBeat());
  _updateTransportUI();
  renderAllTracks();
  window.dispatchEvent(new CustomEvent('seq:stop'));
}

function _startTransport() {
  SEQ.loopStartCtxTime = window.ctx.currentTime;
  SEQ.loopScheduled    = false;
  SEQ.schedulerTimer   = setInterval(_runScheduler, SCHED_MS);
  SEQ.rafId            = requestAnimationFrame(_animPlayhead);
  _updateTransportUI();
  window.dispatchEvent(new CustomEvent('seq:play', { detail: { when: window.ctx.currentTime } }));
}

// ══════════════════════════════════════════════════════════
//  SCHEDULER (lookahead)
// ══════════════════════════════════════════════════════════
function _runScheduler() {
  if (!window.ctx || SEQ.state === 'stopped') return;
  const now    = window.ctx.currentTime;
  const loopEnd = SEQ.loopStartCtxTime + loopSec();

  // Avance le pointeur de loop si on approche de la fin
  if (now + LOOKAHEAD_S >= loopEnd) {
    SEQ.loopStartCtxTime += loopSec();
    SEQ.loopScheduled = false;
  }

  if (SEQ.loopScheduled) return;

  // Planifie les événements dans la région de boucle
  SEQ.tracks.forEach(track => {
    if (track.muted) return;
    track.events.forEach(ev => {
      const beat = ev.startBeat;
      if (beat < loopInBeat() || beat >= loopOutBeat()) return;
      const when = SEQ.loopStartCtxTime + (beat - loopInBeat()) * beatSec();
      if (when >= now - 0.01) _fireEvent(track, ev, when);
    });
  });
  SEQ.loopScheduled = true;
}

function _fireEvent(track, ev, when) {
  if (!window.ctx) return;
  if (ev.type === 'note') {
    const dur = ev.durationBeats * beatSec();
    if (track.instrument === 'synth')        seqPlaySynth(ev.freq, when, dur);
    else if (track.instrument === 'basse')   seqPlayBass(ev.freq, when, dur);
    else if (track.instrument === 'guitare') seqPlayGuitar(ev.freq, when);
  } else if (ev.type === 'drum') {
    seqPlayDrum(ev.drum, when);
  }
}

// ══════════════════════════════════════════════════════════
//  HOOKS D'ENREGISTREMENT (appelés depuis app.js)
// ══════════════════════════════════════════════════════════
window.seqRecordNoteOn = function(noteId, freq, instrument) {
  if (SEQ.state !== 'recording') return;
  const track = getTrack(SEQ.recordingTrackId);
  if (!track || track.instrument !== instrument) return;
  SEQ.pendingNotes[noteId] = { type:'note', freq, instrument, startBeat: currentBeat(), durationBeats: 0.1 };
};

window.seqRecordNoteOff = function(noteId) {
  if (SEQ.state !== 'recording') return;
  const pn = SEQ.pendingNotes[noteId];
  if (!pn) return;
  pn.durationBeats = Math.max(0.05, currentBeat() - pn.startBeat);
  getTrack(SEQ.recordingTrackId)?.events.push({ ...pn });
  delete SEQ.pendingNotes[noteId];
  renderTrack(SEQ.recordingTrackId);
};

window.seqRecordDrumHit = function(drumId) {
  if (SEQ.state !== 'recording') return;
  const track = getTrack(SEQ.recordingTrackId);
  if (!track || track.instrument !== 'drums') return;
  track.events.push({ type:'drum', drum:drumId, startBeat: currentBeat() });
  renderTrack(SEQ.recordingTrackId);
};

// ══════════════════════════════════════════════════════════
//  ANIMATION PLAYHEAD
// ══════════════════════════════════════════════════════════
function _animPlayhead() {
  if (SEQ.state === 'stopped') return;
  _updatePlayheadPos(currentBeat());
  SEQ.rafId = requestAnimationFrame(_animPlayhead);
}

function _updatePlayheadPos(beat) {
  const frac = beat / totalBeats();
  const ph = document.getElementById('seq-playhead');
  if (ph) ph.style.left = Math.min(100, frac * 100) + '%';

  const bar    = Math.floor(beat / SEQ.beatsPerBar) + 1;
  const beatNr = Math.floor(beat % SEQ.beatsPerBar) + 1;
  const el = document.getElementById('seq-pos');
  if (el) el.textContent = bar + ' : ' + beatNr;
}

// ══════════════════════════════════════════════════════════
//  RENDU CANVAS
// ══════════════════════════════════════════════════════════
function renderAllTracks() { SEQ.tracks.forEach(t => renderTrack(t.id)); }

function renderTrack(trackId) {
  const track  = getTrack(trackId);
  const canvas = document.getElementById('cv_' + trackId);
  if (!track || !canvas) return;

  const w = canvas.parentElement ? Math.floor(canvas.parentElement.clientWidth) : 700;
  const h = TRACK_H;
  canvas.width = w; canvas.height = h;

  const c  = canvas.getContext('2d');
  const tb = totalBeats();

  // Fond
  c.fillStyle = '#0e0e0e'; c.fillRect(0, 0, w, h);

  // Grille : mesures + temps
  for (let bar = 0; bar <= SEQ.totalBars; bar++) {
    const bx = (bar / SEQ.totalBars) * w;
    c.strokeStyle = '#2a2a2a'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(bx, 0); c.lineTo(bx, h); c.stroke();
    if (bar < SEQ.totalBars) {
      c.fillStyle = '#2d2d2d'; c.font = '9px monospace';
      c.fillText(bar + 1, bx + 4, 10);
      for (let b = 1; b < SEQ.beatsPerBar; b++) {
        const bx2 = ((bar * SEQ.beatsPerBar + b) / tb) * w;
        c.strokeStyle = '#191919'; c.lineWidth = 0.5;
        c.beginPath(); c.moveTo(bx2, 0); c.lineTo(bx2, h); c.stroke();
      }
    }
  }

  // Événements
  track.events.forEach(ev => {
    const x = (ev.startBeat / tb) * w;
    if (ev.type === 'note') {
      const ni   = _midiNoteIdx(ev.freq);
      const col  = NOTE_COLORS[ni];
      const bw   = Math.max(4, (ev.durationBeats / tb) * w - 1);
      // Bloc note
      c.fillStyle = col + 'bb';
      c.fillRect(x, 14, bw, h - 26);
      // Bordure gauche
      c.fillStyle = col;
      c.fillRect(x, 14, 2, h - 26);
      // Label note
      if (bw > 20) {
        c.fillStyle = '#fff'; c.font = 'bold 8px monospace';
        c.fillText(_freqToName(ev.freq), x + 4, h - 12);
      }
    } else if (ev.type === 'drum') {
      const col = DRUM_COLORS[ev.drum] || '#888';
      c.fillStyle = col + 'cc';
      c.fillRect(x, 8, 6, h - 16);
      c.fillStyle = col;
      c.fillRect(x, 8, 2, h - 16);
      c.fillStyle = '#fff'; c.font = '7px sans-serif';
      c.save(); c.translate(x + 10, h - 8); c.rotate(-Math.PI / 2);
      c.fillText(ev.drum.slice(0,3).toUpperCase(), 0, 0);
      c.restore();
    }
  });

  // Overlay région de boucle
  const lib = loopInBeat() / tb;
  const lob = loopOutBeat() / tb;
  c.fillStyle = 'rgba(124,58,237,0.07)';
  c.fillRect(lib * w, 0, (lob - lib) * w, h);
  c.fillStyle = 'rgba(124,58,237,0.6)';
  c.fillRect(lib * w, 0, 2, h);
  c.fillRect(Math.min(lob * w - 2, w - 2), 0, 2, h);
}

window.renderTrack     = renderTrack;
window.renderAllTracks = renderAllTracks;

function _midiNoteIdx(freq) {
  const midi = Math.round(12 * Math.log2(freq / 440) + 69);
  return ((midi % 12) + 12) % 12;
}
function _freqToName(freq) {
  const midi = Math.round(12 * Math.log2(freq / 440) + 69);
  const name = NOTES_SEQ[((midi % 12) + 12) % 12];
  const oct  = Math.floor(midi / 12) - 1;
  return name + oct;
}

// ══════════════════════════════════════════════════════════
//  CONSTRUCTION UI
// ══════════════════════════════════════════════════════════
function _rebuildUI() {
  const list = document.getElementById('seq-track-list');
  const area = document.getElementById('seq-canvas-area');
  if (!list || !area) return;

  list.innerHTML = '';
  area.innerHTML = '';

  SEQ.tracks.forEach(track => {
    // ── Header piste ──
    const hdr = document.createElement('div');
    hdr.className = 'seq-track-hdr';
    hdr.style.height = TRACK_H + 'px';
    hdr.dataset.id = track.id;
    hdr.innerHTML = `
      <div class="trk-colorbar" style="background:${track.color}"></div>
      <div class="trk-meta">
        <input class="trk-name" value="${_esc(track.name)}" spellcheck="false">
        <select class="trk-instr">
          <option value="synth"   ${track.instrument==='synth'  ?'selected':''}>Synth</option>
          <option value="basse"   ${track.instrument==='basse'  ?'selected':''}>Basse</option>
          <option value="guitare" ${track.instrument==='guitare'?'selected':''}>Guitare</option>
          <option value="drums"   ${track.instrument==='drums'  ?'selected':''}>Drums</option>
        </select>
      </div>
      <div class="trk-actions">
        <button class="trk-btn trk-rec  ${SEQ.recordingTrackId===track.id?'active':''}" title="Piste active pour l'enregistrement">⏺</button>
        ${track.instrument !== 'drums' ? `<button class="trk-btn trk-pr" title="Piano Roll">✏</button>` : ''}
        <button class="trk-btn trk-mute ${track.muted?'active':''}" title="Mute">M</button>
        <button class="trk-btn trk-clr"  title="Effacer">🗑</button>
        <button class="trk-btn trk-del"  title="Supprimer">×</button>
      </div>`;

    hdr.querySelector('.trk-name').addEventListener('change', e => { track.name = e.target.value; });
    hdr.querySelector('.trk-instr').addEventListener('change', e => { track.instrument = e.target.value; });
    hdr.querySelector('.trk-pr')?.addEventListener('click', () => window.prOpen?.(track.id));
    hdr.querySelector('.trk-rec').addEventListener('click', () => {
      SEQ.recordingTrackId = track.id;
      document.querySelectorAll('.trk-rec').forEach(b => b.classList.remove('active'));
      hdr.querySelector('.trk-rec').classList.add('active');
    });
    hdr.querySelector('.trk-mute').addEventListener('click', e => {
      track.muted = !track.muted; e.currentTarget.classList.toggle('active', track.muted);
    });
    hdr.querySelector('.trk-clr').addEventListener('click', () => { track.events = []; renderTrack(track.id); });
    hdr.querySelector('.trk-del').addEventListener('click', () => removeTrack(track.id));
    list.appendChild(hdr);

    // Séparateur dans la liste
    const ls = document.createElement('div'); ls.className = 'seq-sep'; list.appendChild(ls);

    // ── Canvas piste ──
    const wrap = document.createElement('div');
    wrap.className = 'track-canvas-wrap';
    const cv = document.createElement('canvas');
    cv.id = 'cv_' + track.id;
    cv.className = 'track-canvas';
    wrap.appendChild(cv);
    area.appendChild(wrap);

    // Séparateur canvas
    const cs = document.createElement('div'); cs.className = 'seq-sep'; area.appendChild(cs);
  });

  // Playhead
  const ph = document.createElement('div');
  ph.id = 'seq-playhead';
  area.appendChild(ph);

  // Redessine après layout
  requestAnimationFrame(renderAllTracks);

  // ResizeObserver
  if (window.ResizeObserver) {
    new ResizeObserver(renderAllTracks).observe(area);
  }
}

function _updateTransportUI() {
  document.getElementById('btn-play')  ?.classList.toggle('active', SEQ.state === 'playing');
  document.getElementById('btn-record')?.classList.toggle('active', SEQ.state === 'recording');
  document.getElementById('btn-stop')  ?.classList.toggle('active', SEQ.state === 'stopped');
}

function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Transport
  document.getElementById('btn-play')?.addEventListener('click', () => {
    if (SEQ.state !== 'stopped') { seqStop(); setTimeout(seqPlay, 30); }
    else seqPlay();
  });
  document.getElementById('btn-stop')?.addEventListener('click', seqStop);
  document.getElementById('btn-record')?.addEventListener('click', () => {
    if (SEQ.state !== 'stopped') seqStop();
    setTimeout(() => seqRecord(SEQ.recordingTrackId), 30);
  });

  // BPM
  document.getElementById('seq-bpm')?.addEventListener('input', e => {
    SEQ.bpm = Math.max(40, Math.min(240, +e.target.value || 120));
  });

  // Mesures
  document.getElementById('seq-bars')?.addEventListener('change', e => {
    SEQ.totalBars = +e.target.value; renderAllTracks();
  });

  // Ajouter une piste
  document.getElementById('btn-add-track')?.addEventListener('click', () => {
    addTrack('synth');
  });

  // Loop in/out
  document.getElementById('seq-loop-in')?.addEventListener('change', e => {
    const max = (SEQ.loopOutBar ?? SEQ.totalBars) - 1;
    const v = Math.max(1, Math.min(+e.target.value || 1, max));
    SEQ.loopInBar = v; e.target.value = v;
    const prEl = document.getElementById('pr-loop-in');
    if (prEl) prEl.value = v;
    renderAllTracks();
  });
  document.getElementById('seq-loop-out')?.addEventListener('change', e => {
    const v = Math.max((SEQ.loopInBar ?? 1) + 1, Math.min(+e.target.value || SEQ.totalBars, SEQ.totalBars));
    SEQ.loopOutBar = v; e.target.value = v;
    const prEl = document.getElementById('pr-loop-out');
    if (prEl) prEl.value = v;
    renderAllTracks();
  });

  // Pistes par défaut
  addTrack('synth',  'Synth 1');
  addTrack('basse',  'Basse 1');
  addTrack('drums',  'Drums');
  SEQ.recordingTrackId = SEQ.tracks[0].id;
  _updateTransportUI();
});
