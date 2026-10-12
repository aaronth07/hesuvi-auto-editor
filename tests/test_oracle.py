import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from scipy.io import wavfile

TEST_DIR = Path(__file__).resolve().parent
if str(TEST_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_DIR))
from oracle import SR, process, process_wav
from parity_fixture import fixture


class OracleInputNormalizationTests(unittest.TestCase):
    def test_integer_samples_are_normalized_like_reference_reader(self):
        samples, _, _ = fixture(6)
        pcm = np.rint(samples * 32768).astype(np.int16)
        normalized = pcm.astype(np.float64) / 32768
        actual, _ = process(pcm, SR)
        expected, _ = process(normalized, SR)
        np.testing.assert_array_equal(actual, expected)

    def test_process_wav_normalizes_integer_pcm(self):
        samples, _, _ = fixture(6)
        pcm = np.rint(samples * 32768).astype(np.int16)
        expected, _ = process(pcm, SR)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, output, report = directory / "input.wav", directory / "output.wav", directory / "qa.json"
            wavfile.write(source, SR, pcm)
            process_wav(source, output, report)
            rate, written = wavfile.read(output)
            self.assertEqual(rate, SR)
            np.testing.assert_array_equal(written, expected)
            self.assertEqual(json.loads(report.read_text())["shift_samples"], 6)


if __name__ == "__main__":
    unittest.main()
