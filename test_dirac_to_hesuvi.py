import unittest, tempfile, json, contextlib, io
from unittest.mock import patch
from pathlib import Path
import numpy as np
from scipy.io import wavfile
import dirac_to_hesuvi as d
CFG=json.loads((Path(__file__).parent/'config.json').read_text())
class Tests(unittest.TestCase):
 def fixture(self,delay=173,noise=0,polarity=1,late=False,drift=0):
  sr=48000;x=np.random.default_rng(2).normal(0,noise,(sr*10,2));events=[]
  for i,label in enumerate(['FL','SL','BL','FC','FR','SR','BR','LFE']):
   t=(i+1)*sr;events.append({'label':label,'sample':t});p=t+delay+i*drift
   x[p,0]+=polarity*.2;x[p+7,1]+=polarity*.1
   if late:x[p+400,0]+=polarity*.8;x[p+407,1]+=polarity*.4
  return sr,x,events
 def test_known_delay(self):
  sr,x,ev=self.fixture();det,_=d.detect(x,sr,CFG);r=d.match(ev,det,sr,CFG);self.assertTrue(all(v['onset']-e['sample']==173 for v,e in zip(r,ev)))
 def test_polarity_invariant_detection(self):
  sr,x,e=self.fixture();a,_=d.detect(x,sr,CFG);b,_=d.detect(-x,sr,CFG);self.assertEqual([v['onset'] for v in a],[v['onset'] for v in b])
 def test_stronger_late_echo_not_onset(self):
  sr,x,e=self.fixture(late=True);a,_=d.detect(x,sr,CFG)
  for v,event in zip(a,e):self.assertEqual(v['onset'],event['sample']+173);self.assertEqual(v['peak']-v['onset'],400)
 def test_noise(self):
  sr,x,e=self.fixture(noise=1e-7);a,_=d.detect(x,sr,CFG);self.assertEqual(len(a),8);self.assertTrue(all(v['onset']==event['sample']+173 for v,event in zip(a,e)))
 def test_missing_event_failure(self):
  sr,x,e=self.fixture();x[4*sr:4*sr+1000]=0;a,_=d.detect(x,sr,CFG)
  with self.assertRaises(d.DiagnosticError):d.match(e,a,sr,CFG)
 def test_extra_event_failure(self):
  sr,x,e=self.fixture();x[25000]=.5;a,_=d.detect(x,sr,CFG)
  with self.assertRaises(d.DiagnosticError):d.match(e,a,sr,CFG)
 def test_drift_not_silently_accepted(self):
  sr,x,e=self.fixture(drift=20);a,_=d.detect(x,sr,CFG);c=dict(CFG,max_schedule_residual_samples=2)
  with self.assertRaises(d.DiagnosticError):d.match(e,a,sr,c)
 def test_routing_itd_polarity_global_gain(self):
  sr,x,e=self.fixture(polarity=-1);y,m=d.extract(x,e,173,10,1000)
  for label,(l,r) in d.ROUTING.items():
   self.assertEqual(int(np.argmax(abs(y[:,r])))-int(np.argmax(abs(y[:,l]))),7);self.assertLess(y[10,l],0);self.assertAlmostEqual(float(y[17,r]/y[10,l]),.5)
  self.assertAlmostEqual(float(np.max(abs(y))),10**(-2/20),places=6);self.assertEqual(y.dtype,np.float32)
 def test_lfe_excluded(self):
  sr,x,e=self.fixture();y,_=d.extract(x,e,173,0,1000);x[e[-1]['sample']+173: e[-1]['sample']+180]*=10;z,_=d.extract(x,e,173,0,1000);np.testing.assert_array_equal(y,z)
 def test_end_to_end_stronger_late_replica_fails(self):
  with tempfile.TemporaryDirectory() as td:
   td=Path(td);sr=48000;labels=['FL','FR','FC','LFE','BL','BR','SL','SR']
   source=np.zeros((432000,8),np.int16);apple=np.zeros((432000,2),np.float32);far=apple.copy()
   for i,label in enumerate(['FL','SL','BL','FC','FR','SR','BR','LFE']):
    t=(i+1)*sr;source[t,labels.index(label)]=32767;apple[t+53]=[.2,.1];far[t+173]=[.2,.1];far[t+573]=[.8,.4]
   for name,data in [('stimulus',source),('apple',apple),('far',far)]:wavfile.write(td/(name+'.wav'),sr,data)
   c=dict(CFG,stimulus='stimulus.wav',apple='apple.wav',capture='far.wav',source_channel_map=labels)
   with self.assertRaisesRegex(d.DiagnosticError,'substantial earlier feature'),patch.object(d,'plots'):d.run(c,td,td,False)
   self.assertFalse((td/'Apple_HeSuVi_peak.wav').exists())
if __name__=='__main__':unittest.main(verbosity=2)
