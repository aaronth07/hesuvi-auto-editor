import { processWave } from './processor.js?v=0dcfc5503491';

self.onmessage = async ({data}) => {
  try {
    const {wav,prefix,report} = await processWave(data.buffer,data.options,stage=>self.postMessage({type:'progress',stage}));
    self.postMessage({type:'done',wav,prefix,report},prefix?[wav,prefix]:[wav]);
  } catch(error) {
    self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});
  }
};
