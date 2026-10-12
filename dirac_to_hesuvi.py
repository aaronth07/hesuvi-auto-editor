#!/usr/bin/env python3
"""Deterministic, source-aware stereo Dirac capture extraction. No AI or EQ."""
import argparse, csv, hashlib, json, struct, warnings
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from scipy.signal import correlate, correlation_lags
ROUTING={'FL':(0,1),'SL':(2,3),'BL':(4,5),'FC':(6,13),'FR':(8,7),'SR':(10,9),'BR':(12,11)}
AZIMUTH={'FL':30,'SL':90,'BL':150,'FC':0,'FR':-30,'SR':-90,'BR':-150}
SPEAKERS={1:'FL',2:'FR',4:'FC',8:'LFE',16:'BL',32:'BR',512:'SL',1024:'SR'}
class DiagnosticError(ValueError): pass
def require(ok,msg):
    if not ok: raise DiagnosticError(msg)
def read(path):
    with warnings.catch_warnings():
        warnings.simplefilter('ignore',wavfile.WavFileWarning); sr,x=wavfile.read(path)
    dtype=str(x.dtype)
    if np.issubdtype(x.dtype,np.integer):
        x=(x.astype(np.float64)-128)/128 if x.dtype==np.uint8 else x.astype(np.float64)/2**(np.iinfo(x.dtype).bits-1)
    else: x=x.astype(np.float64)
    require(x.ndim==2 and np.all(np.isfinite(x)),f'{path}: need finite multichannel WAV')
    return sr,x,{'path':str(path),'sha256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),'frames':len(x),'channels':x.shape[1],'sample_rate':sr,'stored_dtype':dtype}
def channel_mask(path):
    with open(path,'rb') as f:
        require(f.read(4)==b'RIFF','Only RIFF WAVE supported'); f.read(4);require(f.read(4)==b'WAVE','Not WAVE')
        while True:
            h=f.read(8)
            if len(h)!=8: return None
            tag,n=struct.unpack('<4sI',h)
            if tag==b'fmt ':
                b=f.read(n)
                return struct.unpack_from('<I',b,20)[0] if len(b)>=40 and struct.unpack_from('<H',b)[0]==65534 else None
            f.seek(n+(n&1),1)
def stimulus(path,override=None):
    sr,x,info=read(path);mask=channel_mask(path)
    metadata_labels=([SPEAKERS.get(1<<i,'UNKNOWN') for i in range(32) if mask&(1<<i)] if mask is not None else None)
    require(mask is None or override is None or override==metadata_labels,'source_channel_map conflicts with present WAV mask; metadata cannot be overridden')
    labels=metadata_labels if mask is not None else override
    require(labels is not None,'Missing WAVE channel mask: supply verified source_channel_map')
    require(len(labels)==x.shape[1] and set(labels)==set(ROUTING)|{'LFE'},'Need verified eight-channel 7.1 map, including LFE')
    events=[]
    for c,label in enumerate(labels):
        ix=np.flatnonzero(x[:,c])
        require(len(ix)==1,f'{label}: source must contain exactly one nonzero Dirac sample')
        events.append({'label':label,'source_channel':c,'sample':int(ix[0]),'amplitude':float(x[ix[0],c])})
    events.sort(key=lambda e:e['sample']); require(np.min(np.diff([e['sample'] for e in events]))>sr*.5,'Events too close')
    info.update(channel_mask=mask,channel_map=labels);return sr,events,info

def detect(x,sr,cfg):
    """Group significant activity with quiet gaps; fail closed if event count differs."""
    a=np.max(abs(x),axis=1); peak=float(a.max());require(peak>0,'Silent capture')
    noise=float(np.median(a));threshold=max(cfg['activity_floor'],noise*cfg['noise_multiplier'],peak*10**(cfg['activity_db']/20))
    ix=np.flatnonzero(a>threshold);require(len(ix)>0,'No events above noise')
    splits=np.flatnonzero(np.diff(ix)>round(cfg['quiet_gap_seconds']*sr))
    regions=list(zip(np.r_[ix[0],ix[splits+1]],np.r_[ix[splits],ix[-1]]))
    regions=[(int(a),int(b)+1) for a,b in regions]
    details=[]
    for j,(lo,hi) in enumerate(regions):
        left=0 if j==0 else (regions[j-1][1]+lo)//2
        right=len(x) if j+1==len(regions) else (hi+regions[j+1][0])//2
        pair=a[left:right];p=float(pair.max());pk=int(np.argmax(pair)+left)
        def onset(db):
            thr=max(cfg['onset_floor'],noise*cfg['noise_multiplier'],p*10**(db/20));hit=np.flatnonzero(pair>thr)
            require(len(hit)>0,'Onset below noise');return int(hit[0]+left)
        ons={str(db):onset(db) for db in [-60,-80,-100,-120]}
        ears=np.argmax(abs(x[left:right]),axis=0)+left
        substantial_threshold=max(noise*cfg['noise_multiplier'],p*10**(cfg.get('early_feature_db',-20)/20))
        substantial=np.flatnonzero(a[left:pk+1]>substantial_threshold)
        first_substantial=int(substantial[0]+left) if len(substantial) else pk
        details.append({'region_start':lo,'region_end_exclusive':hi,'onset':onset(cfg['onset_db']),'peak':pk,'peak_abs':p,'onset_thresholds':ons,'ear_peak_samples':[int(v) for v in ears],'noise_floor':noise,'first_substantial_feature':first_substantial,'substantial_feature_lead_samples':pk-first_substantial,'search_start':left,'search_end':right})
    return details,{'activity_threshold':threshold,'median_abs_pair_noise':noise,'event_count':len(details)}
def match(events,det,sr,cfg):
    require(len(events)==len(det),f"Expected {len(events)} events including LFE, detected {len(det)}. Supply a cleaner capture or inspect detection parameters; no invented mapping.")
    source=np.array([e['sample'] for e in events]);onsets=np.array([d['onset'] for d in det]);off=onsets-source
    require(np.ptp(off)<=cfg['max_schedule_residual_samples'],f'Event schedule mismatch (offset range {np.ptp(off)} samples); inspect event assignment and recording timing')
    return [dict(e,**d,source_to_onset_samples=int(d['onset']-e['sample']),source_to_peak_samples=int(d['peak']-e['sample'])) for e,d in zip(events,det)]

def common_peak_shift(events, reference_rows, capture_rows):
    """Choose one crop offset; preserve renderer-specific direction and ear delays.

    The reference calibrates the median pair-peak position, not each waveform.
    This is an editing convention, not a measurement of physical latency.
    """
    directional = [i for i, event in enumerate(events) if event['label'] != 'LFE']
    require(len(directional) == 7, 'Expected seven directional events')
    reference_offsets = [int(reference_rows[i]['peak'] - events[i]['sample']) for i in directional]
    capture_offsets = [int(capture_rows[i]['peak'] - events[i]['sample']) for i in directional]
    reference_anchor = int(np.median(reference_offsets))
    capture_anchor = int(np.median(capture_offsets))
    shift = capture_anchor - reference_anchor
    return shift, {
        'method': 'common_median_pair_peak',
        'reference_median_peak_samples': reference_anchor,
        'capture_median_peak_samples': capture_anchor,
        'reference_peak_offsets_samples': reference_offsets,
        'capture_peak_offsets_samples': capture_offsets,
        'output_peak_samples': [offset - shift for offset in capture_offsets],
        'physical_latency_identifiable': False,
    }

def extract(x,events,shift,pre,tail):
    out=np.zeros((pre+tail,14),np.float64);ranges=[]
    for e in events:
        if e['label']=='LFE':continue
        start=e['sample']+shift-pre;end=e['sample']+shift+tail
        require(start>=0 and end<=len(x),f"{e['label']}: extraction exceeds capture bounds")
        out[:,ROUTING[e['label']]]=x[start:end]
        ranges.append({'label':e['label'],'source_start_inclusive':start,'source_end_exclusive':end,'output_channels':ROUTING[e['label']]})
    peak=float(np.max(abs(out)));require(peak>0,'Silent extraction');gain=10**(-2/20)/peak
    return (out*gain).astype(np.float32),{'gain_scalar':gain,'pre_gain_peak':peak,'target_peak_dbfs':-2,'ranges':ranges}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',required=True);p.add_argument('--dry-run',action='store_true');a=p.parse_args()
    cp=Path(a.config).resolve();cfg=json.loads(cp.read_text());base=cp.parent
    out=base/cfg.get('output_dir','output');out.mkdir(parents=True,exist_ok=True)
    try:run(cfg,base,out,a.dry_run)
    except DiagnosticError as e:
        (out/'failure.json').write_text(json.dumps({'status':'diagnostic_failure','error':str(e)},indent=2));print('DIAGNOSTIC FAILURE:',e);raise SystemExit(2)
def run(cfg,base,out,dry):
    cfg = dict(cfg)
    cfg.setdefault('alignment', 'common_peak')
    sr,events,si=stimulus(base/cfg['stimulus'],cfg.get('source_channel_map'))
    loaded={};qa={'status':'dry_run' if dry else 'passed','stimulus':si,'routing':ROUTING,'azimuth_degrees':AZIMUTH,'events':events,'alignment_convention':cfg['alignment'],'captures':{}}
    require(cfg['alignment'] in ('common_peak','apple_onset','apple_peak'),'alignment must be common_peak, apple_onset or apple_peak')
    common_mode = cfg['alignment'] == 'common_peak'
    for name,key in [('Apple','apple'),('Far','capture')]:
        fs,x,info=read(base/cfg[key]);require(fs==sr and x.shape[1]==2,'Captures must be stereo at source sample rate; no silent resampling')
        det,diag=detect(x,sr,cfg);(out/f'{name}_detected_candidates.json').write_text(json.dumps({'source':info,'detection':diag,'candidates':det},indent=2));rows=match(events,det,sr,cfg);loaded[name]=(x,rows);qa['captures'][name]={'source':info,'detection':diag,'events':rows}
    dirs=[i for i,e in enumerate(events) if e['label']!='LFE'];ar=loaded['Apple'][1];fr=loaded['Far'][1]
    differences={k:np.array([fr[i][k]-ar[i][k] for i in dirs]) for k in ['onset','peak']}
    shifts={k:int(np.rint(np.median(v))) for k,v in differences.items()}
    mode='onset' if cfg['alignment']=='apple_onset' else 'peak'
    if mode=='peak' and 'capture_shift_samples' not in cfg:
        ambiguous=[f"{name}/{events[i]['label']}: {rows[i]['substantial_feature_lead_samples']} samples" for name,(_,rows) in loaded.items() for i in dirs if rows[i]['substantial_feature_lead_samples']>cfg.get('early_feature_guard_samples',48)]
        require(not ambiguous,'Ambiguous peak anchor: substantial earlier feature may be the direct response and strongest peak a late reflection. Review explicit shift override; '+ '; '.join(ambiguous))
    common_shift, timing = common_peak_shift(events, ar, fr)
    shift=int(cfg.get('capture_shift_samples',common_shift if common_mode else shifts[mode]))
    timing['explicit_shift_override'] = 'capture_shift_samples' in cfg
    timing['applied_shift_samples'] = shift
    residual=differences[mode]-shift
    if not common_mode:
        require(np.max(abs(residual))<=cfg['max_alignment_residual_samples'] or 'capture_shift_samples' in cfg,'Nonconstant capture alignment; explicit reviewed override required')
    xcorr=[]
    for i in ([] if common_mode else dirs):
        center=events[i]['sample']; left=-1024; right=4096
        aa=loaded['Apple'][0][center+left:center+right]
        bb=loaded['Far'][0][center+shift+left:center+shift+right]
        require(aa.shape==bb.shape and len(aa)==right-left,'Cross-correlation window outside capture')
        cc=sum(correlate(bb[:,ear],aa[:,ear],mode='full',method='fft') for ear in range(2));lags=correlation_lags(len(bb),len(aa));keep=abs(lags)<=1024
        cc=cc[keep];lags=lags[keep];best=int(np.argmax(abs(cc)));coef=float(cc[best]/np.sqrt(np.sum(aa**2)*np.sum(bb**2)))
        xcorr.append({'label':events[i]['label'],'residual_lag_samples':int(lags[best]),'coefficient':coef})
    if not common_mode and mode=='peak' and 'capture_shift_samples' not in cfg:
        require(all(abs(v['residual_lag_samples'])<=cfg.get('max_xcorr_residual_samples',2) and abs(v['coefficient'])>=cfg.get('min_xcorr_coefficient',.4) for v in xcorr),'Peak anchors not corroborated by stereo waveform correlation. Review onset/late-reflection diagnostics and set explicit capture_shift_samples if justified.')
    pre=int(cfg['pre_samples']);tail=int(cfg['tail_samples']);require(pre>=0 and tail>0,'Invalid extraction window')
    spacing=int(min(np.diff([e['sample'] for e in events])));require(pre+tail<=spacing,'Extraction windows overlap neighboring events')
    # Prefix capacity and extraction bounds are preflighted for BOTH captures, including dry-run,
    # before any audio writes. A failure cannot leave a partially updated audio set.
    for name,(x,rows) in loaded.items():
        sh=0 if name=='Apple' else shift
        for i in dirs:
            start=events[i]['sample']+sh-pre;end=events[i]['sample']+sh+tail
            require(start>=0 and end<=len(x),'Extraction outside capture')
            require(rows[i]['onset']<end and (start<=rows[i]['onset'] or cfg.get('archive_negative_prefix',False)),'Window omits onset without archival permission')
            require(start <= rows[i]['peak'] < end, 'Extraction window omits the detected response peak')
            if common_mode:
                if not cfg.get('archive_negative_prefix',False):
                    omitted_prefix=x[rows[i]['search_start']:max(rows[i]['search_start'],start)]
                    require(not np.any(omitted_prefix),f"{name}/{events[i]['label']}: window omits pre-response; enable prefix archival or increase pre_samples")
                omitted_tail=x[max(end,rows[i]['search_start']):rows[i]['search_end']]
                tail_limit=max(cfg['activity_floor'],rows[i]['noise_floor']*cfg['noise_multiplier'],rows[i]['peak_abs']*10**(cfg['activity_db']/20))
                require(not np.any(abs(omitted_tail)>tail_limit),f"{name}/{events[i]['label']}: response tail exceeds extraction window; increase tail_samples")
            if cfg.get('archive_negative_prefix',False) and pre==0:
                n=int(cfg.get('archive_prefix_samples',1024));require(n>0 and start>=n,'Invalid prefix length or prefix outside source')
                require(not np.any(x[rows[i]['search_start']:max(rows[i]['search_start'],start-n)]),'Nonzero pre-response exceeds prefix archive; increase archive_prefix_samples')
    sensitivity={}
    for db in ['-60','-80','-100','-120']:
        delta=np.array([fr[i]['onset_thresholds'][db]-ar[i]['onset_thresholds'][db] for i in dirs]);sensitivity[db]={'median_shift':int(np.rint(np.median(delta))),'min':int(delta.min()),'max':int(delta.max())}
    t=np.array([events[i]['sample'] for i in dirs]);peakoffs=np.array([fr[i]['peak']-events[i]['sample'] for i in dirs]);slope=float(np.polyfit(t,peakoffs,1)[0]);peakrange=int(np.ptp(peakoffs))
    qa['alignment']={'selected_shift_samples':shift,'stereo_xcorr_check':xcorr,'selected_shift_seconds':shift/sr,'candidate_shifts':shifts,'residual_samples':[int(v) for v in residual],'threshold_sensitivity_db':sensitivity,'drift':{'peak_offset_range_samples':peakrange,'fitted_peak_slope_ppm':slope*1e6,'correction_applied':False,'interpretation':'Peak spacing supports no measurable drift in this short capture; not a clock calibration. Variable directional responses confound onset slope.'},'confidence':'high schedule/order under chronological-playback assumption; onset calibration is threshold-dependent, not physical latency identification','absolute_latency_identifiable':False}
    qa['alignment']['drift']['interpretation']='Direction-dependent response timing confounds this slope and spread; neither establishes nor excludes clock drift.'
    if common_mode:
        qa['alignment'].update(timing)
        qa['alignment']['reference_residuals_are_acceptance_criteria']=False
        qa['alignment']['confidence']='Chronological event assignment with one common crop offset; renderer-specific timing is preserved.'
    for name,(x,rows) in loaded.items():
        sh=0 if name=='Apple' else shift;y,meta=extract(x,events,sh,pre,tail);meta.update(shift_samples=sh,sample_rate=sr,output_frames=len(y),output_channels=14,output_peak_dbfs=float(20*np.log10(np.max(abs(y)))),dtype='float32',time_zero_output_sample=pre)
        meta['window_qa']=[]
        for i in dirs:
            e=events[i];d=rows[i];start=e['sample']+sh-pre;end=e['sample']+sh+tail
            require(d['onset']<end and (start<=d['onset'] or cfg.get('archive_negative_prefix',False)),'Window does not retain onset; explicitly enable negative-prefix archival or increase pre_samples')
            full=x[d['search_start']:d['search_end']];total=float(np.sum(full**2))
            lostpre=x[d['search_start']:max(d['search_start'],start)];losttail=x[min(end,d['search_end']):d['search_end']]
            meta['window_qa'].append({'label':e['label'],'output_onset':d['onset']-start,'output_pair_peak':d['peak']-start,'pre_window_energy_fraction':float(np.sum(lostpre**2))/total,'post_window_energy_fraction':float(np.sum(losttail**2))/total,'ear_peak_difference_samples':d['ear_peak_samples'][1]-d['ear_peak_samples'][0]})
        if not dry and cfg.get('archive_negative_prefix',False) and pre==0:
            n=int(cfg.get('archive_prefix_samples',1024));prefix=np.zeros((n,14),np.float64)
            for i in dirs:
                e=events[i];start=e['sample']+sh
                require(start>=n,'Prefix outside source')
                prefix[:,ROUTING[e['label']]]=x[start-n:start]
                require(not np.any(x[rows[i]['search_start']:start-n]),'Nonzero pre-response exceeds prefix archive; increase archive_prefix_samples')
            pf=out/f'{name}_negative_time_prefix.wav';wavfile.write(pf,sr,(prefix*meta['gain_scalar']).astype(np.float32))
            meta['negative_time_prefix']={'file':pf.name,'frames':n,'relative_sample_range':[-n,-1],'same_gain_as_main':True,'sha256':hashlib.sha256(pf.read_bytes()).hexdigest()}
        if not dry:
            fn=out/f'{name}_HeSuVi_{mode}.wav';wavfile.write(fn,sr,y);meta['output_file']=fn.name;meta['sha256']=hashlib.sha256(fn.read_bytes()).hexdigest()
        qa['captures'][name]['extraction']=meta
    qa['recoverability']='Original files are unmodified and included under sources/. Extraction source ranges, shifts, scalar gains and hashes are recorded; all omitted prefixes/tails remain recoverable from originals. Normalization/float32 rounding are not mathematically invertible; original bytes are authoritative.'
    qa['limitations']=['Chronological capture event identity assumed. Identical impulses cannot prove speaker routing within a downstream renderer.','No physical capture-start versus processing-latency decomposition is identifiable.','Onsets are operational amplitude thresholds, not claims of acoustic direct-path arrival.','No EQ, ear-wise gain, phase inversion, resampling or drift correction.']
    (out/'qa.json').write_text(json.dumps(qa,indent=2)+'\n')
    with (out/'events.csv').open('w',newline='') as f:
        w=csv.writer(f);w.writerow(['direction','source_sample','Apple_onset','Apple_peak','Far_onset','Far_peak','Far_source_to_onset','Far_source_to_peak','Far_onset_after_shift','Apple_onset_relative','Far_onset_relative_after_shift'])
        for e,ad,fd in zip(events,ar,fr):
            row=[e['label'],e['sample'],ad['onset'],ad['peak'],fd['onset'],fd['peak'],fd['onset']-e['sample'],fd['peak']-e['sample'],fd['onset']-shift,ad['onset']-e['sample'],fd['onset']-shift-e['sample']];w.writerow(row);print(','.join(map(str,row)))
    plots(out,loaded,events,shift,sr)
    print('Selected pair-shared global shift:',shift,'samples; Apple shift=0. QA:',out/'qa.json')
def plots(out,loaded,events,shift,sr):
    import matplotlib;matplotlib.use('Agg');import matplotlib.pyplot as plt
    fig,axs=plt.subplots(7,1,figsize=(11,15));dirs=[e for e in events if e['label']!='LFE']
    for ax,e in zip(axs,dirs):
        for name,(x,rows) in loaded.items():
            sh=0 if name=='Apple' else shift;center=e['sample']+sh;lo=center-800;hi=center+1600;v=np.max(abs(x[lo:hi]),axis=1);ax.plot((np.arange(lo,hi)-center)/sr*1000,20*np.log10(np.maximum(v,1e-9)/np.max(v)),label=name,lw=.8)
        ax.set(title=e['label'],ylim=(-140,3),xlim=(-16,33),ylabel='dB / event peak');ax.axvline(0,color='k',lw=.4);ax.grid(alpha=.2)
    axs[0].legend();axs[-1].set_xlabel('Milliseconds relative to fixed Apple stimulus time (Far calibrated)');fig.tight_layout();fig.savefig(out/'onset_diagnostics.png',dpi=110);plt.close(fig)
if __name__=='__main__':main()
