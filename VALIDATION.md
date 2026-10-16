# Validation

Validated 2026-10-12 using the supplied CommonTiming Fix package. Its manifest hashes were checked before installing the reference script. `dirac_to_hesuvi.py` remains byte-identical to that version, SHA-256 `ba74203aa650019cd70958b602bd0c1b6c1cd605a0896a59dece1d3d19d3e133`.

## Automated comparisons

```sh
python -m unittest -v test_dirac_to_hesuvi test_common_peak tests/test_oracle.py
node --test tests/frontend.test.cjs tests/parity_runner.cjs tests/processor_matrix.cjs tests/materials.cjs tests/common_timing.cjs
```

19 Python tests and 22 Node tests passed. The Python tests include the seven supplied common-timing tests and retained legacy-mode behavior. Browser parity covers all output samples for common shifts of +6, -5, +12,037, and -30,000 samples, all 12 standard/extensible PCM and float encoding combinations, channel order, ear timing, common gain, extraction bounds, earlier-feature ambiguity, prefix capacity, omitted peaks, and above-threshold tail rejection.

The full revised Python CLI was also run on three synthetic stereo captures, including large directional timing differences that the old four-sample acceptance gate rejected. Browser main and prefix WAVs match every CLI sample: 336,000 main samples and 14,336 prefix samples per case. The prefix uses the main gain.

The supplied Cyberpunk and Witcher main/prefix WAVs were compared using locally reconstructed PCM24 response windows. Each reconstructed window was checked by applying its reported gain and float32 conversion to reproduce the supplied samples exactly. A synthetic LFE event completed the test recording. Both the browser and the revised CLI reproduce every main and prefix sample from the supplied WAVs. These are golden-derived recordings, not the original private capture files; those files were not found locally. This does not independently validate the original input hashes or the original recording's discarded data.

A one-second 20–20,000 Hz logarithmic sweep after 125 ms of silence was convolved with all 14 browser output channels and the independently extracted, common-gain raw windows. Maximum absolute difference was 6.222e-8 across the five cases, within the measured float32 rounding bound. Generated fixtures and reports remain under `tests/.generated/` and are excluded from Git and the standalone package.

## Browser and appearance

The browser flow was exercised through file selection, processing, seven paired impulse plots, 14 channel statistics, and both WAV downloads. The downloaded Witcher main and prefix arrays match the supplied arrays exactly. A short response produced a specific tail-cutoff error; 128-sample pre-roll processed successfully and hid the separate prefix download. Reset hid output, revoked the prefix link, and disabled processing.

The lighting uses persistent 64 px layers, faded between targets instead of repeatedly inserted and removed. After first visiting four targets, 24 repeated transitions across them produced zero child insertions/removals. The recording panel has a stable translucent surface without backdrop blur over the moving ambient layer. Control shadows follow the pointer smoothly; panel shadows stay stable. The ambient layer stays fixed while the Appearance dialog is open. Earlier appearance checks covered both themes, 365 px layouts, keyboard disclosure/focus, reduced motion, touch cleanup, and zero idle style updates. Current contrast tests still pass: Glass text/muted at least 4.500 and traces 3.010; Simple text 6.097 and muted 5.039. The Impeccable detector's Roboto warning is an intentional exception to preserve the user's specified Roboto Flex font.

The original physical captures are not included. Timing remains an operational common-median convention, not a measurement of separate capture-start latency, renderer latency, or acoustic direct-path arrival.

## Publishing

The application source and Python reference are kept in `aaronth07/hesuvi-auto-editor`. GitHub Pages publishes `main:/docs`. The Spatial Audio Tools repository keeps its project link and an old-address redirect; its copied HeSuVi runtime files are removed. Assets, including the worker and its processor import, use content-based URL versions to avoid stale combinations after updates.

Current hosting is [aaronth07.github.io/hesuvi-auto-editor](https://aaronth07.github.io/hesuvi-auto-editor/), published from the app repository's `main:/docs` at source commit `50d190f`. The old Spatial Audio Tools deployment at source commit `01ada94` no longer contains copied runtime files; its deployed old address redirects to the new app, and the project directory links directly to it. Both Pages builds completed successfully.

## Measured-reference and edited-HRIR alignment (2026-10-16)

`align_hrir.py` aligns existing 14-channel, 48 kHz HRIR files to a measured 14-channel reference. Browser reference analysis measures all seven directional pair peaks from either a 14-channel HRIR or, in the capture workflow, the complete stereo reference capture. Saved 53-sample calibration remains a separate capture-only option. The supplied raw Python reference remains byte-identical.

The current suites pass 25 Python tests and 26 Node tests. New fixtures deliberately use a reference median of 137 samples with unequal directional offsets. Both stereo and 14-channel references produce raw main and prefix arrays identical to the full offline converter. Edited-HRIR outputs match every offline float32 sample for shifts of -84, 0, and 216 samples, including quiet tails, zero padding, channel order, and interaural delays. PCM16 and float64 edited inputs also match complete offline arrays. Independent delayed-convolution checks, common -2 dBFS gain, ambiguous peaks, silence, rate/channel errors, nonfinite samples, clipping, leading-sample loss, and CLI overwrite protection pass.

Actual local browser tests covered file selection for input/reference, edited and raw processing, measured-reference diagnostics, seven plots/14 channel rows, WAV/prefix downloads, reference errors, reset, and mode switching. Downloaded edited output and raw main/prefix arrays exactly match offline outputs. A running worker was canceled on its Hashing input progress notification; status became Processing canceled, output stayed hidden, and the old WAV link was removed. No app console warnings or errors were recorded. Dark and light layouts were inspected at narrow widths; the reference selectors stack rather than truncate their labels, with no horizontal document overflow.

The exact local 14-channel reference and original stimulus were subsequently supplied for private validation. All seven reference pair peaks measure 53 samples. All eight supplied raw recordings completed in the browser worker, and every main/prefix sample matches the offline measured-reference CLI. Eight delayed edited HRIRs derived from these recordings also completed in the browser and match every offline output sample. Interaural peak differences are preserved in every direction. Delayed-convolution maximum absolute error across these real captures is 6.419827774939435e-08, within the independently measured float32 rounding bound. The six Dolby recordings have all directional pair peaks at 53 after alignment; the other two retain measured directional differences with median 53. Reference audio, private filenames/paths, and recordings are not published. The common-peak convention does not identify physical latency.
