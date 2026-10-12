"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const generated = path.join(__dirname, ".generated");
const bundledPython = path.join(root, ".venv", "Scripts", "python.exe");
const python = process.env.PYTHON && existsSync(process.env.PYTHON)
  && statSync(process.env.PYTHON).isFile()
  ? process.env.PYTHON : bundledPython;
const processorPath = path.join(root, "docs", "processor.js");

function runPython(args) {
  const proc = spawnSync(python, args, { cwd: root, encoding: "utf8" });
  assert.equal(proc.status, 0,
    `Python failed (${proc.error?.message || proc.signal || "unknown exit"}):\n${proc.stdout}\n${proc.stderr}`);
}

function readFloatWav(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF", "output must be RIFF/WAVE");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  let offset = 12;
  let format;
  let channels;
  let sampleRate;
  let bits;
  let data;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + size <= bytes.length, `truncated ${id} chunk`);
    if (id === "fmt ") {
      format = bytes.readUInt16LE(start);
      channels = bytes.readUInt16LE(start + 2);
      sampleRate = bytes.readUInt32LE(start + 4);
      bits = bytes.readUInt16LE(start + 14);
    } else if (id === "data") {
      data = bytes.subarray(start, start + size);
      break;
    }
    offset = start + size + (size & 1);
  }
  assert.equal(format, 3, "output WAV should use IEEE float format");
  assert.equal(bits, 32, "output WAV should use float32 samples");
  assert.equal(channels, 14);
  assert.equal(sampleRate, 48000);
  assert.ok(data, "output WAV has a data chunk");
  assert.equal(data.length % (channels * 4), 0);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const samples = new Float32Array(data.length / 4);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getFloat32(i * 4, true);
  return { samples, frames: samples.length / channels, channels, sampleRate };
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("processWave result.wav must be a Buffer, ArrayBuffer, or typed array");
}

let processWave;
before(async () => {
  assert.ok(existsSync(processorPath), `processor is not present: ${processorPath}`);
  runPython([path.join(__dirname, "parity_fixture.py"), generated]);
  const module = await import(pathToFileURL(processorPath).href);
  processWave = module.processWave;
  assert.equal(typeof processWave, "function", "processor.js must export processWave");
  assert.equal(module.nearestEven(2.5), 2, "nearest-even rounds an even tie down");
  assert.equal(module.nearestEven(3.5), 4, "nearest-even rounds an odd tie up");
});

for (const shift of [6, -5, 12037, -30000]) {
  test(`single-input output matches Python oracle for common shift ${shift}`, async () => {
    const stem = `shift_${shift >= 0 ? "+" : ""}${shift}`;
    const input = readFileSync(path.join(generated, `${stem}_input.wav`));
    const expected = readFloatWav(readFileSync(path.join(generated, `${stem}_expected.wav`)));
    const convExpected = readFloatWav(readFileSync(path.join(generated, `${stem}_convolution_expected.wav`)));
    const oracle = JSON.parse(readFileSync(path.join(generated, `${stem}_oracle.json`), "utf8"));
    const inputArrayBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    const result = await processWave(inputArrayBuffer, { pre_samples: 0, tail_samples: 24000 });
    assert.ok(result && result.wav, "processWave returns {wav, report}");
    assert.ok(result.report && typeof result.report === "object", "processWave returns evidence report");
    assert.equal(result.report.alignment.selected_shift_samples, shift);
    assert.deepEqual(result.report.alignment.residual_samples, oracle.oracle.peak_residuals);
    assert.equal(result.report.alignment.reference_waveform_correlation_performed, false);
    assert.equal(result.report.events.length, 8, "LFE is detected even though output excludes it");
    const actual = readFloatWav(asBuffer(result.wav));
    assert.equal(actual.frames, expected.frames);
    assert.equal(actual.channels, expected.channels);
    assert.equal(actual.sampleRate, expected.sampleRate);
    assert.equal(actual.samples.length, expected.samples.length);
    assert.equal(convExpected.samples.length, expected.samples.length);

    // Both implementations normalize the same binary32 source with the same scalar.
    let maxError = 0;
    for (let i = 0; i < actual.samples.length; i++) {
      maxError = Math.max(maxError, Math.abs(actual.samples[i] - expected.samples[i]));
    }
    assert.equal(maxError, 0, `all serialized samples match exactly; max error ${maxError}`);
    for (let i = 0; i < actual.samples.length; i++) {
      assert.equal(expected.samples[i], convExpected.samples[i],
        `Python oracle differs from independent FIR convolution at sample ${i}`);
    }

    let peak = 0;
    for (const sample of actual.samples) peak = Math.max(peak, Math.abs(sample));
    assert.ok(Math.abs(peak - Math.pow(10, -2 / 20)) <= 2e-6,
      `global peak ${peak} should be -2 dBFS`);
    // Every output channel receives one of the seven independent directions.
    for (let channel = 0; channel < 14; channel++) {
      let channelPeak = 0;
      for (let frame = 0; frame < actual.frames; frame++) {
        channelPeak = Math.max(channelPeak, Math.abs(actual.samples[frame * 14 + channel]));
      }
      assert.ok(channelPeak > 0, `output channel ${channel} should contain its routed direction`);
    }
  });
}

test("pre_samples and tail_samples preserve the independently convolved response", async () => {
  const input = readFileSync(path.join(generated, "shift_+6_input.wav"));
  const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const raw = readFloatWavForInput(input);
  const result = await processWave(buffer, { pre_samples: 128, tail_samples: 30000 });
  const actual = readFloatWav(asBuffer(result.wav));
  assert.equal(actual.frames, 30128);
  assert.equal(result.report.extraction.time_zero_output_sample, 128);
  assert.equal(result.report.extraction.window_qa.length, 7);

  let maxError = 0;
  for (let direction = 0; direction < 7; direction++) {
    const event = result.report.events[direction];
    const [left, right] = result.report.routing[event.label];
    const start = event.sample + result.report.alignment.selected_shift_samples - 128;
    for (let i = 0; i < actual.frames; i++) {
      const sourceFrame = start + i;
      for (const channel of [left, right]) {
        const inputChannel = channel === left ? 0 : 1;
        const expected = sourceFrame >= 0 && sourceFrame < raw.frames
          ? Math.fround(raw.samples[sourceFrame * 2 + inputChannel] * result.report.extraction.gain_scalar) : 0;
        maxError = Math.max(maxError, Math.abs(actual.samples[i * 14 + channel] - expected));
      }
    }
  }
  assert.equal(maxError, 0, `padded output differs from source-window convolution by ${maxError}`);

  await assert.rejects(processWave(buffer, { pre_samples: 0, tail_samples: 500 }), /response tail exceeds/);

});

function readFloatWavForInput(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (id === "data") {
      const view = new DataView(bytes.buffer, bytes.byteOffset + start, size);
      const samples = new Float32Array(size / 4);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getFloat32(i * 4, true);
      return { samples, frames: samples.length / 2 };
    }
    offset = start + size + (size & 1);
  }
  throw new Error("Missing input WAV data");
}
