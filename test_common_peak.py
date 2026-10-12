import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from scipy.io import wavfile
import dirac_to_hesuvi as d

ROOT = Path(__file__).resolve().parent
CFG = json.loads((ROOT / 'config.json').read_text())
TEST_ASSETS = tempfile.TemporaryDirectory()
STIMULUS = Path(TEST_ASSETS.name) / 'stimulus.wav'
SOURCE_CHANNELS = ['FL','FR','FC','LFE','BL','BR','SL','SR']
source = np.zeros((48000*9, 8), np.int16)
for i, label in enumerate(['FL','SL','BL','FC','FR','SR','BR','LFE']):
    source[(i+1)*48000, SOURCE_CHANNELS.index(label)] = 32767
wavfile.write(STIMULUS, 48000, source)

class CommonPeakTests(unittest.TestCase):
    def run_capture(self, folder, offsets, delay=12345, late=False, tail=False,
                    archive=True, leading=0, alignment='common_peak'):
        sr, events, _ = d.stimulus(STIMULUS, SOURCE_CHANNELS)
        reference = np.zeros((sr * 10, 2), np.float32)
        capture = np.zeros_like(reference)
        for i, event in enumerate(events):
            t = event['sample']
            reference[t+53] = (.4, .2)
            p = t + delay + offsets[i]
            capture[p-3:p, 0] = (.002, -.007, .025)
            capture[p, 0] = .2 + i * .03
            capture[p+7, 1] = -( .1 + i * .01)
            capture[p+20, 1] = .003
            if late:
                capture[p+400, 0] = .9
            if tail and i == 0:
                capture[t+delay+2000, 0] = .01
        capture[events[2]['sample']+delay-9, 0] = 1/8388608
        if leading:
            capture = np.pad(capture, ((leading, 0), (0, 0)))
        wavfile.write(folder/'reference.wav', sr, reference)
        wavfile.write(folder/'capture.wav', sr, capture)
        config = dict(CFG, stimulus=str(STIMULUS), apple='reference.wav',
                      capture='capture.wav', alignment=alignment, tail_samples=1000,
                      archive_negative_prefix=archive, source_channel_map=SOURCE_CHANNELS)
        before = hashlib.sha256((folder/'capture.wav').read_bytes()).hexdigest()
        with patch.object(d, 'plots'), contextlib.redirect_stdout(io.StringIO()):
            d.run(config, folder, folder, False)
        self.assertEqual(before, hashlib.sha256((folder/'capture.wav').read_bytes()).hexdigest())
        return capture, events, json.loads((folder/'qa.json').read_text())

    def test_directional_timing_and_all_samples_preserved(self):
        offsets = [53, 48, 53, 57, 54, 50, 53, 53]
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            capture, events, qa = self.run_capture(folder, offsets)
            self.assertEqual(qa['alignment']['selected_shift_samples'], 12345)
            self.assertEqual(qa['alignment']['output_peak_samples'], offsets[:7])
            self.assertEqual(qa['alignment']['reference_residuals_are_acceptance_criteria'], False)
            _, result = wavfile.read(folder/'Far_HeSuVi_peak.wav')
            _, prefix = wavfile.read(folder/'Far_negative_time_prefix.wav')
            gain = qa['captures']['Far']['extraction']['gain_scalar']
            for event in events:
                if event['label'] == 'LFE':
                    continue
                start = event['sample'] + 12345
                channels = d.ROUTING[event['label']]
                np.testing.assert_array_equal(result[:, channels],
                    (capture[start:start+1000].astype(np.float64)*gain).astype(np.float32))
                np.testing.assert_array_equal(prefix[:, channels],
                    (capture[start-1024:start].astype(np.float64)*gain).astype(np.float32))
                self.assertEqual(np.argmax(abs(result[:, channels[1]]))-
                                 np.argmax(abs(result[:, channels[0]])), 7)
            self.assertAlmostEqual(float(np.max(abs(result))), 10**(-2/20), places=7)

    def test_leading_delay_changes_only_common_offset(self):
        offsets = [55, 49, 52, 59, 56, 52, 53, 53]
        outputs = []
        for leading in (0, 23017):
            with tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                _, _, qa = self.run_capture(folder, offsets, leading=leading)
                self.assertEqual(qa['alignment']['selected_shift_samples'], 12345+leading)
                outputs.append(wavfile.read(folder/'Far_HeSuVi_peak.wav')[1])
        np.testing.assert_array_equal(*outputs)

    def test_late_stronger_echo_still_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            with self.assertRaisesRegex(d.DiagnosticError, 'substantial earlier feature'):
                self.run_capture(folder, [53]*8, late=True)
            self.assertFalse((folder/'Far_HeSuVi_peak.wav').exists())

    def test_omitted_tail_rejected_before_audio_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            with self.assertRaisesRegex(d.DiagnosticError, 'tail exceeds'):
                self.run_capture(folder, [53]*8, tail=True)
            self.assertFalse((folder/'Apple_HeSuVi_peak.wav').exists())

    def test_missing_prefix_permission_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(d.DiagnosticError, 'omits pre-response'):
                self.run_capture(Path(tmp), [53]*8, archive=False)

    def test_original_strict_mode_retains_peak_match_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(d.DiagnosticError, 'Nonconstant capture alignment'):
                self.run_capture(Path(tmp), [53,48,53,57,54,50,53,53], alignment='apple_peak')

    def test_median_convention_uses_separate_reference_anchor(self):
        events = [{'label': label, 'sample': (i+1)*48000}
                  for i, label in enumerate(list(d.ROUTING)+['LFE'])]
        r = [0,0,0,53,53,53,53,0]
        t = [53,53,53,53,0,0,0,0]
        ref = [{'peak': e['sample']+v} for e,v in zip(events,r)]
        cap = [{'peak': e['sample']+1000+v} for e,v in zip(events,t)]
        shift, metadata = d.common_peak_shift(events, ref, cap)
        self.assertEqual(shift, 1000)
        self.assertEqual(metadata['reference_median_peak_samples'], 53)

if __name__ == '__main__':
    unittest.main(verbosity=2)
