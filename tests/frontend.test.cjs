'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectWave,buildConfig}=require('../docs/editor-core.js');
const defaults=require('../config.json');
function wave({channels=2,rate=48000,extensible=false}={}) {
 const fmt=extensible?40:16,data=channels*2*48,b=Buffer.alloc(12+8+fmt+8+data);
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(fmt,16);b.writeUInt16LE(extensible?65534:1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);
 if(extensible){b.writeUInt16LE(22,36);b.writeUInt16LE(16,38);b.writeUInt32LE(0x63f,40);Buffer.from([1,0,0,0,0,0,16,0,128,0,0,170,0,56,155,113]).copy(b,44);}
 b.write('data',20+fmt);b.writeUInt32LE(data,24+fmt);return b;
}
test('PCM metadata without decoding audio',async()=>{const m=await inspectWave(new Blob([wave()]));assert.equal(m.channels,2);assert.equal(m.sampleRate,48000);assert.equal(m.frames,48);assert.equal(m.duration,.001);assert.equal(m.mask,null);});
test('7.1 extensible mask',async()=>{const m=await inspectWave(new Blob([wave({channels:8,extensible:true})]));assert.equal(m.mask,0x63f);assert.equal(m.channels,8);});
test('reject non-WAV and short input',async()=>{await assert.rejects(inspectWave(new Blob(['hello'])));const b=wave();b.write('RF64');await assert.rejects(inspectWave(new Blob([b])),/RIFF/);});
test('reject truncated declared file',async()=>{await assert.rejects(inspectWave(new Blob([wave().subarray(0,60)])),/truncated/);});
test('reject malformed chunk length',async()=>{const b=wave();b.writeUInt32LE(0xffffffff,16);await assert.rejects(inspectWave(new Blob([b])),/Truncated/);});
test('reject unsupported extensible subtype',async()=>{const b=wave({extensible:true});b[44]=6;await assert.rejects(inspectWave(new Blob([b])),/subtype/);});
test('config uses local relative filenames, preserves DSP defaults',()=>{const c=buildConfig(defaults,{stimulus:'stim.wav',apple:'ref.wav',capture:'target.wav'},{pre_samples:0,tail_samples:24000,alignment:'apple_peak'});assert.equal(c.stimulus,'sources/stim.wav');assert.equal(c.min_xcorr_coefficient,defaults.min_xcorr_coefficient);assert.equal(c.output_dir,'output');});
test('reject path injection and invalid settings',()=>{const names={stimulus:'stim.wav',apple:'ref.wav',capture:'target.wav'},advanced={pre_samples:0,tail_samples:24000,alignment:'apple_peak'};assert.throws(()=>buildConfig(defaults,{...names,capture:'../secret.wav'},advanced));assert.throws(()=>buildConfig(defaults,names,{...advanced,tail_samples:0}));assert.throws(()=>buildConfig(defaults,names,{...advanced,pre_samples:.5}));assert.throws(()=>buildConfig(defaults,names,{...advanced,alignment:'fake'}));});
