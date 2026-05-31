"""
Wrapper demucs : remplace torchaudio.load par soundfile
pour éviter la dépendance torchcodec/FFmpeg DLL.
Usage : python run_demucs.py -n htdemucs --out <dir> <fichier.wav>
"""
import sys
import numpy as np
import torch
import soundfile as sf

# ── Monkey-patch torchaudio.load → soundfile ───────────────
def _sf_load(uri, frame_offset=0, num_frames=-1, normalize=True,
             channels_first=True, format=None, buffer_size=4096, backend=None):
    data, sr = sf.read(str(uri), dtype='float32', always_2d=True)
    # data shape : (samples, channels) → transpose si channels_first
    wav = torch.from_numpy(data.T if channels_first else data)
    if frame_offset > 0:
        wav = wav[..., frame_offset:]
    if num_frames > 0:
        wav = wav[..., :num_frames]
    return wav, sr

def _sf_save(uri, src, sample_rate, channels_first=True, **kwargs):
    wav = src.numpy()
    if channels_first:
        wav = wav.T  # [channels, samples] → [samples, channels]
    sf.write(str(uri), wav, sample_rate, subtype='PCM_16')

import torchaudio
torchaudio.load = _sf_load
torchaudio.save = _sf_save

# ── Lance demucs normalement ───────────────────────────────
from demucs.__main__ import main
main()
