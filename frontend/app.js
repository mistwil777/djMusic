'use strict';

// ═══════════════════════════════════════════════════════════
//  djMusic — Web Audio API
// ═══════════════════════════════════════════════════════════

// ── Audio nodes ────────────────────────────────────────────
let ctx = null;
let masterGain, filterNode, distortionNode;
let reverbConvolver, reverbSend;
let delayNode, delayFeedback, delayWet;
let analyser;

// ── État ───────────────────────────────────────────────────
let currentInstrument = 'synth';
let octave = 4;
let activeNotes = {};

// ── Params instruments ─────────────────────────────────────
const synthParams  = { oscType: 'sine',      attack: 0.01, release: 0.15 };
const bassParams   = { oscType: 'sawtooth',  cutoff: 300,  sub: true, release: 0.3 };
const guitarParams = { brightness: 3500, sustain: 0.97, body: 0 };

// ── Mappings ───────────────────────────────────────────────
const NOTES_12    = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_NAMES_FR = { C:'Do','C#':'Do#',D:'Ré','D#':'Ré#',E:'Mi',F:'Fa','F#':'Fa#',G:'Sol','G#':'Sol#',A:'La','A#':'La#',B:'Si' };

const KEY_TO_NOTE = {
  'a':'C','z':'C#','s':'D','e':'D#','d':'E',
  'f':'F','t':'F#','g':'G','y':'G#','h':'A',
  'u':'A#','j':'B','k':'C_next'
};

const DRUM_DEFS = [
  { id:'kick',      label:'Kick',      key:'Espace' },
  { id:'snare',     label:'Snare',     key:'B' },
  { id:'hh_closed', label:'HH Fermé',  key:'N' },
  { id:'hh_open',   label:'HH Ouvert', key:'V' },
  { id:'tom1',      label:'Tom 1',     key:'C' },
  { id:'tom2',      label:'Tom 2',     key:'X' },
  { id:'clap',      label:'Clap',      key:'W' },
  { id:'crash',     label:'Crash',     key:'Q' },
];
const DRUM_KEY_MAP = {
  ' ':'kick','b':'snare','n':'hh_closed','v':'hh_open',
  'c':'tom1','x':'tom2','w':'clap','q':'crash'
};

// ══════════════════════════════════════════════════════════
//  INIT AUDIO
// ══════════════════════════════════════════════════════════
function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  window.ctx = ctx;   // exposé pour sequencer.js

  masterGain = ctx.createGain();
  masterGain.gain.value = 0.8;
  window.masterGain = masterGain; // exposé pour stems.js
  analyser   = ctx.createAnalyser();
  analyser.fftSize = 1024;

  filterNode = ctx.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.frequency.value = 8000;
  filterNode.Q.value = 1;

  distortionNode = ctx.createWaveShaper();
  distortionNode.curve = makeDistortionCurve(0);
  distortionNode.oversample = '4x';

  reverbConvolver = buildReverb(2.5, 2);
  reverbSend = ctx.createGain(); reverbSend.gain.value = 0;

  delayNode = ctx.createDelay(2.0); delayNode.delayTime.value = 0.3;
  delayFeedback = ctx.createGain(); delayFeedback.gain.value = 0.3;
  delayWet      = ctx.createGain(); delayWet.gain.value = 0;

  filterNode.connect(distortionNode);
  distortionNode.connect(masterGain);
  distortionNode.connect(reverbSend);
  reverbSend.connect(reverbConvolver);
  reverbConvolver.connect(masterGain);
  distortionNode.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(delayWet);
  delayWet.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);

  document.getElementById('status').textContent = 'Son actif ✓';
  document.getElementById('status').classList.add('active');
  initVisualizer();
}
window.djAudioInit = initAudio;   // exposé pour sequencer.js

function melodicInput() { return filterNode; }
function drumsInput()   { return masterGain; }

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function noteToFreq(noteId, oct) {
  const base   = noteId === 'C_next' ? 'C' : noteId.replace('__oct2','');
  const semi   = NOTES_12.indexOf(base);
  const realOct = noteId === 'C_next' ? oct + 1
                : noteId.endsWith('__oct2') ? oct + 1
                : oct;
  return 440 * Math.pow(2, (12 + realOct * 12 + semi - 69) / 12);
}

function _noteIdToFreq(noteId) {
  const base   = noteId === 'C_next' ? 'C' : noteId.replace('__oct2','');
  const isNext = noteId === 'C_next' || noteId.endsWith('__oct2');
  const o      = isNext ? octave + 1 : octave;
  if (currentInstrument === 'basse') return noteToFreq(base, Math.max(1, o - 1));
  return noteToFreq(base, o);
}

function makeDistortionCurve(amount) {
  const n = 256, curve = new Float32Array(n), k = amount * 400;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = k === 0 ? x : ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function buildReverb(duration = 2.5, decay = 2) {
  const rate = ctx.sampleRate, len = Math.round(rate * duration);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  const conv = ctx.createConvolver(); conv.buffer = buf; return conv;
}

function noiseBuffer(duration) {
  const len = Math.ceil(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ══════════════════════════════════════════════════════════
//  SYNTHÉTISEUR
// ══════════════════════════════════════════════════════════
function synthPlay(noteId) {
  const freq = noteToFreq(noteId, octave);
  const osc = ctx.createOscillator(), gain = ctx.createGain(), now = ctx.currentTime;
  osc.type = synthParams.oscType; osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.8, now + synthParams.attack);
  osc.connect(gain); gain.connect(melodicInput()); osc.start(now);
  return { osc, gain, type: 'synth' };
}
function synthStop(nodes) {
  const { osc, gain } = nodes, now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + synthParams.release);
  osc.stop(now + synthParams.release + 0.01);
}

// Playback planifié (séquenceur)
function seqPlaySynth(freq, when, duration) {
  if (!ctx) return;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = synthParams.oscType; osc.frequency.value = freq;
  const atk = Math.min(synthParams.attack, duration * 0.2);
  const rel = Math.min(synthParams.release, duration * 0.4);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(0.75, when + atk);
  g.gain.setValueAtTime(0.75, when + duration - rel);
  g.gain.exponentialRampToValueAtTime(0.001, when + duration);
  osc.connect(g); g.connect(melodicInput());
  osc.start(when); osc.stop(when + duration + 0.01);
}

// ══════════════════════════════════════════════════════════
//  BASSE
// ══════════════════════════════════════════════════════════
function bassPlay(noteId) {
  const freq = noteToFreq(noteId, Math.max(1, octave - 1)), now = ctx.currentTime;
  const osc = ctx.createOscillator(), bf = ctx.createBiquadFilter(), gain = ctx.createGain();
  osc.type = bassParams.oscType; osc.frequency.value = freq;
  bf.type = 'lowpass'; bf.frequency.value = bassParams.cutoff; bf.Q.value = 2;
  gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.9, now + 0.02);
  osc.connect(bf); bf.connect(gain);
  const nodes = { osc, bassFilter: bf, gain, type: 'bass' };
  if (bassParams.sub) {
    const sub = ctx.createOscillator(), subG = ctx.createGain();
    sub.type = 'sine'; sub.frequency.value = freq / 2;
    subG.gain.setValueAtTime(0, now); subG.gain.linearRampToValueAtTime(0.6, now + 0.02);
    sub.connect(subG); subG.connect(gain); sub.start(now);
    nodes.sub = sub; nodes.subG = subG;
  }
  gain.connect(melodicInput()); osc.start(now);
  return nodes;
}
function bassStop(nodes) {
  const { osc, gain, sub, subG } = nodes, now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + bassParams.release);
  osc.stop(now + bassParams.release + 0.01);
  if (sub) {
    subG.gain.setValueAtTime(subG.gain.value, now);
    subG.gain.exponentialRampToValueAtTime(0.001, now + bassParams.release);
    sub.stop(now + bassParams.release + 0.01);
  }
}

function seqPlayBass(freq, when, duration) {
  if (!ctx) return;
  const osc = ctx.createOscillator(), bf = ctx.createBiquadFilter(), g = ctx.createGain();
  osc.type = bassParams.oscType; osc.frequency.value = freq;
  bf.type = 'lowpass'; bf.frequency.value = bassParams.cutoff; bf.Q.value = 2;
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.85, when + 0.015);
  g.gain.setValueAtTime(0.85, when + duration - Math.min(0.08, duration * 0.3));
  g.gain.exponentialRampToValueAtTime(0.001, when + duration);
  osc.connect(bf); bf.connect(g); g.connect(melodicInput());
  osc.start(when); osc.stop(when + duration + 0.01);
  if (bassParams.sub) {
    const sub = ctx.createOscillator(), sg = ctx.createGain();
    sub.type = 'sine'; sub.frequency.value = freq / 2;
    sg.gain.setValueAtTime(0.4, when); sg.gain.exponentialRampToValueAtTime(0.001, when + duration);
    sub.connect(sg); sg.connect(melodicInput()); sub.start(when); sub.stop(when + duration + 0.01);
  }
}

// ══════════════════════════════════════════════════════════
//  GUITARE — Karplus-Strong
// ══════════════════════════════════════════════════════════
function _ksNodes(freq, when) {
  const period = 1.0 / freq, N = Math.ceil(ctx.sampleRate * period);
  const buf = ctx.createBuffer(1, N, ctx.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
  const burst = ctx.createBufferSource(); burst.buffer = buf;
  const ksD = ctx.createDelay(1.0); ksD.delayTime.value = period;
  const ksF = ctx.createBiquadFilter(); ksF.type = 'lowpass'; ksF.frequency.value = guitarParams.brightness;
  const ksFB = ctx.createGain(); ksFB.gain.value = guitarParams.sustain;
  const out  = ctx.createGain(); out.gain.value = 0.8;
  const body = ctx.createBiquadFilter();
  body.type = 'peaking'; body.frequency.value = 300; body.Q.value = 1; body.gain.value = guitarParams.body * 0.12;
  burst.connect(ksD); ksD.connect(ksF); ksF.connect(ksFB); ksFB.connect(ksD);
  ksF.connect(body); body.connect(out); out.connect(melodicInput());
  burst.start(when); burst.stop(when + 0.05);
  return { ksD, ksF, ksFB, body, out };
}

function guitarPlay(noteId) {
  const freq = noteToFreq(noteId, octave), now = ctx.currentTime;
  const nodes = _ksNodes(freq, now);
  const cleanup = () => {
    try { nodes.ksFB.gain.value=0; nodes.ksFB.disconnect(); nodes.ksD.disconnect(); nodes.ksF.disconnect(); nodes.body.disconnect(); nodes.out.disconnect(); } catch(_){}
  };
  return { ...nodes, type: 'guitar', cleanup };
}
function guitarStop(n) {
  const now = ctx.currentTime, fade = 0.5;
  n.out.gain.setValueAtTime(n.out.gain.value, now);
  n.out.gain.exponentialRampToValueAtTime(0.001, now + fade);
  n.ksFB.gain.setValueAtTime(0, now);
  setTimeout(n.cleanup, (fade + 0.1) * 1000);
}

function seqPlayGuitar(freq, when) {
  if (!ctx) return;
  const n = _ksNodes(freq, when);
  const ms = Math.max(200, (when - ctx.currentTime + 6) * 1000);
  setTimeout(() => {
    try { n.ksFB.gain.value=0; n.ksFB.disconnect(); n.ksD.disconnect(); n.ksF.disconnect(); n.body.disconnect(); n.out.disconnect(); } catch(_){}
  }, ms);
}

// ══════════════════════════════════════════════════════════
//  DRUMS — fonctions immédiates + planifiées (_xxxAt)
// ══════════════════════════════════════════════════════════
function _kickAt(t) {
  const osc=ctx.createOscillator(), g=ctx.createGain();
  osc.type='sine'; osc.frequency.setValueAtTime(160,t); osc.frequency.exponentialRampToValueAtTime(0.01,t+0.45);
  g.gain.setValueAtTime(1,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.45);
  osc.connect(g); g.connect(drumsInput()); osc.start(t); osc.stop(t+0.5);
}
function _snareAt(t) {
  const ns=ctx.createBufferSource(), hp=ctx.createBiquadFilter(), ng=ctx.createGain();
  ns.buffer=noiseBuffer(0.22); hp.type='highpass'; hp.frequency.value=900;
  ng.gain.setValueAtTime(0.8,t); ng.gain.exponentialRampToValueAtTime(0.001,t+0.22);
  ns.connect(hp); hp.connect(ng); ng.connect(drumsInput()); ns.start(t); ns.stop(t+0.25);
  const osc=ctx.createOscillator(), og=ctx.createGain();
  osc.frequency.value=190; og.gain.setValueAtTime(0.6,t); og.gain.exponentialRampToValueAtTime(0.001,t+0.08);
  osc.connect(og); og.connect(drumsInput()); osc.start(t); osc.stop(t+0.1);
}
function _hhAt(t, open) {
  const dur=open?0.5:0.08, ns=ctx.createBufferSource(), bp=ctx.createBiquadFilter(), g=ctx.createGain();
  ns.buffer=noiseBuffer(dur+0.02); bp.type='bandpass'; bp.frequency.value=9000; bp.Q.value=0.5;
  g.gain.setValueAtTime(0.45,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  ns.connect(bp); bp.connect(g); g.connect(drumsInput()); ns.start(t); ns.stop(t+dur+0.05);
}
function _tomAt(t, low) {
  const freq=low?90:140, dur=low?0.35:0.25;
  const osc=ctx.createOscillator(), g=ctx.createGain();
  osc.type='sine'; osc.frequency.setValueAtTime(freq,t); osc.frequency.exponentialRampToValueAtTime(freq*0.4,t+dur);
  g.gain.setValueAtTime(0.9,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  osc.connect(g); g.connect(drumsInput()); osc.start(t); osc.stop(t+dur+0.05);
}
function _clapAt(t) {
  [0,0.01,0.02].forEach(off => {
    const ns=ctx.createBufferSource(), bp=ctx.createBiquadFilter(), g=ctx.createGain();
    ns.buffer=noiseBuffer(0.06); bp.type='bandpass'; bp.frequency.value=1200; bp.Q.value=0.8;
    g.gain.setValueAtTime(0.7,t+off); g.gain.exponentialRampToValueAtTime(0.001,t+off+0.06);
    ns.connect(bp); bp.connect(g); g.connect(drumsInput()); ns.start(t+off); ns.stop(t+off+0.1);
  });
}
function _crashAt(t) {
  const ns=ctx.createBufferSource(), hp=ctx.createBiquadFilter(), g=ctx.createGain();
  ns.buffer=noiseBuffer(1.2); hp.type='highpass'; hp.frequency.value=5000;
  g.gain.setValueAtTime(0.6,t); g.gain.exponentialRampToValueAtTime(0.001,t+1.2);
  ns.connect(hp); hp.connect(g); g.connect(drumsInput()); ns.start(t); ns.stop(t+1.3);
}

// Fonctions drum immédiates (interface utilisateur)
function playKick()           { initAudio(); _kickAt(ctx.currentTime);       flashPad('kick');      window.seqRecordDrumHit?.('kick'); }
function playSnare()          { initAudio(); _snareAt(ctx.currentTime);      flashPad('snare');     window.seqRecordDrumHit?.('snare'); }
function playHihat(open=false){ initAudio(); _hhAt(ctx.currentTime, open);   flashPad(open?'hh_open':'hh_closed'); window.seqRecordDrumHit?.(open?'hh_open':'hh_closed'); }
function playTom(low=true)    { initAudio(); _tomAt(ctx.currentTime, low);   flashPad(low?'tom1':'tom2'); window.seqRecordDrumHit?.(low?'tom1':'tom2'); }
function playClap()           { initAudio(); _clapAt(ctx.currentTime);       flashPad('clap');      window.seqRecordDrumHit?.('clap'); }
function playCrash()          { initAudio(); _crashAt(ctx.currentTime);      flashPad('crash');     window.seqRecordDrumHit?.('crash'); }

// Dispatch planifié (séquenceur)
function seqPlayDrum(drumId, when) {
  if (!ctx) return;
  const fns = {
    kick:_kickAt, snare:_snareAt,
    hh_closed:t=>_hhAt(t,false), hh_open:t=>_hhAt(t,true),
    tom1:t=>_tomAt(t,true), tom2:t=>_tomAt(t,false),
    clap:_clapAt, crash:_crashAt
  };
  fns[drumId]?.(when);
}

const DRUM_FNS = {
  kick: playKick, snare: playSnare,
  hh_closed: ()=>playHihat(false), hh_open: ()=>playHihat(true),
  tom1: ()=>playTom(true), tom2: ()=>playTom(false),
  clap: playClap, crash: playCrash
};

function flashPad(id) {
  const el = document.querySelector(`.drum-pad[data-drum="${id}"]`);
  if (!el) return;
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 120);
}

// ══════════════════════════════════════════════════════════
//  NOTE PLAY / STOP
// ══════════════════════════════════════════════════════════
function playNote(noteId) {
  if (!ctx) initAudio();
  if (activeNotes[noteId]) return;

  let nodes;
  if (currentInstrument === 'synth')        nodes = synthPlay(noteId);
  else if (currentInstrument === 'basse')   nodes = bassPlay(noteId);
  else if (currentInstrument === 'guitare') nodes = guitarPlay(noteId);
  else return;

  activeNotes[noteId] = nodes;
  document.querySelector(`.key[data-note="${noteId}"]`)?.classList.add('pressed');

  // Hook séquenceur
  window.seqRecordNoteOn?.(noteId, _noteIdToFreq(noteId), currentInstrument);
}

function stopNote(noteId) {
  const nodes = activeNotes[noteId];
  if (!nodes) return;
  if (nodes.type === 'synth')  synthStop(nodes);
  else if (nodes.type === 'bass')   bassStop(nodes);
  else if (nodes.type === 'guitar') guitarStop(nodes);
  delete activeNotes[noteId];
  document.querySelector(`.key[data-note="${noteId}"]`)?.classList.remove('pressed');
  window.seqRecordNoteOff?.(noteId);
}

// ══════════════════════════════════════════════════════════
//  CLAVIER (2 octaves)
// ══════════════════════════════════════════════════════════
const NOTE_SHORTCUT = {
  'C':'A','C#':'Z','D':'S','D#':'E','E':'D',
  'F':'F','F#':'T','G':'G','G#':'Y','A':'H',
  'A#':'U','B':'J','C_next':'K'
};

function buildKeyboard() {
  const container = document.getElementById('keys');
  container.innerHTML = '';

  const addKey = (noteId, shortcut) => {
    const base    = noteId.replace('_next','').replace('__oct2','');
    const isBlack = base.includes('#');
    const key     = document.createElement('div');
    key.className = `key ${isBlack ? 'black' : 'white'}`;
    key.dataset.note = noteId;

    if (shortcut) {
      const kl = document.createElement('span');
      kl.className = 'key-label';
      kl.textContent = shortcut;
      key.appendChild(kl);
    }
    if (!isBlack && noteId !== 'C_next') {
      const nl = document.createElement('span');
      nl.className = 'note-label';
      nl.textContent = (NOTE_NAMES_FR[base] || '') + (noteId.endsWith('__oct2') ? "'" : '');
      key.appendChild(nl);
    }

    key.addEventListener('mousedown',  () => { initAudio(); playNote(noteId); });
    key.addEventListener('mouseup',    () => stopNote(noteId));
    key.addEventListener('mouseleave', () => stopNote(noteId));
    key.addEventListener('touchstart', e => { e.preventDefault(); initAudio(); playNote(noteId); }, { passive:false });
    key.addEventListener('touchend',   e => { e.preventDefault(); stopNote(noteId); }, { passive:false });
    container.appendChild(key);
  };

  // Octave 1 (avec raccourcis)
  NOTES_12.forEach(n => addKey(n, NOTE_SHORTCUT[n]));
  addKey('C_next', NOTE_SHORTCUT['C_next']);

  // Octave 2 (clic uniquement)
  NOTES_12.forEach(n => addKey(n + '__oct2', null));
}

// ══════════════════════════════════════════════════════════
//  DRUM PADS
// ══════════════════════════════════════════════════════════
function buildDrumPads() {
  const container = document.getElementById('drum-pads');
  DRUM_DEFS.forEach(({ id, label, key }) => {
    const pad = document.createElement('div');
    pad.className = 'drum-pad';
    pad.dataset.drum = id;
    pad.innerHTML = `<span class="pad-name">${label}</span><span class="pad-key">${key}</span>`;
    pad.addEventListener('mousedown', () => { initAudio(); DRUM_FNS[id](); });
    pad.addEventListener('touchstart', e => { e.preventDefault(); initAudio(); DRUM_FNS[id](); }, { passive:false });
    container.appendChild(pad);
  });
}

// ══════════════════════════════════════════════════════════
//  VISUALIZER
// ══════════════════════════════════════════════════════════
function initVisualizer() {
  const canvas = document.getElementById('visualizer');
  const wrap   = document.getElementById('visualizer-wrap');
  const c      = canvas.getContext('2d');
  const resize = () => { canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight; };
  resize();
  window.addEventListener('resize', resize);
  const data = new Uint8Array(analyser.frequencyBinCount);
  (function draw() {
    requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(data);
    const w = canvas.width, h = canvas.height;
    c.fillStyle = '#161616'; c.fillRect(0, 0, w, h);
    c.lineWidth = 2; c.strokeStyle = '#7c3aed'; c.beginPath();
    const step = w / data.length;
    for (let i = 0; i < data.length; i++) {
      const x = i * step, y = (data[i] / 128) * (h / 2);
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
  })();
}

// ══════════════════════════════════════════════════════════
//  CONTRÔLES UI
// ══════════════════════════════════════════════════════════
document.getElementById('volume').addEventListener('input', e => {
  if (ctx) masterGain.gain.value = e.target.value / 100;
  document.getElementById('vol-val').textContent = e.target.value + '%';
});
document.getElementById('filter-cutoff').addEventListener('input', e => {
  if (ctx) filterNode.frequency.value = +e.target.value;
  document.getElementById('filter-val').textContent = e.target.value + 'Hz';
});
document.getElementById('filter-res').addEventListener('input', e => {
  if (ctx) filterNode.Q.value = +e.target.value;
  document.getElementById('res-val').textContent = (+e.target.value).toFixed(1);
});
document.getElementById('distortion').addEventListener('input', e => {
  if (ctx) distortionNode.curve = makeDistortionCurve(e.target.value / 100);
  document.getElementById('dist-val').textContent = e.target.value + '%';
});
document.getElementById('reverb').addEventListener('input', e => {
  if (ctx) reverbSend.gain.value = e.target.value / 100;
  document.getElementById('rev-val').textContent = e.target.value + '%';
});
document.getElementById('delay-wet').addEventListener('input', e => {
  if (ctx) delayWet.gain.value = e.target.value / 100;
  document.getElementById('delay-val').textContent = e.target.value + '%';
});
document.getElementById('delay-time').addEventListener('input', e => {
  if (ctx) delayNode.delayTime.value = e.target.value / 1000;
  document.getElementById('delay-time-val').textContent = e.target.value + 'ms';
});
document.getElementById('delay-feedback').addEventListener('input', e => {
  if (ctx) delayFeedback.gain.value = e.target.value / 100;
  document.getElementById('delay-fb-val').textContent = e.target.value + '%';
});
document.getElementById('oct-down').addEventListener('click', () => {
  if (octave > 1) { octave--; document.getElementById('oct-val').textContent = octave; }
});
document.getElementById('oct-up').addEventListener('click', () => {
  if (octave < 6) { octave++; document.getElementById('oct-val').textContent = octave; }
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    currentInstrument = tab.dataset.instr;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.instr-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${currentInstrument}`)?.classList.add('active');
    document.getElementById('keyboard-wrap').style.display = currentInstrument === 'drums' ? 'none' : 'block';
  });
});

document.querySelectorAll('.osc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.closest('#osc-buttons, #bass-osc-buttons');
    group.querySelectorAll('.osc-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (group.id === 'osc-buttons') synthParams.oscType = btn.dataset.type;
    else bassParams.oscType = btn.dataset.type;
  });
});

document.getElementById('synth-attack').addEventListener('input', e => {
  synthParams.attack = e.target.value / 1000;
  document.getElementById('synth-atk-val').textContent = e.target.value + 'ms';
});
document.getElementById('synth-release').addEventListener('input', e => {
  synthParams.release = e.target.value / 1000;
  document.getElementById('synth-rel-val').textContent = e.target.value + 'ms';
});
document.getElementById('bass-cutoff').addEventListener('input', e => {
  bassParams.cutoff = +e.target.value;
  document.getElementById('bass-cutoff-val').textContent = e.target.value + 'Hz';
});
document.getElementById('bass-sub').addEventListener('change', e => { bassParams.sub = e.target.checked; });
document.getElementById('bass-release').addEventListener('input', e => {
  bassParams.release = e.target.value / 1000;
  document.getElementById('bass-rel-val').textContent = e.target.value + 'ms';
});
document.getElementById('gtr-brightness').addEventListener('input', e => {
  guitarParams.brightness = +e.target.value;
  document.getElementById('gtr-bright-val').textContent = e.target.value + 'Hz';
});
document.getElementById('gtr-sustain').addEventListener('input', e => {
  guitarParams.sustain = e.target.value / 100;
  document.getElementById('gtr-sustain-val').textContent = (e.target.value / 100).toFixed(2);
});
document.getElementById('gtr-body').addEventListener('input', e => {
  guitarParams.body = +e.target.value;
  document.getElementById('gtr-body-val').textContent = e.target.value + '%';
});

// ── Clavier physique ───────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  const key = e.key === ' ' ? ' ' : e.key.toLowerCase();
  if (DRUM_KEY_MAP[key]) { initAudio(); DRUM_FNS[DRUM_KEY_MAP[key]](); return; }
  if (currentInstrument !== 'drums' && KEY_TO_NOTE[key]) { initAudio(); playNote(KEY_TO_NOTE[key]); }
});
document.addEventListener('keyup', e => {
  const key = e.key === ' ' ? ' ' : e.key.toLowerCase();
  if (KEY_TO_NOTE[key]) stopNote(KEY_TO_NOTE[key]);
});

// ── Init ───────────────────────────────────────────────────
buildKeyboard();
buildDrumPads();
