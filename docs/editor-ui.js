/* No uploads, network calls, storage, audio decoding, or browser DSP. */
'use strict';
const defaults = {"stimulus": "sources/dirac-stimulus.wav", "apple": "sources/reference-stereo.wav", "capture": "sources/capture-stereo.wav", "output_dir": "output", "alignment": "apple_peak", "onset_db": -80, "onset_floor": 1e-08, "activity_db": -100, "activity_floor": 1e-07, "noise_multiplier": 20, "quiet_gap_seconds": 0.15, "max_schedule_residual_samples": 2048, "max_alignment_residual_samples": 2, "pre_samples": 0, "tail_samples": 24000, "max_xcorr_residual_samples": 2, "min_xcorr_coefficient": 0.4, "archive_negative_prefix": true, "archive_prefix_samples": 1024, "early_feature_db": -20, "early_feature_guard_samples": 48};
const keys = ['stimulus','apple','capture'];
const chosen = {}, generations = {};
const status = document.getElementById('prepare-status');
const button = document.getElementById('download-config');
function update() {
  button.disabled = true;
  if (!keys.every(key => chosen[key])) {status.textContent='Choose three valid WAV headers to prepare a config.';return;}
  if (chosen.stimulus.meta.channels !== 8 || chosen.apple.meta.channels !== 2 || chosen.capture.meta.channels !== 2) {status.textContent='The stimulus must have 8 channels; reference and target must each be stereo.';return;}
  if (!keys.every(key=>chosen[key].meta.sampleRate===chosen.stimulus.meta.sampleRate)) {status.textContent='Sample rates differ. The CLI does not resample.';return;}
  if (chosen.stimulus.meta.mask !== 0x63f) {status.textContent='This starter requires stimulus channel mask 0x63f. A missing mask needs a verified manual source_channel_map in the CLI config.';return;}
  const names=keys.map(key=>chosen[key].name);
  if (new Set(names).size!==3) {status.textContent='Use distinct filenames so the three sources do not overwrite one another in sources/.';return;}
  button.disabled=false;
  status.textContent='Headers are compatible. Download the config, then run the CLI dry run. Audio content and timing are not validated here.';
}
keys.forEach(key=>document.getElementById(key).addEventListener('change',async event=>{
  const generation=(generations[key]||0)+1;generations[key]=generation;delete chosen[key];update();
  const file=event.target.files[0], info=document.getElementById(key+'-info');
  if (!file) {info.textContent='No file selected.';return;}
  info.textContent='Reading WAV header…';
  try {
    const meta=await HesuviCore.inspectWave(file);
    if (generation!==generations[key]) return;
    chosen[key]={name:file.name,meta};
    info.textContent=file.name+' · '+meta.channels+' channels · '+meta.sampleRate+' Hz · '+meta.bits+' bit · '+meta.duration.toFixed(3)+' s'+(meta.mask===null?' · no channel mask':' · mask 0x'+meta.mask.toString(16));
  } catch(error) {if(generation!==generations[key])return;info.textContent=error.message;}
  update();
}));
document.getElementById('prepare-form').addEventListener('submit',event=>{
  event.preventDefault();update();if(button.disabled)return;
  try {
    const names=Object.fromEntries(keys.map(key=>[key,chosen[key].name]));
    const advanced=Object.fromEntries(['alignment','pre_samples','tail_samples'].map(key=>[key,document.getElementById(key).value]));
    const config=HesuviCore.buildConfig(defaults,names,advanced);
    const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='config.local.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent='Config download requested. Place the three WAVs in sources/ and run the CLI dry run.';
  } catch(error) {status.textContent=error.message;}
});
document.getElementById('reset-form').addEventListener('click',()=>{
  document.getElementById('prepare-form').reset();
  keys.forEach(key=>{generations[key]=(generations[key]||0)+1;delete chosen[key];document.getElementById(key+'-info').textContent='No file selected.';});update();
});
