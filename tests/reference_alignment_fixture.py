"""Non-personal HRIR and capture fixtures with a measured 137-sample reference."""
import contextlib
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import align_hrir
import dirac_to_hesuvi as raw
from oracle import EVENTS, CFG
from parity_fixture import fixture

OUT = ROOT/'tests/.generated/reference'


def generate():
    OUT.mkdir(parents=True, exist_ok=True)
    reference = np.zeros((1200,14), np.float32)
    for i, channels in enumerate(raw.ROUTING.values()):
        p = 137 + (i-3)*3
        reference[p,channels[0]] = .4
        reference[p+7-i,channels[1]] = -.2
    wavfile.write(OUT/'reference14.wav', 48000, reference)
    for delay in [0,84,300]:
        samples = np.zeros((1000+delay,14), np.float32)
        for i, channels in enumerate(raw.ROUTING.values()):
            p = 53 + delay + (i-3)*2
            samples[p,channels[0]] = (.1+i*.025) * (-1 if i%2 else 1)
            samples[p+5-i,channels[1]] = -.05-i*.01
            samples[p+19,channels[0]] = .02
            samples[-3,channels[1]] = 1e-9 # retain even an extremely quiet tail
        wavfile.write(OUT/f'edited{delay}.wav',48000,samples)
        output, report = align_hrir.align(samples, reference)
        wavfile.write(OUT/f'expected{delay}.wav',48000,output)
        (OUT/f'expected{delay}.json').write_text(json.dumps(report),encoding='utf-8')
        if delay == 0:
            for bits in [16,64]:
                stored = (np.rint(samples*32768).astype(np.int16) if bits==16 else samples.astype(np.float64))
                wavfile.write(OUT/f'edited{bits}bit.wav',48000,stored)
                decoded = stored.astype(np.float64)/(32768 if bits==16 else 1)
                wavfile.write(OUT/f'expected{bits}bit.wav',48000,align_hrir.align(decoded,reference)[0])
    stimulus = np.zeros((432000,8),np.int16)
    reference_capture = np.zeros((432000,2),np.float32)
    for event in EVENTS:
        stimulus[event['sample'],event['source_channel']] = 32767
        if event['label']=='LFE':reference_capture[event['sample']+137] = (.3,.1)
        else:reference_capture[event['sample']:event['sample']+len(reference)] = reference[:,raw.ROUTING[event['label']]]
    wavfile.write(OUT/'stimulus.wav',48000,stimulus)
    wavfile.write(OUT/'reference2.wav',48000,reference_capture)
    capture=fixture(12345)[0]
    wavfile.write(OUT/'capture.wav',48000,capture)
    config=dict(CFG,stimulus='stimulus.wav',apple='reference2.wav',capture='capture.wav',source_channel_map=['FL','FR','FC','LFE','BL','BR','SL','SR'])
    with patch.object(raw,'plots'), contextlib.redirect_stdout(io.StringIO()):
        raw.run(config,OUT,OUT,False)
    measured, prefix, report = align_hrir.align_capture(capture,reference,EVENTS)
    np.testing.assert_array_equal(measured,wavfile.read(OUT/'Far_HeSuVi_peak.wav')[1])
    np.testing.assert_array_equal(prefix,wavfile.read(OUT/'Far_negative_time_prefix.wav')[1])
    assert report['alignment']['selected_shift_samples']==12261


if __name__=='__main__':generate()
