"""Single-input 7.1 preset oracle built from the fixed common_peak CLI DSP primitives."""
from __future__ import annotations

import json
from pathlib import Path
import sys

import numpy as np
from scipy.io import wavfile
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import dirac_to_hesuvi as reference

PRESET = json.loads((ROOT / "presets/known_7_1_calibration.json").read_text())
EVENTS = PRESET["events"]
SR = PRESET["sample_rate"]
CFG = PRESET["detector_config"]
CALIBRATION_PEAK = PRESET["expected_pair_peak_sample"]


def process(samples: np.ndarray, sample_rate: int, *, pre_samples: int = 0,
            tail_samples: int = 24000) -> tuple[np.ndarray, dict]:
    """Return float32 HeSuVi samples and evidence for one raw stereo recording.

    This oracle applies the documented 53-sample operational peak calibration;
    it does not claim reference-waveform correlation or physical latency.
    """
    samples = np.asarray(samples)
    if np.issubdtype(samples.dtype, np.integer):
        if samples.dtype == np.uint8:
            samples = (samples.astype(np.float64) - 128) / 128
        else:
            samples = samples.astype(np.float64) / 2 ** (np.iinfo(samples.dtype).bits - 1)
    else:
        samples = samples.astype(np.float64)
    reference.require(sample_rate == SR, f"Expected {SR} Hz, received {sample_rate} Hz")
    reference.require(samples.ndim == 2 and samples.shape[1] == 2,
                      "Expected a two-channel recording")
    reference.require(np.all(np.isfinite(samples)), "Recording contains nonfinite samples")
    reference.require(pre_samples >= 0 and tail_samples > 0, "Invalid extraction window")
    detections, detector = reference.detect(samples, sample_rate, CFG)
    rows = reference.match(EVENTS, detections, sample_rate, CFG)
    full_range = [i for i, event in enumerate(EVENTS) if event["label"] != "LFE"]
    peak_offsets = np.array([
        rows[i]["peak"] - EVENTS[i]["sample"] - CALIBRATION_PEAK
        for i in full_range
    ], dtype=np.int64)
    reference_rows = [dict(peak=event["sample"] + CALIBRATION_PEAK) for event in EVENTS]
    shift, timing = reference.common_peak_shift(EVENTS, reference_rows, rows)
    residuals = peak_offsets - shift

    spacing = int(np.min(np.diff([event["sample"] for event in EVENTS])))
    reference.require(pre_samples + tail_samples <= spacing,
                      "Extraction windows overlap neighboring events")
    for i in full_range:
        row = rows[i]
        start = EVENTS[i]["sample"] + shift - pre_samples
        end = EVENTS[i]["sample"] + shift + tail_samples
        reference.require(start >= 0 and end <= len(samples),
                          f"{EVENTS[i]['label']}: extraction outside recording")
        reference.require(row["onset"] >= start or pre_samples == 0,
                          f"{EVENTS[i]['label']}: onset precedes extraction window")
        prefix_start = max(row["search_start"], 0)
        prefix_frames = 1024 if pre_samples == 0 else 0
        reference.require(start >= prefix_frames, "Prefix outside recording")
        reference.require(not np.any(samples[prefix_start:max(prefix_start, start-prefix_frames)]),
                          f"{EVENTS[i]['label']}: nonzero response precedes extraction window")
        reference.require(start <= row["peak"] < end, "Extraction omits detected peak")
        tail_limit = max(CFG["activity_floor"], row["noise_floor"] * CFG["noise_multiplier"], row["peak_abs"] * 10 ** (CFG["activity_db"] / 20))
        reference.require(not np.any(abs(samples[max(end, row["search_start"]):row["search_end"]]) > tail_limit), "Response tail exceeds extraction window")
        reference.require(row["substantial_feature_lead_samples"] <= CFG["early_feature_guard_samples"],
                          f"{EVENTS[i]['label']}: ambiguous peak anchor")

    output, extraction = reference.extract(samples, EVENTS, shift, pre_samples, tail_samples)
    evidence = {
        "sample_rate": sample_rate,
        "frames": len(samples),
        "channels": 2,
        "calibration_peak_sample": CALIBRATION_PEAK,
        "shift_samples": shift,
        "common_timing": timing,
        "peak_offsets_from_calibration": peak_offsets.tolist(),
        "peak_residuals": residuals.tolist(),
        "events": rows,
        "detection": detector,
        "routing": reference.ROUTING,
        "extraction": extraction,
        "limitations": [
            "Calibration is an operational peak convention, not physical direct-path latency.",
            "No reference-waveform correlation is performed in the single-input flow.",
            "Chronological event identity is assumed; identical impulses cannot prove renderer routing.",
        ],
    }
    return output, evidence


def process_wav(input_path: Path, output_path: Path, report_path: Path,
                *, pre_samples: int = 0, tail_samples: int = 24000) -> None:
    sample_rate, samples, _ = reference.read(input_path)
    output, evidence = process(samples, sample_rate, pre_samples=pre_samples,
                               tail_samples=tail_samples)
    wavfile.write(output_path, sample_rate, output)
    report_path.write_text(json.dumps(evidence, indent=2) + "\n")
