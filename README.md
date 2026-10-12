# HeSuVi auto editor

Deterministic Python command-line editor for extracting a 14-channel HeSuVi impulse response from an eight-event, stereo Dirac capture. No model inference, network calls, EQ, phase processing, per-ear alignment, or resampling at runtime.

## Inputs you must supply

This repository includes source code and synthetic tests only. It does **not** contain recordings, generated presets, private reports, or the original Dirac stimulus.

Provide all three WAV files locally:

1. The original eight-channel 7.1 Dirac stimulus actually used for capture: exactly one nonzero sample per channel, all eight events including LFE, with events separated by more than 0.5 seconds. Its WAVE_EXTENSIBLE speaker mask must identify FL, FR, FC, LFE, BL, BR, SL and SR. Only when the mask is absent may a independently verified `source_channel_map` list specify stored channel order. Present metadata cannot be overridden.
2. A trusted stereo Apple reference recording of that same stimulus, with its stimulus-relative timing already established. The editor leaves this reference at shift zero; it cannot discover the reference's absolute time origin independently.
3. A raw stereo target capture containing the same eight events in the same chronological playback order.

All files must use the same sample rate. The eight input events include LFE, which is checked but omitted from the fourteen output channels. Recordings need enough leading and trailing data for extraction, a correlation window from stimulus-relative -1024 through +4095 samples, and diagnostic plotting. The example uses 48 kHz recordings; its 24,000-frame tail equals 0.5 seconds at 48 kHz. Window settings are in samples and should be reviewed for any other sample rate.

## Install and run

Requires Python 3.10+.

```sh
python -m venv .venv
# Activate .venv using the command for your shell, then:
python -m pip install -r requirements.txt
python -m unittest -v test_dirac_to_hesuvi
```

Copy `config.json` to `config.local.json`, set its three input paths, and choose a fresh `output_dir` for each run. Relative paths resolve beside the config. The checked-in config has placeholder paths only.

```sh
python dirac_to_hesuvi.py --config config.local.json --dry-run
# Review qa.json, events.csv, candidate detections and onset_diagnostics.png.
python dirac_to_hesuvi.py --config config.local.json
```

Dry-run creates diagnostics but no WAVs. A successful export creates `Apple_HeSuVi_peak.wav` and `Far_HeSuVi_peak.wav` (or `_onset.wav` in onset mode), each a 14-channel float32 WAV at the input sample rate. Apple and Far are historical output labels for the reference and target, respectively. Each whole WAV gets one scalar gain to a maximum absolute sample of -2 dBFS. Relative ear and direction levels, polarity and within-window timing are retained.

## Timing and preservation limits

The default `apple_peak` convention measures one shared integer offset across the seven full-range directions and cross-checks it with stereo waveform correlation. This is a main-impulse alignment convention, **not** identification of physical direct-path arrival or separate capture-start and renderer latency. Source chronology is an assumption: identical Dirac samples cannot prove a renderer has not reordered speakers.

A substantial earlier feature more than 48 samples before a strongest peak fails the default pipeline, using a configurable -20 dB relative threshold. Weaker or closer features remain ambiguous. `apple_onset` is an explicit alternative, but threshold-based onset changes with threshold and noise. `capture_shift_samples` is an expert override that bypasses alignment/correlation confidence gates and must be justified manually; it does not bypass source mapping, event counts or extraction bounds.

No clock-drift correction is implemented. Nonconstant timing, weak/disagreeing correlation, unknown mapping, missing/extra events, or rate mismatches fail diagnostic checks. Longer or noisy recordings require reviewed parameters, not assumptions of success.

With `pre_samples: 0`, negative-time response is omitted from the main preset and archived separately when `archive_negative_prefix` is enabled. A prefix file is **not a standalone preset**. Concatenating it before the main output restores that retained prefix using the same gain but adds playback delay (1024 samples = 21.333 ms at 48 kHz). Alternatively, use a reviewed nonzero `pre_samples`, which adds the same prefix length to both main outputs. Cropping changes frequency response; inspect reported omitted-prefix and tail energy. Archives do not guarantee that a selected finite tail retains every sample. Preserve originals for full recovery; normalization and float32 rounding are not losslessly invertible.

The unchanged converter's QA `recoverability` text refers to originals under `sources/`; this describes the original local package convention, not files included in this repository. Input paths and hashes appear in local diagnostics. Do not commit those reports or personal recordings.

## Routing and failure handling

Zero-based HeSuVi routing, in left/right pair order: FL 0/1, SL 2/3, BL 4/5, FC 6/13, FR 8/7, SR 10/9, BR 12/11. LFE is excluded.

Diagnostic failures exit with code 2 and write `failure.json`. Ordinary filesystem/JSON errors may raise normal Python errors. Use a fresh output directory: a failed or dry run does not remove old WAVs. Never mistake existing audio for a successful new export.

## Tests and provenance

Ten self-contained synthetic tests cover delay detection, noise, polarity, stronger late echoes, missing/extra events, drift rejection, routing/interaural timing/global gain, LFE exclusion, and end-to-end rejection of a stronger late replica. No personal audio is needed to run them. Original private-fixture regression tests are not included; those require the original recordings and prior outputs. The converter DSP and dependency requirements are copied unchanged from the verified editor; configuration paths and documentation are sanitized, and tests are made independent of private fixtures.

No open-source license has been granted by this repository. Keep it private unless its owner explicitly authorizes a release.

## Package framework and docs

Install the editable CLI from the repository root with `python -m pip install -e .`. The equivalent installed command is `hesuvi-auto-editor --config config.local.json --dry-run`. The direct Python command above remains supported. `pyproject.toml` defines the package, dependencies and CLI entry point without modifying the converter DSP.

On Windows, activate with `.venv\Scripts\Activate.ps1`; on macOS/Linux use `source .venv/bin/activate`. If PowerShell blocks activation, run `.venv\Scripts\python.exe` directly rather than changing execution policy.

`docs/index.html` is a self-contained static setup/usage page with `docs/.nojekyll`, prepared as a future GitHub Pages source. It has no backend, file upload, audio processing, tracking or external assets. Open it directly for a local preview. Pages deployment is not configured; no deployment workflow or public site is enabled. Decide site visibility separately before publishing, even while the repository is private.

## Frontend starter

Open `docs/index.html` locally. Choose the original stimulus and two stereo captures to inspect their WAV header metadata and download a local CLI config. No audio leaves the browser and no audio conversion runs there. Use distinct filenames and place the files in `sources/` beside the downloaded config. A compatible header is not proof of valid stimulus content or timing: run the Python dry run next.

The frontend requires an eight-channel stimulus with mask `0x63f` and same-rate stereo captures. Advanced settings expose alignment, leading samples and tail samples; other settings remain in the CLI config. Run frontend core tests with `node --test tests/frontend.test.cjs` (Node 18+). See `HANDOFF.md` for architecture boundaries, verification gaps and publication acceptance tests.
