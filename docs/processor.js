// Single-input common_peak equivalent of the supplied Python reference.
export const PROCESSOR_VERSION = '3.0.0';
export const MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
export const ROUTING = Object.freeze({FL:[0,1],SL:[2,3],BL:[4,5],FC:[6,13],FR:[8,7],SR:[10,9],BR:[12,11]});
const LABELS = ['FL','SL','BL','FC','FR','SR','BR','LFE'];
const SOURCE_CHANNELS = [0,6,4,2,1,7,5,3];
const CFG = Object.freeze({onset_db:-80,onset_floor:1e-8,activity_db:-100,activity_floor:1e-7,noise_multiplier:20,quiet_gap_seconds:0.15,max_schedule_residual_samples:2048,early_feature_db:-20,early_feature_guard_samples:48});
const PRESET_HASH = 'd30ecfd2b0db675423224b124f0f526f077338da7cf4b76528675094200c3134';
function requireValue(ok, message) { if (!ok) throw new Error(message); }
export function nearestEven(value) {
  const lo = Math.floor(value), part = value-lo;
  return part < .5 ? lo : part > .5 ? lo+1 : lo % 2 === 0 ? lo : lo+1;
}
function select(a,k) {
  let lo=0,hi=a.length-1;
  while(lo<hi) {
    const pivot=a[(lo+hi)>>>1]; let i=lo,j=hi;
    while(i<=j) {
      while(a[i]<pivot) i++; while(a[j]>pivot) j--;
      if(i<=j) {const v=a[i];a[i++]=a[j];a[j--]=v;}
    }
    if(k<=j) hi=j; else if(k>=i) lo=i; else return a[k];
  }
  return a[k];
}
function median(a) {
  const copy = a.slice(), n=copy.length, k=n>>>1;
  const upper=select(copy,k);
  return n%2 ? upper : (upper+select(copy,k-1))/2;
}
function fourCC(v,o) { return String.fromCharCode(v.getUint8(o),v.getUint8(o+1),v.getUint8(o+2),v.getUint8(o+3)); }
export function parseWave(buffer, expectedChannels=2) {
  requireValue(buffer instanceof ArrayBuffer, 'Input must be a WAV ArrayBuffer.');
  requireValue(buffer.byteLength<=MEMORY_LIMIT_BYTES,'WAV exceeds the 128 MiB memory limit.');
  requireValue(buffer.byteLength>=12,'Truncated WAV header.');
  const v=new DataView(buffer);
  requireValue(fourCC(v,0)==='RIFF'&&fourCC(v,8)==='WAVE','Only little-endian RIFF WAVE files are supported.');
  requireValue(v.getUint32(4,true)+8===buffer.byteLength,'WAV RIFF length does not match the file; it may be truncated.');
  let fmt=null,data=null;
  for(let p=12;p<buffer.byteLength;) {
    requireValue(p+8<=buffer.byteLength,'Truncated WAV chunk header.');
    const tag=fourCC(v,p),size=v.getUint32(p+4,true),start=p+8,end=start+size;
    requireValue(end+(size&1)<=buffer.byteLength,'Truncated WAV chunk or missing padding.');
    if(tag==='fmt ') {
      requireValue(!fmt,'Multiple WAV format chunks are unsupported.');
      requireValue(size>=16,'Truncated WAV format chunk.');
      let format=v.getUint16(start,true);
      const channels=v.getUint16(start+2,true),sample_rate=v.getUint32(start+4,true),byte_rate=v.getUint32(start+8,true),block_align=v.getUint16(start+12,true),bits=v.getUint16(start+14,true);
      let valid_bits=bits,channel_mask=null;
      if(size>16) {
        requireValue(size>=18,'Invalid WAV format extension.');
        const extension=v.getUint16(start+16,true);
        requireValue(18+extension<=size,'Truncated WAV format extension.');
      }
      if(format===65534) {
        requireValue(size>=40&&v.getUint16(start+16,true)>=22,'Truncated WAVE extensible format.');
        valid_bits=v.getUint16(start+18,true);channel_mask=v.getUint32(start+20,true);
        const guid=[0,0,16,0,128,0,0,170,0,56,155,113];
        requireValue(guid.every((b,i)=>v.getUint8(start+28+i)===b),'Unsupported WAV extensible subformat.');
        format=v.getUint32(start+24,true);
      }
      requireValue(format===1||format===3,'Unsupported WAV encoding; use integer PCM or IEEE float.');
      requireValue(format===1?[8,16,24,32].includes(bits):[32,64].includes(bits),'Unsupported WAV sample width.');
      requireValue(valid_bits>0&&valid_bits<=bits&&(format===1||valid_bits===bits),'Invalid WAV valid-bit count.');
      requireValue((Array.isArray(expectedChannels)?expectedChannels:[expectedChannels]).includes(channels),`Expected ${Array.isArray(expectedChannels)?expectedChannels.join(' or '):expectedChannels} channels; received ${channels}.`);
      requireValue(sample_rate===48000,'Input must be native 48,000 Hz; resampling is not performed.');
      requireValue(block_align===channels*(bits/8)&&byte_rate===sample_rate*block_align,'Invalid WAV block alignment or byte rate.');
      requireValue(channel_mask===null||channel_mask===0||(channels===2&&channel_mask===3),'WAV channel mask conflicts with the required channel order.');
      fmt={format,channels,sample_rate,bits,valid_bits,channel_mask,block_align};
    } else if(tag==='data') {
      requireValue(!data,'Multiple WAV data chunks are unsupported.');data={start,size};
    }
    p=end+(size&1);
  }
  requireValue(fmt&&data,'WAV must contain format and data chunks.');
  requireValue(data.size>0&&data.size%fmt.block_align===0,'Empty or incomplete WAV sample frames.');
  return {...fmt,frames:data.size/fmt.block_align,data_offset:data.start,data_bytes:data.size};
}
async function hash(buffer) {
  requireValue(globalThis.crypto?.subtle,'Local hashing requires a secure browser context (HTTPS or localhost).');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',buffer);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function decode(buffer,info) {
  const v=new DataView(buffer),x=new Float64Array(info.frames*info.channels),a=new Float64Array(info.frames);
  const bytes=info.bits/8,denom=2**(info.bits-1),clipPositive=1-2**(1-info.valid_bits);
  for(let i=0,p=info.data_offset;i<x.length;i++,p+=bytes) {
    let value;
    if(info.format===3) value=info.bits===32?v.getFloat32(p,true):v.getFloat64(p,true);
    else if(info.bits===8) value=(v.getUint8(p)-128)/128;
    else if(info.bits===16) value=v.getInt16(p,true)/denom;
    else if(info.bits===32) value=v.getInt32(p,true)/denom;
    else {let n=v.getUint8(p)|v.getUint8(p+1)<<8|v.getUint8(p+2)<<16;if(n&0x800000)n-=0x1000000;value=n/denom;}
    requireValue(Number.isFinite(value),`Nonfinite input sample at frame ${Math.floor(i/info.channels)}.`);
    requireValue(info.format===3?Math.abs(value)<1:value>-1&&value<clipPositive,`Clipped input sample at frame ${Math.floor(i/info.channels)}; record again at a lower level.`);
    if(info.format===1&&info.valid_bits<info.bits) {
      const quantized=value*denom;
      requireValue(quantized%2**(info.bits-info.valid_bits)===0,'WAV samples violate the declared valid-bit alignment.');
    }
    x[i]=value;const frame=Math.floor(i/info.channels);a[frame]=Math.max(a[frame],Math.abs(value));
  }
  return {x,a};
}
function detect(x,a) {
  let peak=0;for(const v of a)peak=Math.max(peak,v);
  requireValue(peak>0,'Silent capture.');
  const noise=median(a),threshold=Math.max(CFG.activity_floor,noise*CFG.noise_multiplier,peak*10**(CFG.activity_db/20));
  const gap=nearestEven(CFG.quiet_gap_seconds*48000),regions=[];
  let first=-1,last=-1;
  for(let i=0;i<a.length;i++)if(a[i]>threshold) {
    if(first<0)first=i;else if(i-last>gap){regions.push([first,last+1]);first=i;}
    last=i;
  }
  if(first>=0)regions.push([first,last+1]);
  requireValue(regions.length>0,'No events above noise.');
  requireValue(regions.length===8,`Expected 8 events including LFE, detected ${regions.length}. Use the supplied schedule and a cleaner capture.`);
  const details=regions.map(([lo,hi],j)=>{
    const left=j===0?0:Math.floor((regions[j-1][1]+lo)/2),right=j+1===regions.length?a.length:Math.floor((hi+regions[j+1][0])/2);
    let p=-1,pk=left,ears=[left,left],earValues=[-1,-1];
    for(let i=left;i<right;i++) {
      if(a[i]>p){p=a[i];pk=i;}
      for(let c=0;c<2;c++){const v=Math.abs(x[i*2+c]);if(v>earValues[c]){earValues[c]=v;ears[c]=i;}}
    }
    function onset(db) {
      const thr=Math.max(CFG.onset_floor,noise*CFG.noise_multiplier,p*10**(db/20));
      for(let i=left;i<right;i++)if(a[i]>thr)return i;
      throw new Error('Onset below noise.');
    }
    const substantial=Math.max(noise*CFG.noise_multiplier,p*10**(CFG.early_feature_db/20));
    let firstSubstantial=pk;for(let i=left;i<=pk;i++)if(a[i]>substantial){firstSubstantial=i;break;}
    const onset_thresholds={};for(const db of [-60,-80,-100,-120])onset_thresholds[String(db)]=onset(db);
    return {label:LABELS[j],source_channel:SOURCE_CHANNELS[j],sample:48000*(j+1),amplitude:32767/32768,region_start:lo,region_end_exclusive:hi,onset:onset(CFG.onset_db),peak:pk,peak_abs:p,onset_thresholds,ear_peak_samples:ears,noise_floor:noise,first_substantial_feature:firstSubstantial,substantial_feature_lead_samples:pk-firstSubstantial,search_start:left,search_end:right,source_to_onset_samples:onset(CFG.onset_db)-48000*(j+1),source_to_peak_samples:pk-48000*(j+1)};
  });
  const offsets=details.map(d=>d.source_to_onset_samples);
  requireValue(Math.max(...offsets)-Math.min(...offsets)<=CFG.max_schedule_residual_samples,'Event schedule mismatch: inspect event assignment and recording timing.');
  return {details,diagnostics:{activity_threshold:threshold,median_abs_pair_noise:noise,event_count:details.length}};
}
function energy(x,lo,hi) {let sum=0;for(let i=lo*2;i<hi*2;i++)sum+=x[i]*x[i];return sum;}
function waveHeader(frames) {
  const bytes=frames*14*4,buffer=new ArrayBuffer(44+bytes),v=new DataView(buffer);
  function tag(offset,s){for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));}
  tag(0,'RIFF');v.setUint32(4,36+bytes,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,14,true);v.setUint32(24,48000,true);v.setUint32(28,48000*56,true);v.setUint16(32,56,true);v.setUint16(34,32,true);tag(36,'data');v.setUint32(40,bytes,true);
  return buffer;
}
function writeWave(x,events,shift,pre,tail,gain) {
  const frames=pre+tail,buffer=waveHeader(frames),v=new DataView(buffer);
  let outputPeak=0;
  for(const e of events) {
    if(e.label==='LFE')continue;
    const start=e.sample+shift-pre,channels=ROUTING[e.label];
    for(let i=0;i<frames;i++)for(let ear=0;ear<2;ear++) {
      const value=Math.fround(x[(start+i)*2+ear]*gain);outputPeak=Math.max(outputPeak,Math.abs(value));
      v.setFloat32(44+(i*14+channels[ear])*4,value,true);
    }
  }
  return {buffer,outputPeak};
}
function hrirPeaks(x,frames) {
  return Object.entries(ROUTING).map(([label,channels])=>{
    let peak=0,index=0;const earValues=[0,0],ears=[0,0];
    for(let n=0;n<frames;n++)for(let ear=0;ear<2;ear++) {
      const value=Math.abs(x[n*14+channels[ear]]);
      if(value>peak){peak=value;index=n;}
      if(value>earValues[ear]){earValues[ear]=value;ears[ear]=n;}
    }
    requireValue(earValues.every(v=>v>0),`${label}: each ear must contain a nonzero response.`);
    let first=index;for(let n=0;n<=index;n++)if(channels.some(ch=>Math.abs(x[n*14+ch])>peak*.1)){first=n;break;}
    requireValue(index-first<=48,`${label}: ambiguous peak anchor; substantial earlier response precedes the peak by ${index-first} samples.`);
    return {label,pair_peak_sample:index,ear_peak_samples:ears};
  });
}
export async function measureReference(buffer,retainedBytes=0) {
  const info=parseWave(buffer,[2,14]);
  requireValue(retainedBytes+buffer.byteLength*2+info.frames*(info.channels*8+16)<=MEMORY_LIMIT_BYTES,'Reference exceeds the working memory limit.');
  const {x,a}=decode(buffer,info);
  let rows;
  if(info.channels===14)rows=hrirPeaks(x,info.frames);
  else {
    rows=detect(x,a).details.slice(0,7);
    for(const row of rows)requireValue(row.substantial_feature_lead_samples<=48,`${row.label}: ambiguous reference peak anchor.`);
    rows=rows.map(row=>({...row,pair_peak_sample:row.peak-row.sample}));
  }
  const peaks=rows.map(row=>row.pair_peak_sample);
  return {median_peak_samples:median(Float64Array.from(peaks)),peak_samples:peaks,events:rows,input:{...info,sha256:await hash(buffer)}};
}
export async function processEditedWave(buffer,referenceBuffer,progress=()=>{}) {
  requireValue(referenceBuffer instanceof ArrayBuffer,'Choose a measured reference WAV for edited HRIR alignment.');
  progress('Analyzing reference peaks');const reference=await measureReference(referenceBuffer,buffer.byteLength);
  requireValue(reference.input.channels===14,'Edited HRIR alignment requires a 14-channel HeSuVi reference WAV.');
  progress('Reading edited HRIR');const info=parseWave(buffer,14);
  requireValue(referenceBuffer.byteLength+buffer.byteLength+info.frames*240<=MEMORY_LIMIT_BYTES,'HRIR and working buffers exceed the 128 MiB memory limit.');
  const {x}=decode(buffer,info),events=hrirPeaks(x,info.frames);
  const anchor=median(Float64Array.from(events.map(row=>row.pair_peak_sample))),shift=anchor-reference.median_peak_samples;
  for(let n=0;n<Math.min(Math.max(shift,0),info.frames);n++)for(let ch=0;ch<14;ch++)requireValue(x[n*14+ch]===0,'Alignment would remove nonzero leading samples; use a reference with a later peak.');
  const frames=Math.max(info.frames,info.frames-shift);
  requireValue(referenceBuffer.byteLength+buffer.byteLength+info.frames*112+frames*112<=MEMORY_LIMIT_BYTES,'Aligned HRIR exceeds the working memory limit.');
  let peak=0;for(const sample of x)peak=Math.max(peak,Math.abs(sample));const gain=10**(-2/20)/peak;
  const wav=waveHeader(frames),view=new DataView(wav);
  let outputPeak=0;
  progress('Aligning 14-channel HRIR');
  for(let n=Math.max(shift,0);n<info.frames;n++)for(let ch=0;ch<14;ch++) {
    const value=Math.fround(x[n*14+ch]*gain);outputPeak=Math.max(outputPeak,Math.abs(value));view.setFloat32(44+((n-shift)*14+ch)*4,value,true);
  }
  const report={status:'passed',workflow:'edited_hrir',implementation_version:PROCESSOR_VERSION,input:{...info,sha256:await hash(buffer)},routing:ROUTING,events,reference_events:reference.events,
    alignment:{convention:'common_peak',method:'common_median_pair_peak',selected_shift_samples:shift,selected_shift_seconds:shift/48000,capture_median_peak_samples:anchor,reference_median_peak_samples:reference.median_peak_samples,reference_peak_offsets_samples:reference.peak_samples,output_peak_samples:events.map(row=>row.pair_peak_sample-shift),reference_source:'measured_wav',reference_input:reference.input,physical_latency_identifiable:false},
    extraction:{pre_samples:0,output_frames:frames,output_channels:14,sample_rate:48000,gain_scalar:gain,pre_gain_peak:peak,target_peak_dbfs:-2,output_peak_dbfs:20*Math.log10(outputPeak),window_qa:[],sha256:await hash(wav)}};
  progress('Complete');return {wav,prefix:null,report};
}
export async function processWave(arrayBuffer,options={},progress=()=>{},referenceBuffer=null) {
  requireValue(options&&typeof options==='object'&&!Array.isArray(options),'Invalid extraction settings.');
  requireValue(Object.keys(options).every(k=>k==='pre_samples'||k==='tail_samples'),'Unsupported setting; only pre_samples and tail_samples are accepted.');
  const pre=options.pre_samples===undefined?0:options.pre_samples,tail=options.tail_samples===undefined?24000:options.tail_samples;
  requireValue(Number.isSafeInteger(pre)&&pre>=0&&Number.isSafeInteger(tail)&&tail>0&&pre+tail<=48000,'Extraction requires integer pre_samples >= 0, tail_samples > 0, and a total of at most 48,000 samples.');
  progress('Reading WAV');const info=parseWave(arrayBuffer),prefixSamples=pre===0?1024:0,outputBytes=44+(pre+tail)*56+(prefixSamples?44+prefixSamples*56:0);
  // Includes decoded stereo, envelope, median copy and transient hashing copies.
  requireValue((referenceBuffer?.byteLength??0)+Math.max(arrayBuffer.byteLength*2,arrayBuffer.byteLength+info.frames*32+outputBytes*2)<=MEMORY_LIMIT_BYTES,'Capture and working buffers exceed the 128 MiB memory limit. Use a shorter recording.');
  progress('Analyzing reference peaks');const reference=referenceBuffer?await measureReference(referenceBuffer,arrayBuffer.byteLength):null,referenceAnchor=reference?reference.median_peak_samples:53;
  progress('Hashing input');const inputHash=await hash(arrayBuffer);
  progress('Decoding samples');const {x,a}=decode(arrayBuffer,info);
  progress('Detecting events');const {details:events,diagnostics}=detect(x,a),directions=events.slice(0,7);
  for(const e of directions)requireValue(e.substantial_feature_lead_samples<=48,`${e.label}: ambiguous peak anchor; a substantial earlier feature precedes the peak by ${e.substantial_feature_lead_samples} samples.`);
  const offsets=directions.map(e=>e.peak-e.sample-referenceAnchor),shift=nearestEven(median(Float64Array.from(offsets))),residual=directions.map((e,i)=>e.peak-e.sample-(reference?.peak_samples[i]??53)-shift);
  progress('Checking extraction');let peak=0;const ranges=[],windowQA=[];
  for(const e of directions) {
    const start=e.sample+shift-pre,end=e.sample+shift+tail;
    requireValue(start>=0&&end<=info.frames,`${e.label}: extraction exceeds capture bounds.`);
    requireValue(start<=e.onset||prefixSamples>0,`${e.label}: extraction starts after the onset; increase Pre-roll in Advanced settings.`);
    requireValue(start<=e.peak&&e.peak<end,`${e.label}: extraction omits the detected response peak; increase Pre-roll or Response length in Advanced settings.`);
    requireValue(!prefixSamples||start>=prefixSamples,`${e.label}: prefix archive exceeds capture bounds.`);
    requireValue(e.onset<end,`${e.label}: extraction ends before the onset; increase Response length in Advanced settings.`);
    for(let i=e.search_start;i<Math.max(e.search_start,start-prefixSamples);i++)requireValue(x[i*2]===0&&x[i*2+1]===0,prefixSamples?`${e.label}: nonzero pre-response exceeds the 1024-sample prefix archive; increase Pre-roll in Advanced settings.`:`${e.label}: nonzero response before extraction; increase Pre-roll in Advanced settings.`);
    const tailLimit=Math.max(CFG.activity_floor,e.noise_floor*CFG.noise_multiplier,e.peak_abs*10**(CFG.activity_db/20));
    for(let i=Math.max(end,e.search_start);i<e.search_end;i++)requireValue(a[i]<=tailLimit,`${e.label}: response tail exceeds the extraction window; increase Response length in Advanced settings.`);
    for(let i=start;i<end;i++)peak=Math.max(peak,a[i]);
    const total=energy(x,e.search_start,e.search_end),lostPre=energy(x,e.search_start,Math.max(e.search_start,start)),lostTail=energy(x,Math.min(end,e.search_end),e.search_end);
    ranges.push({label:e.label,source_start_inclusive:start,source_end_exclusive:end,output_channels:ROUTING[e.label]});
    windowQA.push({label:e.label,output_onset:e.onset-start,output_pair_peak:e.peak-start,pre_window_energy:lostPre,post_window_energy:lostTail,total_search_energy:total,pre_window_energy_fraction:lostPre/total,post_window_energy_fraction:lostTail/total,ear_peak_difference_samples:e.ear_peak_samples[1]-e.ear_peak_samples[0]});
  }
  requireValue(peak>0,'Silent extraction.');const gain=10**(-2/20)/peak;
  progress('Writing 14-channel WAV');const {buffer:wav,outputPeak}=writeWave(x,events,shift,pre,tail,gain);
  const prefix=prefixSamples?writeWave(x,events,shift-prefixSamples,0,prefixSamples,gain).buffer:null;
  progress('Hashing output');const outputHash=await hash(wav),prefixHash=prefix?await hash(prefix):null;
  const report={status:'passed',implementation_version:PROCESSOR_VERSION,preset_id:'verified_supplied_7_1_common_peak_v2',reference_script_sha256:'ba74203aa650019cd70958b602bd0c1b6c1cd605a0896a59dece1d3d19d3e133',preset_sha256:PRESET_HASH,canonical_hesuvi_origin_verified:false,input:{sha256:inputHash,...info},detector_settings:{...CFG},detection:diagnostics,events,routing:ROUTING,alignment:{convention:'common_peak',method:'common_median_pair_peak',reference_median_peak_samples:referenceAnchor,capture_median_peak_samples:shift+referenceAnchor,reference_peak_offsets_samples:reference?.peak_samples??null,reference_source:reference?'measured_wav':'saved_calibration',reference_input:reference?.input??null,output_peak_samples:directions.map(e=>e.peak-e.sample-shift),reference_residuals_are_acceptance_criteria:false,physical_latency_identifiable:false,expected_pair_peak_sample:referenceAnchor,selected_shift_samples:shift,selected_shift_seconds:shift/48000,peak_offsets_samples:offsets,residual_samples:residual,reference_waveform_correlation_performed:false},extraction:{pre_samples:pre,tail_samples:tail,shift_samples:shift,sample_rate:48000,output_frames:pre+tail,output_channels:14,time_zero_output_sample:pre,gain_scalar:gain,pre_gain_peak:peak,target_peak_dbfs:-2,output_peak:outputPeak,output_peak_dbfs:20*Math.log10(outputPeak),dtype:'float32',ranges,window_qa:windowQA,negative_time_prefix:prefix?{frames:prefixSamples,relative_sample_range:[-prefixSamples,-1],same_gain_as_main:true,sha256:prefixHash}:null,sha256:outputHash},discarded_lfe_energy:energy(x,events[7].search_start,events[7].search_end),limitations:[reference?'Reference peak positions are measured from the supplied WAV.':'Uses the saved 53-sample calibration; no reference audio was analyzed.','Chronological event identity is assumed; identical impulses cannot independently prove renderer routing.','Capture-start delay and renderer latency cannot be separated. Peak calibration does not identify physical direct-path arrival.','Common-peak mode measures peak positions; waveform cross-correlation is not an acceptance criterion in the offline reference.','A 1024-sample negative-time prefix is archived at zero pre-roll using the main gain. Larger nonzero prefixes and above-threshold tail truncation are rejected. Original recordings remain unchanged.','No resampling, drift correction, EQ, amplitude taper, phase change, independent ear alignment or per-channel normalization.']};
  progress('Complete');return {wav,prefix,report};
}
