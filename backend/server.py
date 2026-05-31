#!/usr/bin/env python3
"""
djMusic — Serveur Flask + séparation de stems via Demucs
Lancer en local : python server.py
Render (prod)   : gunicorn server:app
"""

import sys
import uuid
import subprocess
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import imageio_ffmpeg

BASE_DIR  = Path(__file__).parent
# En local, les fichiers statiques sont dans ../frontend
FRONTEND  = (BASE_DIR / '../frontend').resolve()
STEMS_DIR = BASE_DIR / 'stems'
STEMS_DIR.mkdir(exist_ok=True)

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

app = Flask(__name__, static_folder=str(FRONTEND))
CORS(app)

# ── Fichiers statiques (local dev) ────────────────────────
@app.route('/')
def index():
    return send_from_directory(FRONTEND, 'index.html')

@app.route('/<path:path>')
def static_file(path):
    return send_from_directory(FRONTEND, path)

@app.route('/stems/<path:path>')
def serve_stem(path):
    return send_from_directory(STEMS_DIR, path)

# ── Séparation ────────────────────────────────────────────
@app.route('/api/separate', methods=['POST'])
def separate():
    f = request.files.get('audio')
    if not f:
        return jsonify({'error': 'Fichier audio manquant'}), 400

    model   = request.form.get('model', 'htdemucs')
    job_id  = uuid.uuid4().hex[:10]
    job_dir = STEMS_DIR / job_id
    job_dir.mkdir(parents=True)

    # Sauvegarder le fichier d'entrée
    input_path = job_dir / 'input.mp3'
    f.save(input_path)

    # Convertir en WAV (soundfile ne lit pas le MP3)
    wav_path = job_dir / 'input.wav'
    conv = subprocess.run(
        [FFMPEG, '-y', '-i', str(input_path), '-ar', '44100', '-ac', '2', str(wav_path)],
        capture_output=True, text=True, timeout=120
    )
    if conv.returncode != 0:
        return jsonify({'error': 'Conversion MP3→WAV échouée : ' + (conv.stderr or '')[-800:]}), 500

    # Lancer Demucs via run_demucs.py (monkey-patch soundfile)
    cmd = [
        sys.executable,
        str(BASE_DIR / 'run_demucs.py'),
        '-n', model,
        '--out', str(job_dir),
        str(wav_path)
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600  # 10 minutes max
        )
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Timeout — fichier trop long (> 10 min)'}), 500
    except FileNotFoundError:
        return jsonify({'error': 'Demucs introuvable. Lancez : pip install demucs'}), 500

    if result.returncode != 0:
        err = (result.stderr or result.stdout or 'Erreur inconnue')[-1500:]
        return jsonify({'error': err}), 500

    # Trouver les WAV générés
    # Structure Demucs : job_dir / model / input / {stem}.wav
    stem_dir = job_dir / model / 'input'
    if not stem_dir.exists():
        return jsonify({'error': f'Dossier de sortie introuvable : {stem_dir}'}), 500

    LABELS = {
        'drums': 'Batterie', 'bass': 'Basse', 'vocals': 'Voix',
        'other': 'Autre',    'guitar': 'Guitare', 'piano': 'Piano'
    }

    stems = {}
    for wav in sorted(stem_dir.glob('*.wav')):
        key = wav.stem
        stems[key] = {
            'url':   f'/stems/{job_id}/{model}/input/{wav.name}',
            'label': LABELS.get(key, key.capitalize())
        }

    return jsonify({'job': job_id, 'stems': stems})


if __name__ == '__main__':
    print('\n  djMusic server — http://localhost:5000\n')
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
