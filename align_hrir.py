#!/usr/bin/env python3
"""Align an edited 14-channel HeSuVi WAV to a measured reference HRIR."""
import argparse
import json
import struct
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from dirac_to_hesuvi import DiagnosticError, ROUTING, read, require, stimulus, detect, match, extract, channel_mask

DETECTION = {'activity_floor': 1e-7, 'activity_db': -100, 'noise_multiplier': 20,
             'quiet_gap_seconds': .15, 'onset_floor': 1e-8, 'onset_db': -80,
             'early_feature_db': -20, 'max_schedule_residual_samples': 2048}


def read_input(path):
    rate, samples, metadata = read(path)
    mask = channel_mask(path)
    require(mask in (None, 0) or (samples.shape[1] == 2 and mask == 3),
            'WAV channel mask conflicts with the required channel order')
    if np.issubdtype(np.dtype(metadata['stored_dtype']), np.integer):
        with Path(path).open('rb') as file:
            file.seek(12)
            while True:
                header = file.read(8)
                require(len(header) == 8, 'WAV format chunk is missing')
                tag, size = struct.unpack('<4sI', header)
                if tag == b'fmt ':
                    fmt = file.read(min(size, 40))
                    bits = struct.unpack_from('<H', fmt, 14)[0]
                    if len(fmt) >= 40 and struct.unpack_from('<H', fmt)[0] == 65534:
                        bits = struct.unpack_from('<H', fmt, 18)[0]
                    require(0 < bits <= 32, 'Invalid integer PCM bit depth')
                    require(np.all(samples < 1-2**(1-bits)), 'Integer PCM contains full-scale samples; use an unclipped WAV')
                    break
                file.seek(size+(size & 1), 1)
    return rate, samples, metadata


def peak_positions(samples):
    rows = []
    for label, channels in ROUTING.items():
        pair = np.abs(samples[:, channels])
        require(np.all(np.max(pair, axis=0) > 0), f'{label}: each ear must contain a nonzero response')
        peak = int(np.argmax(np.max(pair, axis=1)))
        first = int(np.flatnonzero(np.max(pair, axis=1) > np.max(pair) * .1)[0])
        require(peak - first <= 48, f'{label}: ambiguous peak anchor; substantial earlier response precedes the peak by {peak-first} samples')
        ears = np.argmax(pair, axis=0)
        rows.append({'label': label, 'pair_peak_sample': peak,
                     'ear_peak_samples': [int(n) for n in ears]})
    return rows


def validate_hrir(samples, name):
    samples = np.asarray(samples, dtype=np.float64)
    require(samples.ndim == 2 and samples.shape[1] == 14 and len(samples) > 0,
            f'{name} must be a nonempty 14-channel HeSuVi HRIR')
    require(np.all(np.isfinite(samples)), f'{name} contains nonfinite samples')
    require(np.max(np.abs(samples)) < 1, f'{name} contains clipped samples; use an unclipped WAV')
    return samples


def align(samples, reference):
    """Apply one integer shift with zero padding; retain every nonzero sample."""
    samples = validate_hrir(samples, 'Input')
    reference = validate_hrir(reference, 'Reference')
    rows = peak_positions(samples)
    reference_rows = peak_positions(reference)
    anchor = int(np.median([r['pair_peak_sample'] for r in rows]))
    reference_anchor = int(np.median([r['pair_peak_sample'] for r in reference_rows]))
    shift = anchor - reference_anchor
    # A negative shift adds leading silence. A positive shift only removes silence.
    require(shift <= 0 or not np.any(samples[:shift]),
            'Alignment would remove nonzero leading samples; use a reference with a later peak')
    frames = max(len(samples), len(samples) - shift)
    output = np.zeros((frames, 14), dtype=np.float64)
    source_start = max(shift, 0)
    destination_start = max(-shift, 0)
    output[destination_start:destination_start+len(samples)-source_start] = samples[source_start:]
    peak = float(np.max(np.abs(output)))
    gain = 10 ** (-2/20) / peak
    output = (output * gain).astype(np.float32)
    return output, {
        'alignment': {'convention': 'common_peak', 'method': 'common_median_pair_peak',
                      'selected_shift_samples': shift, 'capture_median_peak_samples': anchor,
                      'reference_median_peak_samples': reference_anchor,
                      'reference_peak_offsets_samples': [r['pair_peak_sample'] for r in reference_rows],
                      'output_peak_samples': [r['pair_peak_sample']-shift for r in rows],
                      'physical_latency_identifiable': False},
        'events': rows, 'reference_events': reference_rows, 'routing': ROUTING,
        'extraction': {'pre_samples': 0, 'output_frames': frames, 'output_channels': 14,
                       'gain_scalar': gain, 'pre_gain_peak': peak, 'target_peak_dbfs': -2,
                       'output_peak_dbfs': float(20*np.log10(np.max(np.abs(output)))),
                       'window_qa': []},
        'status': 'passed', 'workflow': 'edited_hrir',
    }


def align_capture(samples, reference, events):
    """Extract a raw capture using the actual stimulus and edited reference peaks."""
    samples = np.asarray(samples, dtype=np.float64)
    require(samples.ndim == 2 and samples.shape[1] == 2 and len(samples) > 0,
            'Capture must be nonempty stereo audio')
    require(np.all(np.isfinite(samples)) and np.max(np.abs(samples)) < 1,
            'Capture contains nonfinite or clipped samples')
    # Validate the reference using the same rules as edited-input alignment.
    reference_peaks = peak_positions(validate_hrir(reference, 'Reference'))
    rows = match(events, detect(samples, 48000, DETECTION)[0], 48000, DETECTION)
    directions = [row for row in rows if row['label'] != 'LFE']
    require(len(directions) == 7, 'Expected seven directional events')
    reference_anchor = int(np.median([row['pair_peak_sample'] for row in reference_peaks]))
    capture_anchor = int(np.median([row['peak']-row['sample'] for row in directions]))
    shift = capture_anchor-reference_anchor
    require(min(np.diff([e['sample'] for e in events])) >= 24000, 'Stimulus events overlap the 24,000-sample extraction window')
    for row in directions:
        label = row['label']; start = row['sample']+shift; end = start+24000
        require(row['substantial_feature_lead_samples'] <= 48, f'{label}: ambiguous peak anchor')
        require(start >= 1024 and end <= len(samples), f'{label}: extraction or prefix exceeds capture bounds')
        require(start <= row['peak'] < end, f'{label}: extraction omits the detected response peak')
        require(row['onset'] < end, f'{label}: extraction ends before the onset')
        require(not np.any(samples[row['search_start']:max(row['search_start'],start-1024)]),
                f'{label}: nonzero pre-response exceeds the 1024-sample prefix archive')
        limit = max(DETECTION['activity_floor'],row['noise_floor']*DETECTION['noise_multiplier'],row['peak_abs']*10**(DETECTION['activity_db']/20))
        require(not np.any(np.abs(samples[max(end,row['search_start']):row['search_end']]) > limit),
                f'{label}: response tail exceeds the extraction window')
    output, metadata = extract(samples, events, shift, 0, 24000)
    prefix = np.zeros((1024,14),np.float64)
    for row in directions:
        start = row['sample']+shift
        prefix[:,ROUTING[row['label']]] = samples[start-1024:start]
    prefix = (prefix*metadata['gain_scalar']).astype(np.float32)
    reference_by_label = {row['label']:row['pair_peak_sample'] for row in reference_peaks}
    report = {'status':'passed','workflow':'raw_capture','events':rows,'reference_events':reference_peaks,
              'routing':ROUTING,'alignment':{'method':'common_median_pair_peak',
              'selected_shift_samples':shift,'reference_median_peak_samples':reference_anchor,
              'capture_median_peak_samples':capture_anchor,
              'output_peak_samples':[row['peak']-row['sample']-shift for row in directions],
              'residual_samples':[row['peak']-row['sample']-reference_by_label[row['label']]-shift for row in directions],
              'physical_latency_identifiable':False},'extraction':metadata}
    return output,prefix,report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--reference', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--capture', action='store_true', help='Convert a raw stereo stimulus recording instead of an edited HRIR')
    parser.add_argument('--stimulus', type=Path, help='Original eight-channel 7.1 Dirac WAV; required with --capture')
    args = parser.parse_args()
    try:
        require(args.output.suffix.lower() == '.wav', 'Output filename must end in .wav')
        require(args.output.resolve() not in (args.input.resolve(), args.reference.resolve()),
                'Output must be a different file from input and reference')
        require(not args.output.exists(), 'Output already exists; choose a new filename')
        rate, samples, info = read_input(args.input)
        reference_rate, reference, reference_info = read_input(args.reference)
        require(rate == reference_rate == 48000, 'Input and reference must be native 48,000 Hz')
        require(args.capture == (args.stimulus is not None), 'Use --capture and --stimulus together for raw recordings')
        prefix = None
        if args.capture:
            source_rate, events, _ = stimulus(args.stimulus, ['FL','FR','FC','LFE','BL','BR','SL','SR'])
            require(source_rate == rate, 'Stimulus must be native 48,000 Hz')
            output, prefix, report = align_capture(samples, reference, events)
        else:
            output, report = align(samples, reference)
        report.update(input=info, reference=reference_info)
        report['extraction']['sample_rate'] = rate
        report_path = args.output.with_suffix('.json')
        require(not report_path.exists(), 'Output report already exists; choose a new filename')
        prefix_path = args.output.with_name(args.output.stem+'_negative_time_prefix.wav')
        require(prefix is None or not prefix_path.exists(), 'Output prefix already exists; choose a new filename')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        wavfile.write(args.output, rate, output)
        if prefix is not None:
            wavfile.write(prefix_path, rate, prefix)
        report_path.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
        print(f"Applied common shift: {report['alignment']['selected_shift_samples']} samples")
    except (DiagnosticError, OSError, ValueError, struct.error) as error:
        parser.exit(2, f'Error: {error}\n')


if __name__ == '__main__':
    main()
