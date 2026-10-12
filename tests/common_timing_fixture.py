"""CLI-reference fixtures; supplied golden audio stays local and optional."""
import contextlib
import io
import json
import struct
import sys
from pathlib import Path
from unittest.mock import patch
import numpy as np
from scipy.io import wavfile
from scipy.signal import chirp, fftconvolve
from parity_fixture import fixture
from oracle import EVENTS, SR, CFG
import dirac_to_hesuvi as reference

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests/.generated/common"

def pcm24(path, samples):
    integers = np.rint(samples * 8388608).astype(np.int32).reshape(-1)
    data = np.column_stack((integers & 255, (integers >> 8) & 255, (integers >> 16) & 255)).astype(np.uint8).tobytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 2, SR, SR*6, 6, 24) + b"data" + struct.pack("<I", len(data))
    path.write_bytes(header + data)

def run_case(name, capture, pcm=False):
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    stimulus = np.zeros((432000, 8), np.int16)
    apple = np.zeros((432000, 2), np.float32)
    for event in EVENTS:
        stimulus[event["sample"], event["source_channel"]] = 32767
        apple[event["sample"]+53] = (.4, .2)
    wavfile.write(folder/"stimulus.wav", SR, stimulus)
    wavfile.write(folder/"reference.wav", SR, apple)
    if pcm: pcm24(folder/"input.wav", capture)
    else: wavfile.write(folder/"input.wav", SR, capture.astype(np.float32))
    config = dict(CFG, source_channel_map=["FL","FR","FC","LFE","BL","BR","SL","SR"], stimulus="stimulus.wav", apple="reference.wav", capture="input.wav", alignment="common_peak", pre_samples=0, tail_samples=24000, archive_negative_prefix=True, archive_prefix_samples=1024)
    with patch.object(reference, "plots"), contextlib.redirect_stdout(io.StringIO()):
        reference.run(config, folder, folder, False)
    return folder

def generate():
    cases = []
    for name, residuals in (("wide", [-25,-13,-7,0,14,33,90]), ("cyberpunk_timing", [0,-5,0,4,1,-3,0]), ("witcher_timing", [2,-4,-1,6,3,-1,0])):
        audio, _, _ = fixture(12345, residuals)
        audio[48000+12345-9, 0] = 1/8388608
        run_case(name, audio)
        cases.append({"name": name, "kind": "synthetic_cli_reference"})
    package = ROOT / ".handoff-common-timing/HeSuVi_AutoEdit_CommonTiming_Fix"
    if package.exists():
        for name in ("Cyberpunk", "Witcher"):
            qa = json.loads((package/"validation"/(name+"_qa.json")).read_text())
            extraction = qa["captures"]["Far"]["extraction"]
            gain = extraction["gain_scalar"]
            main = wavfile.read(package/"audio"/("Immerse_Profile4_"+name+"_HeSuVi.wav"))[1]
            prefix = wavfile.read(package/"archive"/("Immerse_Profile4_"+name+"_negative_time_prefix.wav"))[1]
            audio = np.zeros((qa["captures"]["Far"]["source"]["frames"],2), np.float64)
            shift = qa["alignment"]["selected_shift_samples"]
            for event in EVENTS:
                start = event["sample"]+shift
                if event["label"] == "LFE":
                    audio[start+53] = (.2,.1)
                    continue
                channels = reference.ROUTING[event["label"]]
                for data, lo in ((main,start),(prefix,start-1024)):
                    samples = np.rint(data[:,channels].astype(np.float64)/gain*8388608)/8388608
                    np.testing.assert_array_equal((samples*gain).astype(np.float32),data[:,channels])
                    audio[lo:lo+len(data)] = samples
            folder = run_case(name.lower()+"_golden_derived", audio, pcm=True)
            np.testing.assert_array_equal(wavfile.read(folder/"Far_HeSuVi_peak.wav")[1],main)
            np.testing.assert_array_equal(wavfile.read(folder/"Far_negative_time_prefix.wav")[1],prefix)
            cases.append({"name": folder.name, "kind":"golden_derived_PCM24_windows_with_synthetic_LFE"})
    (OUT/"cases.json").write_text(json.dumps(cases,indent=2))

def validate():
    reports = []
    sweep = np.concatenate((np.zeros(6000),chirp(np.arange(SR)/SR,f0=20,f1=20000,t1=1,method="logarithmic")))
    for case in json.loads((OUT/"cases.json").read_text()):
        folder = OUT/case["name"]
        qa = json.loads((folder/"qa.json").read_text())
        _, source, _ = reference.read(folder/"input.wav")
        actual = wavfile.read(folder/"browser.wav")[1]
        shift = qa["alignment"]["selected_shift_samples"]
        gain = qa["captures"]["Far"]["extraction"]["gain_scalar"]
        errors = []
        for event in EVENTS:
            if event["label"] == "LFE":continue
            start = event["sample"]+shift
            for ear, channel in enumerate(reference.ROUTING[event["label"]]):
                raw = source[start:start+24000,ear]*gain
                expected = fftconvolve(sweep,raw)
                result = fftconvolve(sweep,actual[:,channel].astype(np.float64))
                error = float(np.max(abs(expected-result)))
                rounding_bound = float(np.sum(abs(actual[:,channel].astype(np.float64)-raw)))
                assert error <= rounding_bound+1e-12
                errors.append(error)
        reports.append(dict(case,delayed_sweep_max_absolute_error=max(errors)))
    (OUT/"delayed_convolution.json").write_text(json.dumps(reports,indent=2))
    print(json.dumps(reports))

if __name__ == "__main__":
    validate() if len(sys.argv)>1 and sys.argv[1]=="validate" else generate()
