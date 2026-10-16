# Python reference

The Python converter uses the actual stimulus and a trusted stereo reference to establish timing. The browser automatically loads the bundled Apple reference and original 7.1 Dirac WAV. It validates the actual stimulus and measures reference waveform peaks. The separate `align_hrir.py` script aligns edited 14-channel inputs to an edited 14-channel reference, using the same common-median rule and retaining the complete tail and warning before discarding leading samples above its noise threshold. Apple and Dirac paths default to bundled, checksum-verified files; missing defaults are downloaded from this repository.

## Inputs and configuration

Set `stimulus`, `apple`, and `capture` in a local copy of `config.json`. Relative paths resolve beside that config file. All files must have the same sample rate. The stimulus must contain one Dirac sample for each of the eight 7.1 channels, including LFE, separated by more than 0.5 seconds. Its WAVE extensible speaker mask supplies channel order. If the mask is absent, provide a verified `source_channel_map` in stored-channel order.

The reference must have established stimulus-relative timing. It stays at shift zero. The script cannot independently establish its absolute time origin.

`alignment: "common_peak"` is the default. The script takes the median of the seven directional pair-peak offsets in the reference and target, then subtracts those medians. One integer shift applies to every target direction and both ears. Individual reference-to-target residuals and waveform correlation are not acceptance criteria in this mode.

The historical `apple_peak` and `apple_onset` modes retain their original matching checks. `capture_shift_samples` is an explicit override; it bypasses the peak ambiguity guard and the legacy timing/correlation gates, so review the response before using it.

`pre_samples` and `tail_samples` define the crop around each scheduled event. Their total must not exceed event spacing. With zero pre-roll and `archive_negative_prefix: true`, `archive_prefix_samples` earlier samples are saved in a separate WAV using the main output's gain. The default archive is 1,024 samples. Nonzero samples outside its capacity fail the run.

When using nonzero `pre_samples`, set `archive_negative_prefix: false` and choose enough pre-roll to retain all earlier nonzero samples. The supplied script creates separate prefix files only at zero pre-roll. The browser enforces prefix retention for nonzero pre-roll automatically.

The detected peak must fit inside the crop. In common mode, omitted tail samples must stay below the configured activity/noise threshold. That threshold is the maximum of `activity_floor`, the noise floor times `noise_multiplier`, and the event peak scaled by `activity_db`. The earlier-feature guard rejects a substantial feature preceding the strongest peak by more than `early_feature_guard_samples`.

## Run and outputs

Requires Python 3.10 or newer and the packages in `requirements.txt`.

```sh
python dirac_to_hesuvi.py --config config.local.json --dry-run
python dirac_to_hesuvi.py --config config.local.json
```

Dry-run writes diagnostics without WAVs. A successful common-mode export writes `Apple_HeSuVi_peak.wav`, `Far_HeSuVi_peak.wav`, and their negative-time prefix files when archival is enabled. Each main WAV is 14-channel float32 and uses one common gain to reach -2 dBFS. Prefix files use the corresponding main gain.

The script also writes `qa.json`, `events.csv`, detected-candidate reports, and `onset_diagnostics.png`. Reports include input paths and hashes, timing, extraction ranges, gains, and omitted energy. Keep them with your recordings rather than committing personal inputs.

Diagnostic failures exit with code 2 and write `failure.json`. Use a fresh output directory for each run: dry-run and failure do not remove older WAVs.

The original audited converter and its handoff are retained in Git commit `04753c7`. The current converter is byte-identical to the supplied CommonTiming Fix version; its hash is recorded in `PROVENANCE.sha256.json`.
