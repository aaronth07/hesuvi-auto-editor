const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),folder=path.join(__dirname,'.generated/reference');
const python=process.env.PYTHON&&fs.existsSync(process.env.PYTHON)&&fs.statSync(process.env.PYTHON).isFile()?process.env.PYTHON:[path.join(root,'.venv/Scripts/python.exe'),path.join(root,'.venv/bin/python')].find(p=>fs.existsSync(p))||'python3';
const bytes=name=>{const b=fs.readFileSync(path.join(folder,name));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
function samples(buffer){const b=Buffer.from(buffer);let p=12;while(p<b.length){const size=b.readUInt32LE(p+4);if(b.toString('ascii',p,p+4)==='data'){return b.subarray(p+8,p+8+size);}p+=8+size+(size&1);}throw Error('No data');}
let dsp;
before(async()=>{const r=spawnSync(python,['tests/reference_alignment_fixture.py'],{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);dsp=await import(pathToFileURL(path.join(root,'docs/processor.js')).href);});
test('edited HRIR: every float32 sample matches Python across advance, delay, and zero shift',async()=>{
 for(const delay of [0,84,300]){
  const result=await dsp.processEditedWave(bytes(`edited${delay}.wav`),bytes('reference14.wav'));
  const expected=JSON.parse(fs.readFileSync(path.join(folder,`expected${delay}.json`)));
  assert.deepEqual(samples(result.wav),samples(bytes(`expected${delay}.wav`)));
  assert.equal(result.report.alignment.reference_median_peak_samples,137);
  assert.equal(result.report.alignment.selected_shift_samples,delay-84);
  assert.deepEqual(result.report.alignment.output_peak_samples,expected.alignment.output_peak_samples);
  assert.equal(result.prefix,null);
  fs.writeFileSync(path.join(folder,`browser${delay}.wav`),Buffer.from(result.wav));
 }
});
test('raw capture: measured stereo and 14-channel reference both match complete offline arrays',async()=>{
 for(const ref of ['reference2.wav','reference14.wav']){
  const result=await dsp.processWave(bytes('capture.wav'),{},()=>{},bytes(ref));
  assert.deepEqual(samples(result.wav),samples(bytes('Far_HeSuVi_peak.wav')));
  assert.deepEqual(samples(result.prefix),samples(bytes('Far_negative_time_prefix.wav')));
  assert.equal(result.report.alignment.reference_median_peak_samples,137);
  assert.equal(result.report.alignment.selected_shift_samples,12261);
  assert.equal(result.report.alignment.reference_source,'measured_wav');
  const qa=JSON.parse(fs.readFileSync(path.join(folder,'qa.json')));assert.deepEqual(result.report.alignment.residual_samples,qa.alignment.residual_samples);
 }
});
test('edited HRIR decodes multichannel PCM16 and float64 without changing routing or gain relationships',async()=>{
 for(const bits of [16,64]){
  const result=await dsp.processEditedWave(bytes(`edited${bits}bit.wav`),bytes('reference14.wav'));
  assert.deepEqual(samples(result.wav),samples(bytes(`expected${bits}bit.wav`)));
 }
});
test('edited HRIR rejects missing reference, wrong channels/rate, silence, clipping, nonfinite samples, and leading-sample loss',async()=>{
 const input=bytes('edited300.wav'),ref=bytes('reference14.wav'),info=dsp.parseWave(input,14);
 await assert.rejects(dsp.processEditedWave(input,null),/reference WAV/);
 await assert.rejects(dsp.processEditedWave(bytes('capture.wav'),ref),/14 channels/);
 await assert.rejects(dsp.processEditedWave(input,bytes('reference2.wav')),/14-channel/);
 for(const [value,pattern] of [[1,/Clipped/],[NaN,/Nonfinite/],[1e-9,/remove nonzero/]]){
  const changed=input.slice(0);new DataView(changed).setFloat32(info.data_offset,value,true);
  await assert.rejects(dsp.processEditedWave(changed,ref),pattern);
 }
 const silent=input.slice(0);new Uint8Array(silent,info.data_offset).fill(0);
 await assert.rejects(dsp.processEditedWave(silent,ref),/nonzero response/);
 const rate=input.slice(0);new DataView(rate).setUint32(24,44100,true);
 await assert.rejects(dsp.processEditedWave(rate,ref),/48,000/);
});
