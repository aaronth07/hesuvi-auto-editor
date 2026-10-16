'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const form=$('editor'), fileInput=$('recording'), output=$('output');
  let file=null,referenceFile=null,worker=null,run=0,urls=[],audio=null,report=null;
  const routing={FL:[0,1],SL:[2,3],BL:[4,5],FC:[6,13],FR:[8,7],SR:[10,9],BR:[12,11]};
  const labels={FL:'Front left',SL:'Side left',BL:'Back left',FC:'Front center',FR:'Front right',SR:'Side right',BR:'Back right'};
  const available=location.protocol!=='file:'&&!!window.Worker&&!!window.crypto?.subtle;
  if(!available){$('environment-error').hidden=false;$('environment-error').textContent=location.protocol==='file:'?'Open this app with Launch.cmd, or use its HTTPS website. Direct file opening cannot start the processing worker.':'This browser needs Web Workers and a secure context. Use a current browser over HTTPS or localhost.';}
  function busy(value){$('process').disabled=value||!file||!available||($('reference-mode').value==='measured'&&!referenceFile);$('cancel').hidden=!value;form.setAttribute('aria-busy',String(value));}
  function clearResult(){urls.forEach(URL.revokeObjectURL);urls=[];audio=null;report=null;output.hidden=true;for(const id of ['download-wav','download-prefix','download-report'])$(id).removeAttribute('href');$('plots').replaceChildren();$('channel-stats').replaceChildren();$('download-prefix').hidden=true;}
  function stop(){run++;worker?.terminate();worker=null;busy(false);}
  function invalidate(){stop();clearResult();$('status').textContent='';$('error').hidden=true;}
  function error(message){$('error').textContent=message;$('error').hidden=false;$('status').textContent='';}
  function choose(files){invalidate();if(files.length!==1){file=null;fileInput.value='';$('file-name').textContent='Drop a WAV here';busy(false);error('Choose one input WAV.');return;}file=files[0];$('file-name').textContent=`${file.name} · ${(file.size/1048576).toFixed(2)} MiB`;if(file.size>128*1048576){file=null;fileInput.value='';error('The recording exceeds the 128 MiB input limit. Choose a shorter recording.');}busy(false);}
  $('choose').onclick=()=>fileInput.click();
  $('choose-reference').onclick=()=>$('reference-file').click();
  $('reference-file').onchange=()=>{invalidate();referenceFile=$('reference-file').files[0]||null;if(referenceFile?.size>128*1048576){referenceFile=null;$('reference-file').value='';error('Reference exceeds the 128 MiB input limit.');}$('reference-name').textContent=referenceFile?referenceFile.name:'No reference selected';busy(false);};
  function updateMode(){const edited=$('input-type').value==='edited';if(edited)$('reference-mode').value='measured';$('reference-mode').querySelector('[value=saved]').disabled=edited;$('reference-section').hidden=$('reference-mode').value==='saved';$('advanced').hidden=edited;$('recording-heading').textContent=edited?'Edited HRIR':'Recording';$('input-format').textContent=edited?'48 kHz · 14-channel HeSuVi WAV':'48 kHz stereo · WAV';$('process').textContent=edited?'Align HRIR':'Process recording';$('intro').textContent=edited?'Choose an edited 14-channel HeSuVi WAV and its reference HRIR. Align HRIR applies one timing shift and common gain, retaining the response samples.':$('reference-mode').value==='saved'?'Choose an unedited stereo capture of the supplied 7.1 Dirac stimulus. The saved calibration places its median directional pair peak at sample 53.':'Choose an unedited stereo capture and a reference WAV. The reference can be a complete stereo capture of the same stimulus or an edited 14-channel HeSuVi HRIR.';updateOverride();busy(false);}
  for(const id of ['input-type','reference-mode'])$(id).onchange=()=>{invalidate();updateMode();};fileInput.onchange=()=>{if(fileInput.files.length)choose(fileInput.files);};
  const drop=$('drop-zone');drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging');};drop.ondragleave=()=>drop.classList.remove('dragging');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');choose(e.dataTransfer.files);};
  window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
  $('cancel').onclick=()=>{invalidate();$('status').textContent='Processing canceled.';};
  $('reset-editor').onclick=()=>{invalidate();file=null;referenceFile=null;form.reset();$('reference-file').value='';$('reference-name').textContent='No reference selected';fileInput.value='';$('file-name').textContent='Drop a WAV here';$('advanced').open=false;$('analysis').open=false;$('time-range').value='10';$('processing-details').open=false;updateMode();busy(false);};
  function updateOverride(){const enabled=$('override').checked&&$('input-type').value!=='edited';$('extraction-settings').hidden=!enabled;$('pre').disabled=!enabled;$('tail').disabled=!enabled;}
  $('override').onchange=()=>{invalidate();updateOverride();};
  for(const id of ['pre','tail'])$(id).addEventListener('input',invalidate);
  form.onsubmit=async e=>{
    e.preventDefault();if(!file||!available||($('reference-mode').value==='measured'&&!referenceFile))return;
    const options=$('override').checked&&$('input-type').value!=='edited'?{pre_samples:Number($('pre').value),tail_samples:Number($('tail').value)}:{pre_samples:0,tail_samples:24000};
    if(!Number.isSafeInteger(options.pre_samples)||!Number.isSafeInteger(options.tail_samples)||options.pre_samples<0||options.tail_samples<1||options.pre_samples+options.tail_samples>48000){error('Enter whole sample counts with a total of at most 48,000 samples.');return;}
    invalidate();busy(true);const id=run,selected=file;$('status').textContent='Reading recording…';
    let buffer,reference;const mode=$('input-type').value,selectedReference=$('reference-mode').value==='measured'?referenceFile:null;try{buffer=await selected.arrayBuffer();reference=selectedReference?await selectedReference.arrayBuffer():null;}catch{if(id===run){busy(false);error('The recording could not be read. Select the file again.');}return;}
    if(id!==run)return;
    try{
      worker=new Worker(new URL('processor-worker.js?v=cfcce2d46d51',location.href),{type:'module'});
      worker.onerror=()=>{if(id!==run)return;stop();clearResult();error('The processing worker could not start or stopped unexpectedly. Reload the app using Launch.cmd or its HTTPS website.');};
      worker.onmessage=event=>{
        if(id!==run)return;const data=event.data;
        if(data.type==='progress'){$('status').textContent=data.stage+'…';return;}
        stop();if(data.type==='error'){error(data.message);return;}
        if(data.type==='done'){try{showResult(data.wav,data.report,selected.name,data.prefix);}catch(err){clearResult();error('The output could not be displayed: '+err.message);}}
      };
      worker.postMessage({buffer,options,mode,reference},reference?[buffer,reference]:[buffer]);
    }catch(err){stop();error('The processing worker could not start. Use Launch.cmd or the HTTPS website. '+err.message);}
  };
  function link(id,blob,name){const url=URL.createObjectURL(blob);urls.push(url);$(id).href=url;$(id).download=name;}
  function item(parent,tag,text){const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;}
  function db(value){return value===0?'−∞':(20*Math.log10(value)).toFixed(2);}
  function showResult(wav,result,name,prefix){
    report=result;report.input.filename=name;const ex=report.extraction;
    // The serializer emits interleaved IEEE float32 at the standard 44-byte offset.
    const view=new DataView(wav);audio=Array.from({length:14},()=>new Float32Array(ex.output_frames));
    for(let n=0;n<ex.output_frames;n++)for(let ch=0;ch<14;ch++)audio[ch][n]=view.getFloat32(44+(n*14+ch)*4,true);
    report.output_channel_statistics=[];$('channel-stats').replaceChildren();
    for(const [direction,channels]of Object.entries(routing))for(let ear=0;ear<2;ear++){
      const ch=channels[ear],samples=audio[ch];let peak=0,sum=0,peakSample=0;
      for(let n=0;n<samples.length;n++){const a=Math.abs(samples[n]);sum+=samples[n]*samples[n];if(a>peak){peak=a;peakSample=n;}}
      const rms=Math.sqrt(sum/samples.length),time=(peakSample-ex.pre_samples)/48;
      report.output_channel_statistics.push({direction,ear:ear?'right':'left',channel:ch+1,peak,peak_dbfs:peak?20*Math.log10(peak):null,rms,rms_dbfs:rms?20*Math.log10(rms):null,peak_sample:peak?peakSample:null,peak_time_ms:peak?time:null});
      const tr=document.createElement('tr');for(const value of [direction,ear?'Right':'Left',ch+1,db(peak),db(rms),peak?time.toFixed(3):'—'])item(tr,'td',value);$('channel-stats').append(tr);
    }
    const stats=$('output-stats');stats.replaceChildren();for(const text of ['14 channels','48,000 Hz',`${ex.output_peak_dbfs.toFixed(2)} dBFS`,`${ex.output_frames.toLocaleString()} samples`,`Timing shift ${report.alignment.selected_shift_samples.toLocaleString()} samples`,`Common gain ${db(ex.gain_scalar)} dB`])item(stats,'li',text);
    const base=name.replace(/\.wav$/i,'')+'_HeSuVi';link('download-wav',new Blob([wav],{type:'audio/wav'}),base+'.wav');$('download-prefix').hidden=!prefix;if(prefix)link('download-prefix',new Blob([prefix],{type:'audio/wav'}),base+'_negative_time_prefix.wav');link('download-report',new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),base+'.json');
    $('diagnostics').replaceChildren();item($('diagnostics'),'p',`One common shift aligns the measured median pair peak to reference sample ${report.alignment.reference_median_peak_samples}. Direction and ear timing are preserved. Reference: ${report.alignment.reference_source==='measured_wav'?'analyzed WAV':'saved calibration'}.`);
    const omitted=ex.window_qa.filter(row=>row.post_window_energy_fraction>0);if(omitted.length)item($('diagnostics'),'p','Energy beyond the extraction end: '+omitted.map(row=>`${row.label} ${(row.post_window_energy_fraction*100).toPrecision(3)}%`).join('; ')+'. Increase response length to retain more of the tail.');
    item($('diagnostics'),'pre',JSON.stringify({alignment:report.alignment,extraction:report.extraction},null,2));
    $('plots').replaceChildren();for(const direction of Object.keys(routing)){const figure=document.createElement('figure');item(figure,'figcaption',`${labels[direction]} (${direction})`);const canvas=document.createElement('canvas');canvas.dataset.direction=direction;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${labels[direction]} left and right impulse responses; detailed values in output channel statistics.`);figure.append(canvas);$('plots').append(figure);}
    output.hidden=false;$('status').textContent=omitted.length?'Complete. Some response energy lies beyond the extraction end; see Processing details.':'Complete.';drawPlots();
  }
  function drawPlots(){if(!audio||!$('analysis').open)return;const pre=report.extraction.pre_samples;const selected=$('time-range').value;const end=selected==='all'?audio[0].length:Math.min(audio[0].length,pre+Number(selected)*48);
    for(const canvas of $('plots').querySelectorAll('canvas')){
      const palette=window.HesuviPalette;const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const l=46,r=w-12,t=12,b=h-32,pw=r-l,ph=b-t;ctx.font='12px "Roboto Flex",sans-serif';ctx.fillStyle=palette.muted;ctx.strokeStyle=palette.grid;ctx.lineWidth=1;
      const y=v=>t+(1-v/.8)*ph/2;
      for(const a of [-.8,0,.8]){ctx.beginPath();ctx.moveTo(l,y(a));ctx.lineTo(r,y(a));ctx.stroke();ctx.fillText(a.toFixed(1),4,y(a)+4);}
      ctx.fillText(`${(-pre/48).toFixed(1)} ms`,l,b+22);const last=`${((end-1-pre)/48).toFixed(1)} ms`;ctx.fillText(last,r-ctx.measureText(last).width,b+22);
      routing[canvas.dataset.direction].forEach((ch,ear)=>{ctx.setLineDash(ear?[3,2]:[]);const path=new Path2D(),data=audio[ch];
        if(end<=pw*2){for(let n=0;n<end;n++){const x=l+n/(Math.max(end-1,1))*pw;if(n===0)path.moveTo(x,y(data[n]));else path.lineTo(x,y(data[n]));}}
        else{for(let px=0;px<Math.ceil(pw);px++){const from=Math.floor(px/pw*end),to=Math.min(end,Math.max(from+1,Math.floor((px+1)/pw*end)));let min=Infinity,max=-Infinity;for(let n=from;n<to;n++){min=Math.min(min,data[n]);max=Math.max(max,data[n]);}path.moveTo(l+px,y(min));path.lineTo(l+px,y(max));}}
        ctx.strokeStyle=ear?palette.right:palette.left;ctx.globalAlpha=.18;ctx.lineWidth=2.6;ctx.stroke(path);ctx.globalAlpha=1;ctx.lineWidth=1.5;ctx.stroke(path);ctx.strokeStyle=ear?palette.reflectionRight:palette.reflectionLeft;ctx.globalAlpha=.35;ctx.lineWidth=.5;ctx.stroke(path);ctx.globalAlpha=1;ctx.setLineDash([]);
      });
    }
  }
  updateMode();
  $('analysis').addEventListener('toggle',drawPlots);$('time-range').onchange=drawPlots;window.addEventListener('resize',drawPlots);document.addEventListener('appearancechange',drawPlots);window.addEventListener('pagehide',()=>{stop();clearResult();});
})();

