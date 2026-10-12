Historical baseline handoff, retained for reference. The current converter, browser app, and publishing arrangement are documented in README.md, PYTHON_REFERENCE.md, and VALIDATION.md. The original baseline is Git commit 04753c7.

# HESUVI AutoEdit handoff

## Current scope

A working Python CLI with a static frontend starter. The converter DSP is unchanged from the verified editor. The frontend selects local files, reads WAV headers, checks channel counts/rates/stimulus mask, and downloads a config. It does not upload audio, decode samples, execute DSP, play audio, or claim a validated impulse response.

Code is prepared for a private repository. Public documentation publication is a separate hosting action handled outside this bundle. No GitHub mutation or deployment was performed to produce this handoff. No deployment workflow, backend credentials, analytics, CDN, or external assets are included.

## Layout

- `dirac_to_hesuvi.py`: existing converter and CLI implementation
- `pyproject.toml`: package metadata and `hesuvi-auto-editor` entry point
- `config.json`: example with non-personal placeholder paths
- `test_dirac_to_hesuvi.py`: 10 standalone synthetic DSP tests
- `docs/index.html`: landing, guided preparation, setup, usage and limits
- `docs/editor-core.js`: bounded local RIFF header reader and config builder
- `docs/editor-ui.js`: file selection, status, reset and download behavior
- `tests/frontend.test.cjs`: synthetic metadata/config tests, Node 18+
- `PROVENANCE.sha256.json`: source identity and final file hashes

## Workflow

1. Open `docs/index.html` in a browser. No server is required for these classic scripts.
2. Select stimulus, reference and target WAVs. All filenames must be distinct. The starter requires a WAVE_EXTENSIBLE stimulus mask of 0x63f; the CLI supports a manually verified map when metadata is absent.
3. Download `config.local.json`. Place the three WAVs under `sources/` beside that config. Selection does not copy files or reveal full paths.
4. Install the Python CLI, run `--dry-run`, inspect diagnostics, then export.

Advanced controls expose only alignment mode, leading samples and tail samples. Confidence overrides remain manual CLI configuration. The frontend checks headers only; a corrupt or unsuitable waveform can still fail the CLI.

## Architecture boundary

Keep DSP and source-aware validation authoritative in Python for now. A future local backend could accept explicit local paths/config through a loopback-only service, enforce input/output isolation, and stream diagnostic status. It must define consent, lifecycle, resource limits, cancellation and stale-output handling before implementation. Do not silently introduce remote audio upload.

A future browser port would need equivalent NumPy/SciPy operations or a tested WebAssembly runtime. Required parity includes integer/sample handling, routing, shared gain, prefix archival, ambiguity gates, correlation thresholds and output hashes or justified tolerances. A visual waveform or browser file picker is not DSP parity.

## Verification status

- 10 synthetic DSP tests: pass
- Editable package build/install and installed CLI `--help`: pass in an isolated environment using existing numerical dependencies
- 8 Node tests for local WAV metadata/config building: pass; no private fixtures
- JavaScript syntax and static HTML/link checks: pass
- Browser rendering, file-dialog flows, config download interaction, keyboard behavior and mobile layout: not visually verified. Browser preview was unavailable after a dismissed permission request; no bypass or repeated request was attempted.
- End-to-end original-capture regression: not rerun in this distributable; the private recordings and previous outputs are intentionally excluded

## Acceptance checklist before publishing

1. Render at 1440px, 768px and 390px: no clipped controls, accidental horizontal overflow, or hidden status text.
2. Use keyboard navigation and visible focus; inspect labels, screen-reader status updates and native details control.
3. Select valid synthetic WAVs. Confirm metadata and config download; validate JSON with the Python CLI.
4. Select invalid/truncated/non-WAV files, wrong channel counts, different rates, wrong/missing stimulus mask and duplicate filenames. Config export must stay blocked where appropriate.
5. Rapidly replace a selection and clear while reading. Stale asynchronous results must not restore a cleared file.
6. Change advanced settings, reject fractional/negative invalid sample counts, reset and confirm defaults return.
7. Test no-JavaScript fallback; inspect DevTools network traffic to confirm zero audio transmission or external requests.
8. Verify GitHub Pages visibility explicitly. A private code repository does not by itself guarantee a private Pages site. Review publicly served files and access before deployment.
9. Run CLI synthetic tests and read the timing/cropping caveats. Never treat a dry run or old output WAV as a new successful export.

## Next implementation work

A browser-verified responsive pass, a tested config-to-CLI integration fixture, and a clear decision between local Python service and browser DSP port. No compensation processor or Apple-to-SOFA implementation is included in this editor.
