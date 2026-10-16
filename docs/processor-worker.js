import { processWave, processEditedWave, validateStimulus } from './processor.js?v=4540236aabde';

self.onmessage = async ({data}) => {
  try {
    const progress=stage=>self.postMessage({type:'progress',stage});
    let baseStimulus=null;if(data.stimulus){progress('Checking 7.1 Dirac stimulus');baseStimulus=await validateStimulus(data.stimulus);}
    const {wav,prefix,report} = data.mode==='edited' ? await processEditedWave(data.buffer,data.reference,progress,data.editedOptions) : await processWave(data.buffer,data.options,progress,data.reference);
    if(data.bundled&&report.alignment.reference_input?.sha256!=='41e220201015fba7f606863f0327357acb1692dcc465cf69022c3d69cf78ca4c')throw new Error('The bundled Apple reference does not match the established reference. Reload reference files.');
    report.base_stimulus=baseStimulus;
    self.postMessage({type:'done',wav,prefix,report},prefix?[wav,prefix]:[wav]);
  } catch(error) {
    self.postMessage({type:error?.name==='LeadingSamplesWarning'?'warning':'error',message:error instanceof Error?error.message:String(error)});
  }
};
