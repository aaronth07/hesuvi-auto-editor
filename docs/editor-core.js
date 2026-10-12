/* Local header inspection only. Audio samples are not decoded or uploaded. */
(function (root) {
  'use strict';
  async function inspectWave(file) {
    if (!file || file.size < 12) throw new Error('Choose a RIFF WAV file.');
    const read = async (start, length) => new DataView(await file.slice(start, start + length).arrayBuffer());
    const tag = (v, offset) => String.fromCharCode(...new Uint8Array(v.buffer, offset, 4));
    const head = await read(0, 12);
    if (tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') throw new Error('Only RIFF WAV is supported.');
    const end = head.getUint32(4, true) + 8;
    if (end > file.size || end < 12) throw new Error('WAV header declares a truncated or invalid file.');
    let position = 12, format, dataBytes;
    for (let count = 0; position + 8 <= end && count < 256; count++) {
      const chunk = await read(position, 8), id = tag(chunk, 0), length = chunk.getUint32(4, true);
      if (position + 8 + length > end) throw new Error('Truncated WAV chunk.');
      if (id === 'fmt ') {
        if (length < 16) throw new Error('Invalid WAV format chunk.');
        const f = await read(position + 8, Math.min(length, 40));
        const encoding = f.getUint16(0, true), channels = f.getUint16(2, true), sampleRate = f.getUint32(4, true), blockAlign = f.getUint16(12, true), bits = f.getUint16(14, true);
        if (![1, 3, 65534].includes(encoding) || !channels || !sampleRate || !blockAlign || !bits) throw new Error('Unsupported or invalid WAV encoding.');
        let mask = null;
        if (encoding === 65534) {
          if (length < 40 || f.getUint16(16, true) < 22) throw new Error('Incomplete extensible WAV format.');
          mask = f.getUint32(20, true);
          const guid = Array.from(new Uint8Array(f.buffer, 24, 16));
          const expectedTail = [0,0,0,0,16,0,128,0,0,170,0,56,155,113];
          if (![1,3].includes(f.getUint16(24,true)) || !guid.slice(2).every((v,i)=>v===expectedTail[i])) throw new Error('Unsupported extensible WAV subtype.');
        }
        format = { channels, sampleRate, bits, blockAlign, mask };
      }
      if (id === 'data') dataBytes = length;
      position += 8 + length + (length % 2);
      if (format && dataBytes !== undefined) break;
    }
    if (!format || dataBytes === undefined) throw new Error('Could not find WAV format and data within the header scan limit.');
    if (dataBytes % format.blockAlign) throw new Error('WAV data does not contain whole frames.');
    return {...format, frames:dataBytes / format.blockAlign, duration:dataBytes / format.blockAlign / format.sampleRate, bytes:file.size};
  }
  function buildConfig(base, names, advanced) {
    const config = {...base};
    for (const key of ['stimulus','apple','capture']) {
      const name = names[key];
      if (typeof name !== 'string' || !name || /[\\/\x00-\x1f]/.test(name)) throw new Error('Use a plain filename for each local WAV.');
      config[key] = 'sources/' + name;
    }
    for (const key of ['pre_samples','tail_samples']) {
      const value = Number(advanced[key]);
      if (!Number.isSafeInteger(value) || value < (key === 'tail_samples' ? 1 : 0) || value > 10000000) throw new Error('Enter whole sample counts within 0–10,000,000 (tail must be positive).');
      config[key] = value;
    }
    if (!['apple_peak','apple_onset'].includes(advanced.alignment)) throw new Error('Choose a supported alignment mode.');
    config.alignment = advanced.alignment;
    config.output_dir = 'output';
    return config;
  }
  const api = {inspectWave, buildConfig};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HesuviCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
