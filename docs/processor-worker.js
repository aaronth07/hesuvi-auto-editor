import { processWave, processEditedWave } from './processor.js?v=0f265936e231';

self.onmessage = async ({data}) => {
  try {
    const progress=stage=>self.postMessage({type:'progress',stage});
    const {wav,prefix,report} = data.mode==='edited' ? await processEditedWave(data.buffer,data.reference,progress) : await processWave(data.buffer,data.options,progress,data.reference);
    self.postMessage({type:'done',wav,prefix,report},prefix?[wav,prefix]:[wav]);
  } catch(error) {
    self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});
  }
};
