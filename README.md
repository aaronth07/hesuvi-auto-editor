# HeSuVi Auto Editor

HeSuVi Auto Editor takes an unedited stereo recording of the supplied 7.1 Dirac stimulus, applies one common timing offset, and exports a 14-channel HeSuVi WAV. It preserves the timing between the ears, the differences between directions, and their relative levels.

[Open the browser editor](https://aaronth07.github.io/hesuvi-auto-editor/).

## Browser version

Select **Unedited stereo capture** for a raw 48 kHz stereo WAV containing all eight stimulus events, including LFE. Select **Process recording**, then download the WAV. The exact [Apple reference](docs/assets/apple-reference.wav) and original [7.1 Dirac stimulus](docs/assets/dirac-7.1.wav) load automatically from the included assets. The worker verifies the stimulus and measures the actual reference peaks for every run.

Select **Edited HeSuVi HRIR** for an existing 14-channel WAV, then select **Align HRIR**. It uses the same Apple reference automatically. All channels shift together and receive one common gain. Low-level leading noise is removed when shifting earlier; trailing samples are retained and silence is added when needed. Leading samples above ten times the greater of the input and reference median absolute noise floors trigger a warning. **Align and trim leading samples** explicitly allows that removal. The threshold has a −120 dBFS minimum and is recorded with the removed peak level and any override. Samples removed during earlier editing cannot be restored.

Processing runs in your browser. The recording is not uploaded. The output is a 48 kHz, 14-channel float32 WAV, with one gain applied to the whole file so its highest sample reaches -2 dBFS.

**Impulse responses and statistics** shows both ears for each of the seven directions, with a common amplitude scale. The channel statistics use the complete output. **Download report** saves the detected events, timing offset, gain, hashes, extraction ranges, and channel statistics.

At zero pre-roll, **Download prefix** saves the 1,024 samples before each output origin using the same gain as the main WAV. This file preserves earlier samples for reconstruction. It is not a standalone HeSuVi response, and adding it before the main WAV adds 21.333 ms of playback delay.

Leave **Advanced settings** at their defaults for normal use: zero pre-roll and 24,000 response samples, or 500 ms. If you override them, their total must not exceed 48,000 samples. Increase pre-roll if earlier samples exceed the prefix archive, or increase response length if the peak or above-threshold tail would be cut off. Further guidance is under **About the calibration**.

The editor supports Simple and Glass layouts, light and dark themes, and an editable base background color. Appearance changes do not affect processing.

### Run locally

Extract the standalone ZIP and double-click **Launch.cmd** on Windows. Python 3 is required for the local server; the browser app does not need the Python DSP packages. Keep the launcher window open while using it.

On other platforms, run:

```sh
python3 launch.py
```

For a fixed port without opening the browser automatically:

```sh
python launch.py --port 8765 --no-browser
```

Open the printed localhost address. Opening `docs/index.html` directly through `file://` prevents the processing worker from starting.

## Python script

`dirac_to_hesuvi.py` is the supplied CommonTiming Fix reference. It uses three local files: the original eight-channel stimulus, a trusted stereo Apple reference with established timing, and the raw stereo recording. All three must have the same sample rate. The browser uses an equivalent built-in calibration instead of requiring those reference files each time.

Install the Python dependencies:

```sh
python -m pip install -r requirements.txt
```

Copy `config.json` to `config.local.json`, set the three input paths, and choose a fresh output directory. Relative paths resolve beside the config file. Run a dry run first:

```sh
python dirac_to_hesuvi.py --config config.local.json --dry-run
python dirac_to_hesuvi.py --config config.local.json
```

The script writes `qa.json`, event diagnostics, plots, and the extracted WAVs. `Apple_HeSuVi_peak.wav` is the reference output; `Far_HeSuVi_peak.wav` is the target recording. Apple and Far are historical labels and do not identify the renderer used for the target. Prefix WAVs are written separately when prefix archival is enabled at zero pre-roll.

The default alignment is `common_peak`. Historical `apple_peak` and `apple_onset` modes remain available. See [the Python reference guide](PYTHON_REFERENCE.md) for the full configuration and output details.

## Edited HRIR script

Use the separate timing-only script for existing 48 kHz, 14-channel HeSuVi WAVs:

```sh
python align_hrir.py --input edited.wav --output aligned.wav
```

To convert a raw stereo capture against an edited 14-channel reference using the actual stimulus, add the capture options:

```sh
python align_hrir.py --capture --input recording.wav --output converted.wav
```

This capture mode uses the original detector and extractor, a 24,000-sample response, and a 1,024-sample negative-time prefix at the main gain. The original config-based converter remains available for complete stereo reference captures and custom extraction settings.

The script writes the aligned float32 WAV and a JSON report beside it. Choose a new output name; input, reference, and existing outputs are protected against overwriting. Apple and Dirac assets are included in the package; if missing, the script downloads checksum-verified copies from this repository into its user cache. Explicit `--reference` and `--stimulus` paths remain available. Use `--allow-leading-truncation` to continue after reviewing an above-noise leading-sample warning. The reference must already have the intended time origin. Both browser and Python use the difference between the two median directional pair peaks, preserving interaural and directional timing.

## Timing and export

For each of the seven full-range directions, the processor measures the stereo pair peak relative to its scheduled stimulus event. It takes their median and applies one integer crop offset to every direction and both ears. The browser measures all seven Apple reference pair peaks and aligns the capture median to their median, matching offline `common_peak`. The bundled reference has a median of 53 samples. It does not force each individual peak to sample 53 or reject a recording because its directional peak differences do not match Apple.

This is an editing convention. It cannot separate capture-start delay from renderer latency, and identical stimulus impulses cannot independently prove downstream speaker routing. Event count and schedule checks, the earlier-feature guard, extraction bounds, prefix capacity, and tail checks remain active. Preserve the original recording.

The left/right output channels are FL 1/2, SL 3/4, BL 5/6, FC 7/14, FR 9/8, SR 11/10, and BR 13/12. LFE is detected and excluded. Each main output uses one common gain; a prefix uses its corresponding main output's gain.

## Source and validation

This repository contains both the Python reference and the browser implementation. GitHub Pages serves `docs/` directly from this repository. The previous Spatial Audio Tools site links here and redirects its old HeSuVi address; it does not maintain a copied processor.

The Python reference matches the supplied fixed script byte-for-byte: SHA-256 `ba74203aa650019cd70958b602bd0c1b6c1cd605a0896a59dece1d3d19d3e133`. The original audited script is retained in Git commit `04753c7`.

Run the tests with the Python dependencies and Node.js installed:

```sh
python -m unittest -v test_dirac_to_hesuvi test_common_peak tests/test_oracle.py tests/test_align_hrir.py
node --test tests/frontend.test.cjs tests/parity_runner.cjs tests/processor_matrix.cjs tests/materials.cjs tests/common_timing.cjs tests/reference_alignment.cjs
```

The Node parity tests use `.venv/Scripts/python.exe` on Windows by default. Set `PYTHON` to an absolute Python executable path if needed. Test WAVs are generated under `tests/.generated/` and are not committed. The two explicitly supplied reference WAVs are included. Capture recordings, converted listening files, and local reports are excluded from the repository and the standalone app package. See [VALIDATION.md](VALIDATION.md) for the comparisons performed and their limits.
