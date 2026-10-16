'use strict';
(() => {
  const $=id=>document.getElementById(id),defaults={dark:'oklch(0.1558 0.0063 285.64)',light:'oklch(0.94 0.0063 285.64)'};
  let state={layout:'glass',theme:'dark',colors:{...defaults}};
  try{const saved=JSON.parse(localStorage.getItem('hesuvi-appearance'));if(saved){if(['simple','glass'].includes(saved.layout))state.layout=saved.layout;if(['dark','light'].includes(saved.theme))state.theme=saved.theme;for(const theme of ['dark','light'])if(HesuviMaterials.parseColor(saved.colors?.[theme]))state.colors[theme]=saved.colors[theme];}}catch{}
  function apply(){const tokens=HesuviMaterials.materialTokens(state.theme,state.colors[state.theme]);for(const [key,value]of Object.entries(tokens.css))document.documentElement.style.setProperty(key,value);document.documentElement.style.colorScheme=state.theme;document.documentElement.dataset.theme=state.theme;document.documentElement.dataset.layout=state.layout;$('layout').value=state.layout;window.HesuviPalette=tokens.canvas;window.HesuviContrast=tokens.contrastReport;$('theme').value=state.theme;$('base-color').value=state.colors[state.theme];$('color-error').hidden=true;try{localStorage.setItem('hesuvi-appearance',JSON.stringify(state));}catch{}document.dispatchEvent(new Event('appearancechange'));}
  $('layout').onchange=()=>{state.layout=$('layout').value;clearLighting();apply();};
  apply();
  $('appearance').onclick=()=>{$('appearance-dialog').showModal();clearLighting();};
  $('close-appearance').onclick=()=>$('appearance-dialog').close();
  $('appearance-dialog').addEventListener('close',()=>{clearLighting();$('appearance').focus();});
  $('theme').onchange=()=>{state.theme=$('theme').value;apply();};
  $('color-form').onsubmit=e=>{e.preventDefault();const color=$('base-color').value.trim();if(!HesuviMaterials.parseColor(color)){$('color-error').textContent='Enter an opaque OKLCH color or a 3- or 6-digit hex color.';$('color-error').hidden=false;return;}state.colors[state.theme]=color;apply();};
  $('reset-color').onclick=()=>{state.colors[state.theme]=defaults[state.theme];apply();};
  const reduce=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover: hover) and (pointer: fine)');
  const ambient=document.querySelector('.ambient-lights'),fill=document.querySelector('.ambient-fill'),rim=document.querySelector('.ambient-rim'),lights=new WeakMap();
  let pending=0,point=null,active=[],currentX=0,currentY=0,lastTime=0;
  function clearLocal(){for(const entry of active){entry.light.style.opacity='0';entry.element.style.removeProperty('--cast-x');entry.element.style.removeProperty('--cast-y');}active=[];}
  function clearLighting(){
    if(pending)cancelAnimationFrame(pending);
    pending=0;point=null;lastTime=0;currentX=currentY=0;
    clearLocal();for(const layer of [ambient,fill,rim])layer.style.removeProperty('transform');
  }
  function setLocalTargets(target,x,y){
    const control=target.closest('button:not(:disabled),a.button,summary');
    const surface=target.closest('#drop-zone,#editor,#output,dialog');
    const elements=[...new Set([control,surface].filter(Boolean))];
    if(elements.length===active.length&&elements.every(element=>active.some(entry=>entry.element===element)))return;
    const rects=elements.map(element=>element.getBoundingClientRect());
    const next=elements.map((element,index)=>{
      const existing=lights.get(element);if(existing){existing.rect=rects[index];existing.x=x-rects[index].left;existing.y=y-rects[index].top;existing.shown=false;return existing;}
      const clip=document.createElement('span'),light=document.createElement('span');
      clip.className='light-clip';clip.setAttribute('aria-hidden','true');light.className='cursor-light';
      clip.append(light);element.append(clip);
      const entry={element,clip,light,rect:rects[index],x:x-rects[index].left,y:y-rects[index].top,shown:false};lights.set(element,entry);return entry;
    });
    for(const entry of active)if(!elements.includes(entry.element)){entry.light.style.opacity='0';entry.element.style.removeProperty('--cast-x');entry.element.style.removeProperty('--cast-y');}
    active=next;
  }
  function renderLighting(time){
    pending=0;if(!point)return;
    const dt=Math.min(50,time-lastTime||16);lastTime=time;
    const amount=1-Math.exp(-dt/110),localAmount=1-Math.exp(-dt/45);
    const targetX=point.x/innerWidth*2-1,targetY=point.y/innerHeight*2-1;
    currentX+=(targetX-currentX)*amount;currentY+=(targetY-currentY)*amount;
    if(!$('appearance-dialog').open){ambient.style.transform=`translate3d(${(currentX*54).toFixed(2)}px,${(currentY*36).toFixed(2)}px,0)`;fill.style.transform=`translate3d(${(-currentX*68).toFixed(2)}px,${(-currentY*42).toFixed(2)}px,0)`;rim.style.transform=`translate3d(${(currentX*30).toFixed(2)}px,${(-currentY*24).toFixed(2)}px,0)`;}
    let moving=Math.abs(targetX-currentX)+Math.abs(targetY-currentY)>.004;
    for(const entry of active){
      const x=point.x-entry.rect.left,y=point.y-entry.rect.top;
      entry.x+=(x-entry.x)*localAmount;entry.y+=(y-entry.y)*localAmount;
      entry.light.style.transform=`translate3d(${(entry.x-32).toFixed(2)}px,${(entry.y-32).toFixed(2)}px,0)`;
      if(!entry.shown){entry.shown=true;entry.light.style.opacity='1';}
      if(entry.element.matches('button,a.button')){entry.element.style.setProperty('--cast-x',((.5-entry.x/entry.rect.width)*3).toFixed(2)+'px');entry.element.style.setProperty('--cast-y',(2+(.5-entry.y/entry.rect.height)*2).toFixed(2)+'px');}
      moving ||= Math.abs(x-entry.x)+Math.abs(y-entry.y)>.25;
    }
    if(moving)pending=requestAnimationFrame(renderLighting);else lastTime=0;
  }
  document.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'||reduce.matches||!fine.matches||state.layout!=='glass'||!(event.target instanceof Element))return;
    point={x:event.clientX,y:event.clientY};
    setLocalTargets(event.target,point.x,point.y);
    if(!pending)pending=requestAnimationFrame(renderLighting);
  },{passive:true});
  document.documentElement.addEventListener('pointerleave',()=>{clearLocal();if(reduce.matches||!fine.matches||state.layout!=='glass'){clearLighting();return;}point={x:innerWidth/2,y:innerHeight/2};if(!pending)pending=requestAnimationFrame(renderLighting);});
  document.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')clearLighting();},{passive:true});
  document.addEventListener('pointercancel',clearLighting);window.addEventListener('blur',clearLighting);
  window.addEventListener('resize',clearLighting);window.addEventListener('scroll',clearLocal,{passive:true});
  document.addEventListener('toggle',clearLocal,true);
  reduce.addEventListener('change',clearLighting);fine.addEventListener('change',clearLighting);
})();
