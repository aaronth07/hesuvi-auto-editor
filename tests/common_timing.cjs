"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {before,after,test}=require('node:test');
const root=path.resolve(__dirname,'..'),generated=path.join(__dirname,'.generated/common');
const python=process.env.PYTHON&&fs.existsSync(process.env.PYTHON)&&fs.statSync(process.env.PYTHON).isFile()?process.env.PYTHON:path.join(root,'.venv/Scripts/python.exe');
function runPython(args){const result=spawnSync(python,args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.error?.message);}
function wave(bytes){let p=12,channels,rate;while(p+8<=bytes.length){const tag=bytes.toString('ascii',p,p+4),size=bytes.readUInt32LE(p+4),offset=p+8;if(tag==='fmt '){channels=bytes.readUInt16LE(offset+2);rate=bytes.readUInt32LE(offset+4);}if(tag==='data'){const values=new Float32Array(size/4);for(let i=0;i<values.length;i++)values[i]=bytes.readFloatLE(offset+i*4);return {values,channels,rate,frames:values.length/channels};}p=offset+size+(size&1);}throw new Error('No WAV data');}
function exact(actual,expected,label){assert.equal(actual.values.length,expected.values.length,label);let maximum=0;for(let i=0;i<actual.values.length;i++)maximum=Math.max(maximum,Math.abs(actual.values[i]-expected.values[i]));assert.equal(maximum,0,label);}
let processWave;
before(async()=>{runPython(['tests/common_timing_fixture.py']);({processWave}=await import(pathToFileURL(path.join(root,'docs/processor.js')).href));});
test('common timing preserves every main/prefix sample and per-direction ear timing against the fixed Python CLI',async()=>{
 const cases=JSON.parse(fs.readFileSync(path.join(generated,'cases.json'),'utf8'));
 for(const fixture of cases){
  const folder=path.join(generated,fixture.name),input=fs.readFileSync(path.join(folder,'input.wav'));
  const result=await processWave(input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength));
  const expected=wave(fs.readFileSync(path.join(folder,'Far_HeSuVi_peak.wav'))),prefix=wave(fs.readFileSync(path.join(folder,'Far_negative_time_prefix.wav')));
  const actual=wave(Buffer.from(result.wav)),actualPrefix=wave(Buffer.from(result.prefix));
  exact(actual,expected,fixture.name+' all main samples');exact(actualPrefix,prefix,fixture.name+' all prefix samples');
  assert.equal(actual.channels,14);assert.equal(actual.rate,48000);assert.equal(actualPrefix.frames,1024);
  const qa=JSON.parse(fs.readFileSync(path.join(folder,'qa.json'),'utf8'));
  assert.equal(result.report.alignment.selected_shift_samples,qa.alignment.selected_shift_samples);
  assert.deepEqual(result.report.alignment.output_peak_samples,qa.alignment.output_peak_samples);
  assert.equal(result.report.alignment.reference_residuals_are_acceptance_criteria,false);
  assert.equal(result.report.extraction.negative_time_prefix.same_gain_as_main,true);
  for(const row of qa.captures.Far.extraction.window_qa){
    const pair=result.report.routing[row.label],peaks=pair.map(channel=>{let peak=-1,index=0;for(let i=0;i<actual.frames;i++){const value=Math.abs(actual.values[i*14+channel]);if(value>peak){peak=value;index=i;}}return index;});
    assert.equal(peaks[1]-peaks[0],row.ear_peak_difference_samples);
  }
  fs.writeFileSync(path.join(folder,'browser.wav'),Buffer.from(result.wav));
  fs.writeFileSync(path.join(folder,'browser_prefix.wav'),Buffer.from(result.prefix));
 }
});
after(()=>runPython(['tests/common_timing_fixture.py','validate']));
