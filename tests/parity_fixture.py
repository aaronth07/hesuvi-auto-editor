"""Generate private-free sparse stereo convolution fixtures for parity_runner.cjs."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from oracle import EVENTS, SR, process


def fixture(global_shift: int, residuals: list[int] | None = None) -> tuple[np.ndarray, dict, np.ndarray]:
    frames = 432000
    audio = np.zeros((frames, 2), dtype=np.float32)
    residuals = list(residuals or [-3, -2, -1, 0, 1, 2, 3])
    itd = [5, -7, 3, -4, 9, -2, 6]
    probe = np.array([1.0, .13, -.08, .05, -.035, .021, .014, -.011,
                      .008, -.006, .004, .003, -.002, .0015, -.001, .0007], dtype=np.float64)
    conv_expected = np.zeros((24000, 14), dtype=np.float64)
    output_routes = {"FL": (0, 1), "SL": (2, 3), "BL": (4, 5), "FC": (6, 13),
                     "FR": (8, 7), "SR": (10, 9), "BR": (12, 11)}
    for i, event in enumerate(EVENTS):
        if event["label"] == "LFE":
            pair_peak = 53
            kernel_l = np.zeros(700); kernel_r = np.zeros(700)
            kernel_l[pair_peak] = .31
            kernel_r[pair_peak + 2] = -.31 * .6
            kernel_l[pair_peak + 80] = -.31 * .12
            response = np.column_stack((np.convolve(probe, kernel_l), np.convolve(probe, kernel_r))).astype(np.float32)
            start = event["sample"] + global_shift
            audio[start:start + len(response)] += response
            continue
        direction = [e["label"] for e in EVENTS if e["label"] != "LFE"].index(event["label"])
        peak = 53 + residuals[direction]
        level = 0.08 + direction * 0.035
        sign = -1.0 if direction % 2 else 1.0
        # Each channel response is a true convolution of a nontrivial probe with
        # a signed, direction-specific FIR. The dominant taps establish pair peak
        # timing; smaller taps make the output distinguishable over the full window.
        kernel_l = np.zeros(900); kernel_r = np.zeros(900)
        kernel_l[peak - 4] = sign * level * 0.11
        kernel_l[peak] = sign * level
        kernel_l[peak + 13] = -sign * level * 0.22
        kernel_l[peak + 511] = -sign * level * 0.28
        right_peak = peak + itd[direction]
        kernel_r[right_peak - 3] = -sign * level * 0.09
        kernel_r[right_peak] = -sign * level * 0.63
        kernel_r[right_peak + 19] = sign * level * 0.17
        kernel_r[peak + 523] = sign * level * 0.19
        response = np.column_stack((np.convolve(probe, kernel_l),
                                    np.convolve(probe, kernel_r))).astype(np.float32)
        start = event["sample"] + global_shift
        audio[start:start + len(response)] += response
        left, right = output_routes[event["label"]]
        conv_expected[:min(len(response), len(conv_expected)), left] = response[:len(conv_expected), 0]
        conv_expected[:min(len(response), len(conv_expected)), right] = response[:len(conv_expected), 1]
    gain = 10 ** (-2 / 20) / float(np.max(np.abs(conv_expected)))
    conv_expected = (conv_expected * gain).astype(np.float32)
    return audio, {"global_shift": global_shift, "directional_peak_residuals": residuals,
                   "itd_samples": itd, "probe_samples": len(probe)}, conv_expected


def generate(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for shift in (6, -5, 12037, -30000):
        samples, meta, conv_expected = fixture(shift)
        stem = f"shift_{shift:+d}"
        input_path = out_dir / f"{stem}_input.wav"
        expected_path = out_dir / f"{stem}_expected.wav"
        report_path = out_dir / f"{stem}_oracle.json"
        conv_path = out_dir / f"{stem}_convolution_expected.wav"
        wavfile.write(input_path, SR, samples)
        output, evidence = process(samples, SR)
        wavfile.write(expected_path, SR, output)
        wavfile.write(conv_path, SR, conv_expected)
        report_path.write_text(json.dumps({"fixture": meta, "oracle": evidence}, indent=2) + "\n")


if __name__ == "__main__":
    generate(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / ".generated")
