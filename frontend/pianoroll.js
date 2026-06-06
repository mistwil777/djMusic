'use strict';

// ═══════════════════════════════════════════════════════════
//  Piano Roll — djMusic
// ═══════════════════════════════════════════════════════════

const PR = {
  visible:  false,
  trackId:  null,
  snap:     0.25,   // durée snap en beats
  beatW:    40,     // px par beat
  rowH:     14,     // px par demi-ton
  pianoW:   52,     // largeur colonne touches
  rulerH:   18,     // hauteur ruler grille
  MIDI_TOP: 96,     // C7 — rangée 0
  MIDI_BOT: 24,     // C2 — rangée max
  dragging: null,
};

const _BLACK = new Set([1,3,6,8,10]);
const _NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// ── Helpers ──────────────────────────────────────────────────
function _rows()        { return PR.MIDI_TOP - PR.MIDI_BOT + 1; }
function _totalBeats()  { return (window.SEQ?.totalBars || 16) * (window.SEQ?.beatsPerBar || 4); }
function _midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function _freqToMidi(f) { return Math.round(69 + 12 * Math.log2(f / 440)); }
function _midiToY(m)    { return (PR.MIDI_TOP - m) * PR.rowH + PR.rulerH; }
function _yToMidi(y)    { return PR.MIDI_TOP - Math.floor((y - PR.rulerH) / PR.rowH); }
function _beatToX(b)    { return b * PR.beatW; }
function _xToBeat(x)    { return x / PR.beatW; }
function _snap(b)       { return Math.round(b / PR.snap) * PR.snap; }
function _noteName(m)   { return _NAMES[m % 12] + (Math.floor(m / 12) - 1); }
function _loopInBeat()  { return ((window.SEQ?.loopInBar  ?? 1) - 1) * (window.SEQ?.beatsPerBar || 4); }
function _loopOutBeat() { return  (window.SEQ?.loopOutBar ?? window.SEQ?.totalBars ?? 16) * (window.SEQ?.beatsPerBar || 4); }

// ── Ouverture / fermeture ─────────────────────────────────────
function prOpen(trackId) {
  const track = window.SEQ?.tracks.find(t => t.id === trackId);
  if (!track || track.instrument === 'drums') return;
  PR.trackId = trackId;
  PR.visible  = true;
  const overlay = document.getElementById('pr-overlay');
  if (!overlay) return;
  overlay.hidden = false;
  const titleEl = document.getElementById('pr-title');
  if (titleEl) titleEl.textContent = 'Piano Roll — ' + track.name;
  // Sync inputs loop
  const liEl = document.getElementById('pr-loop-in');
  const loEl = document.getElementById('pr-loop-out');
  if (liEl) liEl.value = window.SEQ?.loopInBar  ?? 1;
  if (loEl) loEl.value = window.SEQ?.loopOutBar ?? window.SEQ?.totalBars ?? 16;
  _prDraw();
  // Centrer sur Do du milieu (MIDI 60)
  const wrap = document.getElementById('pr-grid-wrap');
  if (wrap) {
    requestAnimationFrame(() => {
      wrap.scrollTop = _midiToY(60) - wrap.clientHeight / 2;
    });
  }
}

function prClose() {
  PR.visible = false;
  const overlay = document.getElementById('pr-overlay');
  if (overlay) overlay.hidden = true;
}

// ── Dessin ────────────────────────────────────────────────────
function _prDraw() { _drawPiano(); _drawGrid(); }

function _drawPiano() {
  const canvas = document.getElementById('pr-piano');
  if (!canvas) return;
  const n = _rows();
  canvas.width  = PR.pianoW;
  canvas.height = n * PR.rowH + PR.rulerH;
  const c = canvas.getContext('2d');

  // Bande supérieure (alignement avec le ruler de la grille)
  c.fillStyle = '#0e0e0e';
  c.fillRect(0, 0, PR.pianoW, PR.rulerH);

  for (let i = 0; i < n; i++) {
    const midi  = PR.MIDI_TOP - i;
    const semi  = midi % 12;
    const black = _BLACK.has(semi);
    const y     = i * PR.rowH + PR.rulerH;

    c.fillStyle = black ? '#1a1a1a' : (semi === 0 ? '#1e1450' : '#d8d8d8');
    c.fillRect(0, y, PR.pianoW, PR.rowH - 1);
    c.fillStyle = '#3a3a3a';
    c.fillRect(0, y + PR.rowH - 1, PR.pianoW, 1);

    if (black) {
      c.fillStyle = '#0a0a0a';
      c.fillRect(PR.pianoW - 16, y, 16, PR.rowH - 1);
    }
    if (semi === 0) {
      c.fillStyle = '#a78bfa';
      c.font = 'bold 8px monospace';
      c.fillText(_noteName(midi), 3, y + PR.rowH - 3);
    }
  }
}

function _drawPianoHighlight(activeMidi) {
  _drawPiano();
  const canvas = document.getElementById('pr-piano');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  const y = _midiToY(activeMidi) + 1;
  c.fillStyle = 'rgba(124,58,237,0.8)';
  c.fillRect(0, y, PR.pianoW, PR.rowH - 2);
}

function _drawGrid() {
  const canvas = document.getElementById('pr-grid');
  if (!canvas) return;
  const n   = _rows();
  const tb  = _totalBeats();
  const bpb = window.SEQ?.beatsPerBar || 4;
  const lib = _loopInBeat();
  const lob = _loopOutBeat();

  canvas.width  = tb * PR.beatW;
  canvas.height = n  * PR.rowH + PR.rulerH;
  const c = canvas.getContext('2d');

  // ── Ruler ──
  c.fillStyle = '#0e0e0e';
  c.fillRect(0, 0, canvas.width, PR.rulerH);

  // Région loop dans le ruler
  c.fillStyle = 'rgba(124,58,237,0.22)';
  c.fillRect(_beatToX(lib), 0, _beatToX(lob) - _beatToX(lib), PR.rulerH);

  // Numéros de mesures
  for (let beat = 0; beat <= tb; beat += bpb) {
    const x = _beatToX(beat);
    c.fillStyle = '#444';
    c.fillRect(x, 0, 1, PR.rulerH);
    c.fillStyle = '#888';
    c.font = '8px monospace';
    c.fillText(beat / bpb + 1, x + 3, PR.rulerH - 4);
  }

  // Poignées loop in/out
  const lx1 = _beatToX(lib);
  const lx2 = _beatToX(lob);
  c.fillStyle = '#7c3aed';
  c.fillRect(lx1, 0, 3, PR.rulerH);
  c.fillRect(lx2 - 3, 0, 3, PR.rulerH);

  // ── Rangées ──
  for (let i = 0; i < n; i++) {
    const midi  = PR.MIDI_TOP - i;
    const black = _BLACK.has(midi % 12);
    const y     = i * PR.rowH + PR.rulerH;
    c.fillStyle = black ? '#151515' : '#1c1c1c';
    c.fillRect(0, y, canvas.width, PR.rowH - 1);
    c.fillStyle = (midi % 12 === 0) ? '#2e2e2e' : '#1e1e1e';
    c.fillRect(0, y + PR.rowH - 1, canvas.width, 1);
  }

  // Highlight région loop sur les rangées
  c.fillStyle = 'rgba(124,58,237,0.05)';
  c.fillRect(lx1, PR.rulerH, lx2 - lx1, n * PR.rowH);
  c.fillStyle = 'rgba(124,58,237,0.45)';
  c.fillRect(lx1, PR.rulerH, 2, n * PR.rowH);
  c.fillRect(lx2 - 2, PR.rulerH, 2, n * PR.rowH);

  // ── Lignes verticales ──
  for (let beat = 0; beat <= tb; beat++) {
    const x    = _beatToX(beat);
    const isBar = beat % bpb === 0;
    c.fillStyle = isBar ? '#353535' : '#1e1e1e';
    c.fillRect(x, PR.rulerH, 1, n * PR.rowH);
  }

  // ── Notes ──
  const track = window.SEQ?.tracks.find(t => t.id === PR.trackId);
  if (!track) return;
  const col = track.color || '#7c3aed';

  track.events.forEach(ev => {
    if (ev.type !== 'note') return;
    const midi = _freqToMidi(ev.freq);
    if (midi < PR.MIDI_BOT || midi > PR.MIDI_TOP) return;
    const x  = _beatToX(ev.startBeat);
    const y  = _midiToY(midi) + 1;
    const nw = Math.max(4, ev.durationBeats * PR.beatW - 1);
    const nh = PR.rowH - 2;
    c.fillStyle = col + 'cc';
    c.fillRect(x, y, nw, nh);
    c.fillStyle = col;
    c.fillRect(x, y, 2, nh);
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.fillRect(x + nw - 5, y, 5, nh);
  });
}

// ── Sync scroll piano ─────────────────────────────────────────
// Le canvas piano utilise translateY (pas de scroll natif)
function _syncScroll() {
  const wrap  = document.getElementById('pr-grid-wrap');
  const piano = document.getElementById('pr-piano');
  if (wrap && piano) {
    piano.style.transform = `translateY(${-wrap.scrollTop}px)`;
  }
}

// ── Lecture touches piano ─────────────────────────────────────
function _pianoDown(e) {
  e.preventDefault();
  const canvas = document.getElementById('pr-piano');
  if (!canvas) return;
  if (!window.ctx) window.djAudioInit?.();
  if (!window.ctx) return;

  // getBoundingClientRect() inclut la transform translateY → y correct directement
  const rect = canvas.getBoundingClientRect();
  const y    = e.clientY - rect.top;
  if (y < PR.rulerH) return;

  const midi = _yToMidi(y);
  if (midi < PR.MIDI_BOT || midi > PR.MIDI_TOP) return;

  const track = window.SEQ?.tracks.find(t => t.id === PR.trackId);
  if (!track) return;

  canvas.setPointerCapture(e.pointerId);
  const freq = _midiToFreq(midi);
  const now  = window.ctx.currentTime;

  switch (track.instrument) {
    case 'synth':   typeof seqPlaySynth  === 'function' && seqPlaySynth(freq, now, 0.6);  break;
    case 'basse':   typeof seqPlayBass   === 'function' && seqPlayBass(freq, now, 0.6);   break;
    case 'guitare': typeof seqPlayGuitar === 'function' && seqPlayGuitar(freq, now);       break;
  }
  _drawPianoHighlight(midi);
}

function _pianoUp() {
  _drawPiano();
}

// ── Grid — pointer events ─────────────────────────────────────
function _prDown(e) {
  e.preventDefault();
  const canvas = document.getElementById('pr-grid');
  if (!canvas) return;

  // CORRECTION BUG : getBoundingClientRect tient compte du scroll du parent
  // → ne PAS ajouter scrollLeft/scrollTop (double-comptage)
  const rect = canvas.getBoundingClientRect();
  const x    = e.clientX - rect.left;
  const y    = e.clientY - rect.top;

  canvas.setPointerCapture(e.pointerId);

  // ── Zone ruler : déplacer loop in/out ──
  if (y < PR.rulerH) {
    const beat = _xToBeat(x);
    const lx1  = _beatToX(_loopInBeat());
    const lx2  = _beatToX(_loopOutBeat());
    if (Math.abs(x - lx1) <= 8) {
      PR.dragging = { type: 'loopIn' };
    } else if (Math.abs(x - lx2) <= 8) {
      PR.dragging = { type: 'loopOut' };
    }
    return;
  }

  const beat = _xToBeat(x);
  const midi  = _yToMidi(y);
  if (midi < PR.MIDI_BOT || midi > PR.MIDI_TOP) return;

  const track = window.SEQ?.tracks.find(t => t.id === PR.trackId);
  if (!track) return;

  // Cherche une note sous le pointeur
  let hitNote = null, hitResize = false;
  for (const ev of track.events) {
    if (ev.type !== 'note') continue;
    if (_freqToMidi(ev.freq) !== midi) continue;
    const nx = _beatToX(ev.startBeat);
    const nw = Math.max(4, ev.durationBeats * PR.beatW - 1);
    if (x >= nx && x <= nx + nw) {
      hitNote   = ev;
      hitResize = x >= nx + nw - 6;
      break;
    }
  }

  if (hitNote) {
    if (hitResize) {
      PR.dragging = { type: 'resize', note: hitNote, origX: x, origDur: hitNote.durationBeats };
    } else {
      track.events = track.events.filter(ev => ev !== hitNote);
      PR.dragging  = null;
      _drawGrid();
      window.renderTrack?.(PR.trackId);
    }
  } else {
    const startBeat = Math.max(0, _snap(beat));
    const newNote   = { type:'note', freq: _midiToFreq(midi), startBeat, durationBeats: PR.snap };
    track.events.push(newNote);
    PR.dragging = { type:'add', note: newNote, origX: x };
    _drawGrid();
    window.renderTrack?.(PR.trackId);
  }
}

function _prMove(e) {
  if (!PR.dragging) return;
  e.preventDefault();
  const canvas = document.getElementById('pr-grid');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x    = e.clientX - rect.left;
  const tb   = _totalBeats();
  const bpb  = window.SEQ?.beatsPerBar || 4;

  if (PR.dragging.type === 'loopIn') {
    const newBar = Math.max(1, Math.round(_xToBeat(x) / bpb));
    const maxBar = (window.SEQ?.loopOutBar ?? window.SEQ?.totalBars ?? 16) - 1;
    const v = Math.min(newBar, maxBar);
    if (window.SEQ) {
      window.SEQ.loopInBar = v;
      const el1 = document.getElementById('seq-loop-in');
      const el2 = document.getElementById('pr-loop-in');
      if (el1) el1.value = v;
      if (el2) el2.value = v;
    }
    _drawGrid();
    window.renderAllTracks?.();

  } else if (PR.dragging.type === 'loopOut') {
    const newBar = Math.max(2, Math.round(_xToBeat(x) / bpb));
    const minBar = (window.SEQ?.loopInBar ?? 1) + 1;
    const maxBar = window.SEQ?.totalBars ?? 16;
    const v = Math.min(Math.max(newBar, minBar), maxBar);
    if (window.SEQ) {
      window.SEQ.loopOutBar = v;
      const el1 = document.getElementById('seq-loop-out');
      const el2 = document.getElementById('pr-loop-out');
      if (el1) el1.value = v;
      if (el2) el2.value = v;
    }
    _drawGrid();
    window.renderAllTracks?.();

  } else if (PR.dragging.type === 'resize') {
    const dx = x - PR.dragging.origX;
    const newDur = Math.max(PR.snap, _snap(PR.dragging.origDur + dx / PR.beatW));
    PR.dragging.note.durationBeats = Math.min(newDur, tb - PR.dragging.note.startBeat);
    _drawGrid();

  } else if (PR.dragging.type === 'add') {
    const dx = x - PR.dragging.origX;
    const newDur = Math.max(PR.snap, _snap(dx / PR.beatW + PR.snap));
    PR.dragging.note.durationBeats = Math.min(newDur, tb - PR.dragging.note.startBeat);
    _drawGrid();
  }
}

function _prUp() {
  if (!PR.dragging) return;
  const type = PR.dragging.type;
  PR.dragging = null;
  if (type === 'add' || type === 'resize') window.renderTrack?.(PR.trackId);
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pr-close')?.addEventListener('click', prClose);

  document.getElementById('pr-overlay')?.addEventListener('pointerdown', e => {
    if (e.target === document.getElementById('pr-overlay')) prClose();
  });

  document.getElementById('pr-snap')?.addEventListener('change', e => {
    PR.snap = +e.target.value;
  });

  // Loop in/out dans la toolbar piano roll
  document.getElementById('pr-loop-in')?.addEventListener('change', e => {
    if (!window.SEQ) return;
    const max = (window.SEQ.loopOutBar ?? window.SEQ.totalBars) - 1;
    const v   = Math.max(1, Math.min(+e.target.value || 1, max));
    window.SEQ.loopInBar = v; e.target.value = v;
    const el = document.getElementById('seq-loop-in');
    if (el) el.value = v;
    _drawGrid();
    window.renderAllTracks?.();
  });

  document.getElementById('pr-loop-out')?.addEventListener('change', e => {
    if (!window.SEQ) return;
    const min = (window.SEQ.loopInBar ?? 1) + 1;
    const max = window.SEQ.totalBars;
    const v   = Math.max(min, Math.min(+e.target.value || max, max));
    window.SEQ.loopOutBar = v; e.target.value = v;
    const el = document.getElementById('seq-loop-out');
    if (el) el.value = v;
    _drawGrid();
    window.renderAllTracks?.();
  });

  // Events grid
  const grid = document.getElementById('pr-grid');
  if (grid) {
    grid.addEventListener('pointerdown',   _prDown);
    grid.addEventListener('pointermove',   _prMove);
    grid.addEventListener('pointerup',     _prUp);
    grid.addEventListener('pointercancel', _prUp);
  }

  // Events touches piano
  const piano = document.getElementById('pr-piano');
  if (piano) {
    piano.addEventListener('pointerdown',   _pianoDown);
    piano.addEventListener('pointerup',     _pianoUp);
    piano.addEventListener('pointercancel', _pianoUp);
  }

  // Sync scroll vertical piano ↔ grille
  document.getElementById('pr-grid-wrap')?.addEventListener('scroll', _syncScroll);
});

window.prOpen = prOpen;
