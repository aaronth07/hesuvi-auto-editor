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
  && statSync(process.env.PYTHON).isFile() ? process.env.PYTHON : bundledPython;
const processorPath = path.join(root, "docs", "processor.js");
let parseWave;
let processWave;
let baseSamples;

function runPython() {
  const result = spawnSync(python, [path.join(__dirname, "parity_fixture.py"), generated],
    { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `fixture generation failed: ${result.stderr || result.error?.message}`);
}

function arrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function makeWave(samples, { format = 3, bits = 32, sampleRate = 48000,
  channels = 2, extensible = false, validBits = bits } = {}) {
  const bytesPerSample = bits / 8;
  assert.equal(samples.length % channels, 0);
  const dataLength = samples.length * bytesPerSample;
  const fmtLength = extensible ? 40 : 16;
  const output = Buffer.alloc(12 + 8 + fmtLength + 8 + dataLength + (dataLength & 1));
  output.write("RIFF", 0); output.writeUInt32LE(output.length - 8, 4); output.write("WAVE", 8);
  output.write("fmt ", 12); output.writeUInt32LE(fmtLength, 16);
  output.writeUInt16LE(extensible ? 0xfffe : format, 20);
  output.writeUInt16LE(channels, 22); output.writeUInt32LE(sampleRate, 24);
  const blockAlign = channels * bytesPerSample;
  output.writeUInt32LE(sampleRate * blockAlign, 28); output.writeUInt16LE(blockAlign, 32);
  output.writeUInt16LE(bits, 34);
  if (extensible) {
    output.writeUInt16LE(22, 36); output.writeUInt16LE(validBits, 38);
    output.writeUInt32LE(channels === 2 ? 3 : 0, 40);
    output.writeUInt32LE(format, 44);
    Buffer.from([0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113]).copy(output, 48);
  }
  const dataHeader = 20 + fmtLength;
  output.write("data", dataHeader); output.writeUInt32LE(dataLength, dataHeader + 4);
  const dataStart = dataHeader + 8;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i], at = dataStart + i * bytesPerSample;
    if (format === 3) {
      if (bits === 32) output.writeFloatLE(x, at); else output.writeDoubleLE(x, at);
    } else if (bits === 8) {
      const q = Math.max(-128, Math.min(127, Math.round(x * 128)));
      output.writeUInt8(q + 128, at);
    } else {
      const scale = 2 ** (bits - 1);
      const q = Math.max(-scale, Math.min(scale - 1, Math.round(x * scale)));
      if (bits === 16) output.writeInt16LE(q, at);
      else if (bits === 32) output.writeInt32LE(q, at);
      else {
        const unsigned = q < 0 ? q + 0x1000000 : q;
        output[at] = unsigned & 255; output[at + 1] = (unsigned >>> 8) & 255;
        output[at + 2] = (unsigned >>> 16) & 255;
      }
    }
  }
  return output;
}

function floatSamples() {
  const wav = readFileSync(path.join(generated, "shift_+6_input.wav"));
  let p = 12, dataStart = -1, size = 0;
  while (p + 8 <= wav.length) {
    const chunkSize = wav.readUInt32LE(p + 4), start = p + 8;
    if (wav.toString("ascii", p, p + 4) === "data") {
      dataStart = start; size = chunkSize; break;
    }
    p = start + chunkSize + (chunkSize & 1);
  }
  assert.ok(dataStart >= 0);
  const out = new Float32Array(size / 4);
  for (let i = 0; i < out.length; i++) out[i] = wav.readFloatLE(dataStart + 4 * i);
  return out;
}

async function run(buffer, options = {}) {
  return processWave(arrayBuffer(buffer), options);
}

before(async () => {
  runPython();
  const mod = await import(pathToFileURL(processorPath).href);
  parseWave = mod.parseWave; processWave = mod.processWave;
  baseSamples = floatSamples();
});

test("accepts PCM 8/16/24/32 and float32/64, standard and extensible WAV", async () => {
  for (const [format, bits] of [[1, 8], [1, 16], [1, 24], [1, 32], [3, 32], [3, 64]]) {
    for (const extensible of [false, true]) {
      const wav = makeWave(baseSamples, { format, bits, extensible });
      const parsed = parseWave(arrayBuffer(wav));
      assert.equal(parsed.sample_rate, 48000);
      assert.equal(parsed.channels, 2);
      assert.equal(parsed.frames, 432000);
      const result = await run(wav);
      assert.equal(result.report.status, "passed", `${format}/${bits}/${extensible}`);
      assert.equal(result.report.extraction.output_channels, 14);
    }
  }
});

test("rejects missing and extra events", async () => {
  const missing = baseSamples.slice();
  missing.fill(0, 2 * (96000 + 6), 2 * (96000 + 1100));
  await assert.rejects(run(makeWave(missing)), /Expected 8 events/);

  const extra = baseSamples.slice(); extra[2 * 25000] = .5;
  await assert.rejects(run(makeWave(extra)), /Expected 8 events/);
});

test("rejects wrong sample rate and channel count", async () => {
  await assert.rejects(run(makeWave(baseSamples, { sampleRate: 44100 })), /48,000 Hz/);
  const mono = new Float32Array(baseSamples.length / 2);
  for (let i = 0; i < mono.length; i++) mono[i] = baseSamples[i * 2];
  await assert.rejects(run(makeWave(mono, { channels: 1 })), /2 channels/);
});

test("rejects NaN, clipping, and silence", async () => {
  const nan = baseSamples.slice(); nan[0] = Number.NaN;
  await assert.rejects(run(makeWave(nan)), /Nonfinite input sample/);
  const clipped = baseSamples.slice(); clipped[0] = 1;
  await assert.rejects(run(makeWave(clipped)), /Clipped input sample/);
  await assert.rejects(run(makeWave(new Float32Array(baseSamples.length))), /Silent capture/);
});

test("rejects a nonzero prefix and an ambiguous early feature", async () => {
  const prefix = baseSamples.slice(); prefix[2 * (48000 + 6 - 1100)] = .00001;
  await assert.rejects(run(makeWave(prefix)), /prefix archive/i);

  const ambiguous = baseSamples.slice(); ambiguous[2 * (48000 + 6 + 1)] = .02;
  await assert.rejects(run(makeWave(ambiguous)), /ambiguous peak anchor/);
});

test("rejects out-of-bounds extraction and omitted response peaks", async () => {
  const negativeShift = readFileSync(path.join(generated, "shift_-5_input.wav"));
  await assert.rejects(run(negativeShift, { pre_samples: 47999, tail_samples: 1 }), /exceeds capture bounds/);

  const residual = baseSamples.slice(); residual[2 * (48000 + 6 + 64)] = .5;
  const result = await run(makeWave(residual));
  assert.equal(result.report.alignment.reference_residuals_are_acceptance_criteria, false);
  await assert.rejects(run(makeWave(residual), {tail_samples: 60}), /omits the detected response peak/);
});

test("rejects malformed RIFF/chunk lengths and unsupported extensible GUID", () => {
  const valid = makeWave(baseSamples);
  const riff = Buffer.from(valid); riff.writeUInt32LE(riff.length - 9, 4);
  assert.throws(() => parseWave(arrayBuffer(riff)), /RIFF length/);
  const chunk = Buffer.from(valid); chunk.writeUInt32LE(chunk.length, 40);
  assert.throws(() => parseWave(arrayBuffer(chunk)), /Truncated WAV chunk/);
  const fmt = Buffer.from(valid); fmt.writeUInt32LE(15, 16);
  assert.throws(() => parseWave(arrayBuffer(fmt)), /format chunk/);
  const guid = Buffer.from(makeWave(baseSamples, { extensible: true })); guid[48] ^= 0xff;
  assert.throws(() => parseWave(arrayBuffer(guid)), /extensible subformat/);
});
