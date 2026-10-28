import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

export function quotaWindow(quota, minutes) {
  const window=[quota?.primary,quota?.secondary].find(w=>Number(w?.windowDurationMins)===minutes);
  if (!window || window.usedPercent == null || !Number.isFinite(Number(window.usedPercent))) return null;
  return {...window,remaining:Math.max(0,Math.min(100,100-Number(window.usedPercent)))};
}

export function createQuotaTower({scene,container,camera}) {
  const root=new THREE.Group();root.position.set(9.3,0.08,-4.6);scene.add(root);
  let disposed=false;
  const release=object=>object.traverse(o=>{o.geometry?.dispose();for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean))m.dispose();});
  new GLTFLoader().load('/models/quota-water-tower.glb',gltf=>{
    if(disposed){release(gltf.scene);return;}
    gltf.scene.traverse(o=>{if(o.isMesh)o.castShadow=true;});root.add(gltf.scene);
  },undefined,error=>console.error('额度水塔加载失败',error));
  const tank=new THREE.Mesh(new THREE.CylinderGeometry(.76,.76,1.7,32,1,true),new THREE.MeshPhysicalMaterial({color:0xc5f7ed,transparent:true,opacity:.23,roughness:.2,side:THREE.DoubleSide,depthWrite:false}));
  tank.position.y=2.45;root.add(tank);
  const water=new THREE.Mesh(new THREE.CylinderGeometry(.71,.71,1,32),new THREE.MeshStandardMaterial({color:0x2bbda6,roughness:.24,transparent:true,opacity:.85}));root.add(water);
  const label=document.createElement('button');label.type='button';
  label.style.cssText='position:absolute;z-index:4;transform:translate(-50%,-50%);border:0;background:transparent;width:44px;height:32px;padding:0;cursor:help;pointer-events:auto';
  const heading=document.createElement('div');heading.textContent='Codex · 5 小时';heading.style.fontSize='10px';
  const value=document.createElement('strong');value.style.cssText='display:block;font-size:19px;line-height:24px';
  const weekText=document.createElement('div');weekText.style.fontSize='10px';
  const track=document.createElement('div');track.style.cssText='height:4px;background:#ded8c6;border-radius:4px;margin-top:4px;overflow:hidden';
  const fill=document.createElement('div');fill.style.cssText='height:100%;transition:width .6s';track.append(fill);
  container.append(label);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const context=canvas.getContext('2d'),texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const lettering=new THREE.Mesh(new THREE.CylinderGeometry(.785,.785,.58,48,1,true,-.9,1.8),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.FrontSide,polygonOffset:true,polygonOffsetFactor:-1}));
  lettering.position.y=2.48;lettering.renderOrder=2;root.add(lettering);
  let quota={},target=0,level=0,lastTip=0;
  const color=p=>p<10?'#e77c34':p<30?'#d5ac35':'#2bbda6';
  function resetText(w){
    if(!w)return '暂未获取';
    if(!w.resetsAt)return '重置时间未知';
    const seconds=Math.max(0,Math.ceil(Number(w.resetsAt)-Date.now()/1000));
    return seconds===0?'等待额度更新':`${Math.floor(seconds/3600)} 小时 ${Math.ceil(seconds%3600/60)} 分钟后重置`;
  }
  function update(next={}) {
    quota=next;const short=quotaWindow(quota,300),week=quotaWindow(quota,10080);
    const main=short||week;
    heading.textContent=short?'Codex · 5 小时':'Codex · 本周额度';
    target=main?main.remaining/100:0;water.visible=!!main&&target>0;
    value.textContent=main?`剩余 ${Math.round(main.remaining)}%`:'额度未知';
    context.clearRect(0,0,512,256);context.fillStyle='#fffdf0';context.font='bold 174px Arial';context.textAlign='center';context.textBaseline='middle';context.fillText(main?`${Math.round(main.remaining)}%`:'—',256,128);texture.needsUpdate=true;
    weekText.textContent=short?(week?`本周剩余 ${Math.round(week.remaining)}%`:'本周额度未知'):'未提供 5 小时额度';
    fill.style.width=`${week?.remaining||0}%`;fill.style.background=color(week?.remaining??100);
    water.material.color.set(color(main?.remaining??100));lastTip=0;
  }
  const point=new THREE.Vector3();
  function tick(delta) {
    level+=(target-level)*Math.min(1,delta*4);water.scale.y=Math.max(.001,1.58*level);water.position.y=1.61+water.scale.y/2;
    lettering.rotation.y=Math.atan2(camera.position.x-root.position.x,camera.position.z-root.position.z);
    point.set(Math.sin(lettering.rotation.y)*.8,2.48,Math.cos(lettering.rotation.y)*.8);root.localToWorld(point);point.project(camera);
    label.hidden=point.z>1||point.z< -1;
    label.style.left=`${(point.x+1)*container.clientWidth/2}px`;label.style.top=`${(1-point.y)*container.clientHeight/2}px`;
    if(Date.now()-lastTip>30000){lastTip=Date.now();label.title=`5 小时：${resetText(quotaWindow(quota,300))}\n本周：${resetText(quotaWindow(quota,10080))}`;label.setAttribute('aria-label',`${value.textContent}，${weekText.textContent}。${label.title}`);}
  }
  update();
  return {update,tick,dispose(){disposed=true;label.remove();texture.dispose();root.removeFromParent();release(root);}};
}
