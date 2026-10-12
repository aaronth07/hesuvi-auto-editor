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
