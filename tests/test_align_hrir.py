import sys
import unittest
import subprocess
import tempfile
import struct
from pathlib import Path
import numpy as np
from scipy.signal import fftconvolve
from scipy.io import wavfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from align_hrir import align, align_capture, peak_positions, read_input
from dirac_to_hesuvi import DiagnosticError, ROUTING


class EditedAlignmentTests(unittest.TestCase):
    def pair(self):
        x=np.zeros((1000,14))
        r=np.zeros((1000,14))
        for i,channels in enumerate(ROUTING.values()):
            x[300+i,channels[0]]=.3+i*.02
            x[306+i,channels[1]]=-.15
            x[-1,channels[0]]=1e-10
            r[100+i,channels[0]]=.4
            r[108+i,channels[1]]=.2
        return x,r

    def test_full_alignment_timing_gain_and_delayed_convolution(self):
        x,r=self.pair();y,report=align(x,r)
        self.assertEqual(report['alignment']['selected_shift_samples'],200)
        np.testing.assert_array_equal(y[:800],(x[200:]*report['extraction']['gain_scalar']).astype(np.float32))
        self.assertAlmostEqual(float(np.max(np.abs(y))),10**(-2/20),places=7)
        self.assertEqual(len(y),len(x))
        for before,after in zip(peak_positions(x),peak_positions(y)):
            self.assertEqual(np.diff(before['ear_peak_samples']),np.diff(after['ear_peak_samples']))
        probe=np.r_[np.zeros(83),np.sin(np.arange(100)/5)]
        for ch in range(14):
            expected=fftconvolve(probe,(x[200:,ch]*report['extraction']['gain_scalar']).astype(np.float32))
            np.testing.assert_allclose(fftconvolve(probe,y[:800,ch]),expected,atol=1e-14)

    def test_padding_keeps_tail_and_all_nonzero_samples(self):
        x,r=self.pair();y,report=align(r,x)
        self.assertEqual(len(y),1200)
        self.assertFalse(y[:200].any())
        np.testing.assert_array_equal(y[200:],(r*report['extraction']['gain_scalar']).astype(np.float32))

    def test_invalid_and_ambiguous_data(self):
        x,r=self.pair()
        for changed in [x[:,:2],x*np.nan,x*0]:
            with self.assertRaises(DiagnosticError):align(changed,r)
        x[1,0]=1e-12
        with self.assertRaisesRegex(DiagnosticError,'remove nonzero'):align(x,r)
        x[1,0]=.2
        with self.assertRaisesRegex(DiagnosticError,'ambiguous'):align(x,r)

    def test_cli_and_overwrite_protection(self):
        x,r=self.pair()
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            wavfile.write(folder/'input.wav',48000,x)
            wavfile.write(folder/'reference.wav',48000,r)
            command=[sys.executable,str(Path(__file__).resolve().parents[1]/'align_hrir.py'),
                     '--input',str(folder/'input.wav'),'--reference',str(folder/'reference.wav'),
                     '--output',str(folder/'output.wav')]
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            np.testing.assert_array_equal(wavfile.read(folder/'output.wav')[1],align(x,r)[0])
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,2)
            self.assertIn('already exists',result.stderr)
            command[-1]=str(folder/'input.wav')
            self.assertEqual(subprocess.run(command,capture_output=True).returncode,2)

    def test_raw_capture_cli_with_actual_stimulus_and_hrir_reference(self):
        x,r=self.pair()
        labels=['FL','SL','BL','FC','FR','SR','BR','LFE']
        channels=[0,6,4,2,1,7,5,3]
        source=np.zeros((432000,8),np.int16)
        capture=np.zeros((432000,2),np.float32)
        events=[]
        for i,(label,ch) in enumerate(zip(labels,channels)):
            sample=(i+1)*48000
            source[sample,ch]=32767
            events.append({'label':label,'sample':sample,'source_channel':ch,'amplitude':32767/32768})
            if label=='LFE':capture[sample+1300]=(.2,.1)
            else:capture[sample+1000:sample+2000]=x[:,ROUTING[label]]
        expected,prefix,_=align_capture(capture,r,events)
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            for name,array in [('input',capture),('reference',r),('stimulus',source)]:
                wavfile.write(folder/(name+'.wav'),48000,array)
            command=[sys.executable,str(Path(__file__).resolve().parents[1]/'align_hrir.py'),
                     '--capture','--stimulus',str(folder/'stimulus.wav'),
                     '--input',str(folder/'input.wav'),'--reference',str(folder/'reference.wav'),
                     '--output',str(folder/'output.wav')]
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            np.testing.assert_array_equal(wavfile.read(folder/'output.wav')[1],expected)
            np.testing.assert_array_equal(wavfile.read(folder/'output_negative_time_prefix.wav')[1],prefix)

    def test_pcm24_full_scale_is_rejected_using_stored_bit_depth(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'pcm24.wav'
            for value in [8388606,8388607]:
                data=value.to_bytes(3,'little')+bytes(39)
                path.write_bytes(b'RIFF'+struct.pack('<I',36+len(data))+b'WAVEfmt '+
                                 struct.pack('<IHHIIHH',16,1,14,48000,48000*42,42,24)+
                                 b'data'+struct.pack('<I',len(data))+data)
                if value==8388607:
                    with self.assertRaisesRegex(DiagnosticError,'full-scale'):read_input(path)
                else:self.assertEqual(read_input(path)[0],48000)


if __name__=='__main__':unittest.main()
