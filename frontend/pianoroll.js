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
  MIDI_TOP: 96,     // C7 — rangée 0
  MIDI_BOT: 24,     // C2 — rangée MAX
  dragging: null,   // { type:'add'|'resize', note, origX, origDur }
};

const _BLACK = new Set([1,3,6,8,10]); // demi-tons noirs dans l'octave
const _NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// ── Helpers ──────────────────────────────────────────────────
function _rows()       { return PR.MIDI_TOP - PR.MIDI_BOT + 1; }
function _totalBeats() { return (window.SEQ?.totalBars || 16) * (window.SEQ?.beatsPerBar || 4); }
function _midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function _freqToMidi(f) { return Math.round(69 + 12 * Math.log2(f / 440)); }
function _midiToY(m)   { return (PR.MIDI_TOP - m) * PR.rowH; }
function _yToMidi(y)   { return PR.MIDI_TOP - Math.floor(y / PR.rowH); }
function _beatToX(b)   { return b * PR.beatW; }
function _xToBeat(x)   { return x / PR.beatW; }
function _snap(b)      { return Math.round(b / PR.snap) * PR.snap; }
function _noteName(m)  { return _NAMES[m % 12] + (Math.floor(m / 12) - 1); }

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

  _prDraw();

  // Centrer sur le Do du milieu (MIDI 60)
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
function _prDraw() {
  _drawPiano();
  _drawGrid();
}

function _drawPiano() {
  const canvas = document.getElementById('pr-piano');
  if (!canvas) return;
  const n = _rows();
  canvas.width  = PR.pianoW;
  canvas.height = n * PR.rowH;
  const c = canvas.getContext('2d');

  for (let i = 0; i < n; i++) {
    const midi  = PR.MIDI_TOP - i;
    const semi  = midi % 12;
    const black = _BLACK.has(semi);
    const y     = i * PR.rowH;

    // Fond touche
    c.fillStyle = black ? '#1a1a1a' : (semi === 0 ? '#1e1450' : '#d8d8d8');
    c.fillRect(0, y, PR.pianoW, PR.rowH - 1);

    // Séparateur
    c.fillStyle = '#3a3a3a';
    c.fillRect(0, y + PR.rowH - 1, PR.pianoW, 1);

    // Barre noire côté droit pour touches noires
    if (black) {
      c.fillStyle = '#0e0e0e';
      c.fillRect(PR.pianoW - 16, y, 16, PR.rowH - 1);
    }

    // Label C
    if (semi === 0) {
      c.fillStyle = '#a78bfa';
      c.font = 'bold 8px monospace';
      c.fillText(_noteName(midi), 3, y + PR.rowH - 3);
    }
  }
}

function _drawGrid() {
  const canvas = document.getElementById('pr-grid');
  if (!canvas) return;
  const n    = _rows();
  const tb   = _totalBeats();
  const bars = window.SEQ?.totalBars  || 16;
  const bpb  = window.SEQ?.beatsPerBar || 4;

  canvas.width  = tb * PR.beatW;
  canvas.height = n  * PR.rowH;
  const c = canvas.getContext('2d');

  // Fond rangées (alternance noir/gris selon touche)
  for (let i = 0; i < n; i++) {
    const midi  = PR.MIDI_TOP - i;
    const black = _BLACK.has(midi % 12);
    c.fillStyle = black ? '#151515' : '#1c1c1c';
    c.fillRect(0, i * PR.rowH, canvas.width, PR.rowH - 1);
    // Séparateur bas rangée
    c.fillStyle = '#222';
    c.fillRect(0, i * PR.rowH + PR.rowH - 1, canvas.width, 1);
    // Ligne d'octave (C)
    if ((midi % 12) === 0) {
      c.fillStyle = '#333';
      c.fillRect(0, i * PR.rowH + PR.rowH - 1, canvas.width, 1);
    }
  }

  // Lignes verticales
  for (let beat = 0; beat <= tb; beat++) {
    const x    = beat * PR.beatW;
    const isBar = beat % bpb === 0;
    c.fillStyle = isBar ? '#353535' : '#222';
    c.fillRect(x, 0, 1, canvas.height);
    if (isBar && beat < tb) {
      c.fillStyle = '#555';
      c.font = '8px monospace';
      c.fillText(beat / bpb + 1, x + 3, 9);
    }
  }

  // Notes
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

    // Corps
    c.fillStyle = col + 'cc';
    c.fillRect(x, y, nw, nh);
    // Bord gauche brillant
    c.fillStyle = col;
    c.fillRect(x, y, 2, nh);
    // Poignée resize (bord droit)
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.fillRect(x + nw - 5, y, 5, nh);
  });
}

// ── Sync scroll piano ─────────────────────────────────────────
function _syncScroll() {
  const wrap  = document.getElementById('pr-grid-wrap');
  const piano = document.getElementById('pr-piano-col');
  if (wrap && piano) piano.scrollTop = wrap.scrollTop;
}

// ── Pointer events ────────────────────────────────────────────
function _prDown(e) {
  e.preventDefault();
  const canvas = document.getElementById('pr-grid');
  if (!canvas) return;

  const rect  = canvas.getBoundingClientRect();
  const wrap  = document.getElementById('pr-grid-wrap');
  const x     = e.clientX - rect.left  + (wrap?.scrollLeft || 0);
  const y     = e.clientY - rect.top   + (wrap?.scrollTop  || 0);

  const beat = _xToBeat(x);
  const midi = _yToMidi(y);
  if (midi < PR.MIDI_BOT || midi > PR.MIDI_TOP) return;

  const track = window.SEQ?.tracks.find(t => t.id === PR.trackId);
  if (!track) return;

  // Cherche une note sous le pointeur
  let hitNote   = null;
  let hitResize = false;
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

  canvas.setPointerCapture(e.pointerId);

  if (hitNote) {
    if (hitResize) {
      PR.dragging = { type: 'resize', note: hitNote, origX: x, origDur: hitNote.durationBeats };
    } else {
      // Suppression par clic
      track.events = track.events.filter(ev => ev !== hitNote);
      PR.dragging  = null;
      _drawGrid();
      window.renderTrack?.(PR.trackId);
    }
  } else {
    // Ajout d'une note
    const startBeat = Math.max(0, _snap(beat));
    const newNote   = { type: 'note', freq: _midiToFreq(midi), startBeat, durationBeats: PR.snap };
    track.events.push(newNote);
    PR.dragging = { type: 'add', note: newNote, origX: x };
    _drawGrid();
    window.renderTrack?.(PR.trackId);
  }
}

function _prMove(e) {
  if (!PR.dragging) return;
  e.preventDefault();

  const canvas = document.getElementById('pr-grid');
  if (!canvas) return;
  const rect  = canvas.getBoundingClientRect();
  const wrap  = document.getElementById('pr-grid-wrap');
  const x     = e.clientX - rect.left + (wrap?.scrollLeft || 0);

  const maxBeats = _totalBeats();
  const dx = x - PR.dragging.origX;

  if (PR.dragging.type === 'resize') {
    const newDur = Math.max(PR.snap, _snap(PR.dragging.origDur + dx / PR.beatW));
    PR.dragging.note.durationBeats = Math.min(newDur, maxBeats - PR.dragging.note.startBeat);
  } else if (PR.dragging.type === 'add') {
    const rawDur = _snap(dx / PR.beatW + PR.snap);
    const newDur = Math.max(PR.snap, rawDur);
    PR.dragging.note.durationBeats = Math.min(newDur, maxBeats - PR.dragging.note.startBeat);
  }

  _drawGrid();
}

function _prUp() {
  if (!PR.dragging) return;
  PR.dragging = null;
  window.renderTrack?.(PR.trackId);
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pr-close')?.addEventListener('click', prClose);

  // Fermer en cliquant sur le fond
  document.getElementById('pr-overlay')?.addEventListener('pointerdown', e => {
    if (e.target === document.getElementById('pr-overlay')) prClose();
  });

  // Snap selector
  document.getElementById('pr-snap')?.addEventListener('change', e => {
    PR.snap = +e.target.value;
  });

  // Pointer events sur le grid canvas
  const grid = document.getElementById('pr-grid');
  if (grid) {
    grid.addEventListener('pointerdown',  _prDown);
    grid.addEventListener('pointermove',  _prMove);
    grid.addEventListener('pointerup',    _prUp);
    grid.addEventListener('pointercancel', _prUp);
  }

  // Sync scroll piano ↔ grille
  document.getElementById('pr-grid-wrap')?.addEventListener('scroll', _syncScroll);
});

window.prOpen = prOpen;
