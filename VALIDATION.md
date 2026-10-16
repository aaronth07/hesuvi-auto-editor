# Validation

## Processing

The current suites pass 27 Python tests and 28 Node tests. The original `dirac_to_hesuvi.py` remains byte-identical to the supplied CommonTiming Fix. Browser processing and `align_hrir.py` use the same common-median pair-peak convention, one global gain, and HeSuVi channel order.

Complete float32 main and prefix comparisons pass against the original converter for synthetic common shifts, nonuniform directional timing, and the supplied output fixtures. Delayed convolution, channel order, ear peak differences, clipping, nonfinite samples, malformed WAVs, noise, missing/extra events, extraction bounds, prefix capacity, and omitted tails are covered. Native PCM and IEEE-float decoding is checked, including PCM16 and float64 edited inputs.

The exact supplied 14-channel Apple reference and original 7.1 Dirac stimulus are now included under `docs/assets/`, following explicit permission to publish those two files. Their SHA-256 hashes match the originals. Apple has a measured pair peak at sample 53 in every direction. The browser verifies the actual stimulus file and event schedule, then analyzes the actual reference waveform for each processing run. Defaults in the offline script use these same assets; missing copies are downloaded with checksum verification.

All eight supplied raw captures completed in the actual browser worker with automatic references. Every main and prefix sample matches the offline measured-reference converter. Eight delayed edited responses derived from those captures also match every offline sample, preserving interaural peak differences. Delayed-convolution maximum absolute error was 6.419827774939435e-08, within the measured float32 rounding bound. The six Dolby captures have all directional pair peaks at 53; the remaining two preserve their measured directional differences with median 53.

Edited alignment now estimates input and reference noise floors using the median absolute sample. Leading removal warns only above ten times their maximum, with a minimum threshold of 1e-6 (-120 dBFS). Tests cover automatic trimming below that threshold, reference-dominated noise, explicit browser continuation, CLI warning exit code 3, and `--allow-leading-truncation`. The removed peak, threshold, noise floors, and override are recorded. Choosing another input resets the override. Complete tails and common ear/direction timing remain unchanged.

## Browser and appearance

Actual browser checks cover automatic asset loading, raw/edited processing, warning/continuation, low-level noise, reset, mode changes, seven plots/14 channel rows, downloads, and cancellation. A blocked reference request produced a specific loading error; reloading restored the assets. Downloaded arrays were compared with offline outputs. The local HTTP launcher and extracted standalone package are checked separately from direct function tests. Direct `file://` use remains unsupported because the worker requires HTTP.

Background light opacity is 0.260 in the default dark theme and 0.180 in light, reduced automatically for other base colors when contrast requires it. Three compositor layers move in different directions; the cursor highlight stays bounded to 64 px. After settling, 350 ms of observation recorded zero background style mutations. Reduced motion cleared all background transforms. Dark desktop and light narrow layouts were inspected without horizontal document overflow. Material tests retain minimum text/muted contrast of 4.501 and trace contrast of 3.010. The Impeccable detector reported only the intentional Roboto Flex font choice specified by the user.

## Publication and limits

GitHub Pages publishes `main:/docs` from this repository. The old Spatial Audio Tools address retains only its redirect/link. The standalone application includes the two reference WAVs, scripts, static app, and tests; capture recordings, generated outputs, local reports, and screenshots are excluded. Private validation remains local.

The common-median convention does not identify physical direct-path arrival or separate capture-start delay from renderer latency. Identical source impulses cannot independently prove downstream speaker routing. Samples already removed during earlier editing cannot be restored.
