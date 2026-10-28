import * as THREE from './vendor/three.module.js';

export function environmentState(snapshot={}, date=new Date()) {
  const settings=snapshot.settings || {};
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:settings.timezone || 'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  let hour=Number(parts.find(p=>p.type==='hour').value)+Number(parts.find(p=>p.type==='minute').value)/60;
  const solar=value=>value ? Number(value.slice(11,13))+Number(value.slice(14,16))/60 : null;
  const rise=solar(snapshot.sunrise) ?? 6, set=solar(snapshot.sunset) ?? 18;
  if(settings.timeMode==='day') hour=(rise+set)/2;
  if(settings.timeMode==='sunset') hour=set-0.15;
  if(settings.timeMode==='night') hour=23;
  const daylight=THREE.MathUtils.smoothstep(hour,rise-0.5,rise+0.5)*(1-THREE.MathUtils.smoothstep(hour,set-0.5,set+0.5));
  const twilight=Math.max(0,1-Math.min(Math.abs(hour-rise),Math.abs(hour-set))/1.2);
  const code=({clear:0,cloudy:3,rain:61,snow:71})[settings.weatherMode] ?? snapshot.current?.weather_code ?? 0;
  const snow=[71,73,75,77,85,86].includes(code), rain=(code>=51 && code<=67)||(code>=80 && code<=82)||code>=95;
  const clouds=settings.weatherMode==='auto' || !settings.weatherMode ? (snapshot.current?.cloud_cover ?? 25)/100 : code===0 ? 0.1 : 0.9;
  return {hour,rise,set,daylight,twilight,code,snow,rain,clouds,progress:THREE.MathUtils.clamp((hour-rise)/(set-rise),0,1),description:snow?'雪':rain?'雨':code===45||code===48?'雾':clouds>0.65?'阴':clouds>0.2?'多云':'晴'};
}

function cloudTexture() {
  const canvas=document.createElement('canvas'); canvas.width=512;canvas.height=256;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';
  for(const [x,y,r] of [[105,151,55],[176,118,76],[254,100,84],[330,133,70],[390,158,48]]) {ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  ctx.fillRect(100,145,290,55);
  return new THREE.CanvasTexture(canvas);
}

function glowTexture() {
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(128,128,0,128,128,128);
  gradient.addColorStop(0,'rgba(255,250,212,1)');gradient.addColorStop(.42,'rgba(255,237,166,1)');gradient.addColorStop(.48,'rgba(255,228,133,.45)');gradient.addColorStop(1,'rgba(255,228,133,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);return new THREE.CanvasTexture(canvas);
}

export function createFarmEnvironment({scene,camera,sun,hemi,renderer,onWeather}) {
  const root=new THREE.Group();root.name='FarmLandscape';scene.add(root);
  const grassCanvas=document.createElement('canvas');grassCanvas.width=128;grassCanvas.height=128;
  const grassContext=grassCanvas.getContext('2d');grassContext.fillStyle='#80af51';grassContext.fillRect(0,0,128,128);
  for(let i=0;i<400;i++) {const x=Math.random()*128,y=Math.random()*128;grassContext.strokeStyle=i%2?'rgba(196,222,127,.15)':'rgba(46,99,44,.12)';grassContext.beginPath();grassContext.moveTo(x,y);grassContext.lineTo(x+1,y-3-Math.random()*3);grassContext.stroke();}
  const grassMap=new THREE.CanvasTexture(grassCanvas);grassMap.colorSpace=THREE.SRGBColorSpace;grassMap.wrapS=grassMap.wrapT=THREE.RepeatWrapping;grassMap.repeat.set(500,500);grassMap.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const groundMaterial=new THREE.MeshStandardMaterial({color:0xffffff,map:grassMap,roughness:1});
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(900,900),groundMaterial);
  ground.rotation.x=-Math.PI/2;ground.rotation.z=Math.atan2(18.5,26.5);
  const normal=new THREE.Vector3(18.5,0,26.5).normalize();
  ground.position.copy(normal.clone().multiplyScalar(412));ground.position.y=-0.32;ground.receiveShadow=true;root.add(ground);
  // Blend the original model's edge into the surrounding meadow instead of showing a floating slab.
  const inner=[[-12.6,-8.6],[12.6,-8.6],[12.6,8.6],[-12.6,8.6]],outer=[[-15,-11],[15,-11],[15,11],[-15,11]],vertices=[];
  for(let i=0;i<4;i++) {const j=(i+1)%4; for(const [point,y] of [[inner[i],.015],[outer[i],-.32],[inner[j],.015],[inner[j],.015],[outer[i],-.32],[outer[j],-.32]]) vertices.push(point[0],y,point[1]);}
  const skirtGeometry=new THREE.BufferGeometry();skirtGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));skirtGeometry.computeVertexNormals();
  const skirt=new THREE.Mesh(skirtGeometry,new THREE.MeshStandardMaterial({color:0x75a84b,roughness:1,side:THREE.DoubleSide}));skirt.receiveShadow=true;root.add(skirt);
  const lateral=new THREE.Vector3(normal.z,0,-normal.x);
  for(let i=0;i<13;i++) {
    const hill=new THREE.Mesh(new THREE.IcosahedronGeometry(1,2),new THREE.MeshStandardMaterial({color:i%2?0x82b161:0x719e58,roughness:1}));
    hill.position.copy(normal.clone().multiplyScalar(-38-i%3*2)).addScaledVector(lateral,(i-6)*12);hill.position.y=-1;
    hill.scale.set(10+i%4*2,3+i%3,8);root.add(hill);
  }
  const celestialTexture=glowTexture();
  const solar=new THREE.Sprite(new THREE.SpriteMaterial({map:celestialTexture,transparent:true,depthWrite:false,fog:false,toneMapped:false}));solar.scale.set(2.8,2.8,1);root.add(solar);
  const sunAnchor=new THREE.Vector3(5.6,7.2,-4.8);
  const moon=new THREE.Sprite(new THREE.SpriteMaterial({map:celestialTexture,color:0xc6deff,transparent:true,depthWrite:false,fog:false,toneMapped:false}));moon.scale.set(7,7,1);root.add(moon);
  const porch=new THREE.PointLight(0xffc47a,0,10,2);porch.position.set(5.6,2,-2.7);root.add(porch);
  const stallLamp=new THREE.PointLight(0xffcd90,0,8,2);stallLamp.position.set(-7.5,2,-3.4);root.add(stallLamp);
  const cloudMap=cloudTexture(),clouds=[];
  for(let i=0;i<9;i++) {const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:cloudMap,transparent:true,depthWrite:false,fog:false}));sprite.scale.set(20+i%3*5,10+i%3*2.5,1);root.add(sprite);clouds.push(sprite);}
  const particles=new Float32Array(600*3);
  for(let i=0;i<particles.length;i+=3) {particles[i]=(Math.random()-.5)*40;particles[i+1]=Math.random()*22;particles[i+2]=(Math.random()-.5)*30;}
  const precipitationGeometry=new THREE.BufferGeometry();precipitationGeometry.setAttribute('position',new THREE.BufferAttribute(particles,3));
  const precipitation=new THREE.Points(precipitationGeometry,new THREE.PointsMaterial({color:0xd4e8ff,size:.07,transparent:true,opacity:.65,depthWrite:false}));root.add(precipitation);
  const starPositions=[];for(let i=0;i<120;i++) starPositions.push((Math.random()-.5)*140,20+Math.random()*38,-150);
  const stars=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3)),new THREE.PointsMaterial({color:0xffffff,size:.22,transparent:true,opacity:.7,fog:false}));root.add(stars);
  const skyTop=new THREE.Color(),skyHorizon=new THREE.Color();
  const sky=new THREE.Mesh(new THREE.SphereGeometry(280,24,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:skyTop},horizon:{value:skyHorizon}},vertexShader:'varying vec3 world; void main(){world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}',fragmentShader:'uniform vec3 top;uniform vec3 horizon;varying vec3 world;void main(){float h=normalize(world-cameraPosition).y;gl_FragColor=vec4(mix(horizon,top,smoothstep(-.35,.25,h)),1.);\n#include <colorspace_fragment>\n}'}));root.add(sky);
  let snapshot={},visual=environmentState(),elapsed=0,stamp=-Infinity,disposed=false;
  const abort=new AbortController();
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  function positionInSky(object,x,y,distance) {object.position.set(x,y,.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(distance).add(camera.position);}
  function setWeather(next) {snapshot=next;stamp=-Infinity;onWeather?.({...next,description:environmentState(next).description});}
  async function refresh() {
    try {const response=await fetch('/api/farm/weather',{signal:abort.signal});const next=await response.json();if(!response.ok||!next.ok)throw new Error(next.error || '天气同步失败');if(!disposed)setWeather(next);}
    catch(error){if(!disposed)onWeather?.({...snapshot,stale:true,error:error.message});}
  }
  const timer=window.setInterval(refresh,15*60*1000);void refresh();
  function tick(delta) {
    elapsed+=delta;
    if(elapsed-stamp>30) {
      stamp=elapsed;visual=environmentState(snapshot);
      const day=visual.daylight,overcast=visual.clouds;
      skyTop.set(0x10203d).lerp(new THREE.Color(0x76bde9),day).lerp(new THREE.Color(0xdca075),visual.twilight*.6);
      skyHorizon.set(0x29374f).lerp(new THREE.Color(0xd5edf2),day).lerp(new THREE.Color(0xf5bf91),visual.twilight*.6);
      if(visual.rain||visual.snow){skyTop.lerp(new THREE.Color(0x8fa1ac),.65);skyHorizon.lerp(new THREE.Color(0xbac8cb),.65);}
      scene.background.copy(skyHorizon);scene.fog.color.copy(skyHorizon);
      const mist=visual.code===45||visual.code===48;
      scene.fog.near=mist ? 20 : visual.rain||visual.snow ? 45 : 65;
      scene.fog.far=mist ? 75 : visual.rain||visual.snow ? 120 : 180;
      sun.intensity=(.35+day*1.4)*(1-overcast*.55);hemi.intensity=.65+day*.5;
      sun.color.set(day<.2 ? 0xa7c8f0 : visual.twilight>.2 ? 0xffc48b : 0xfff1cf);
      porch.intensity=(1-day)*13;stallLamp.intensity=(1-day)*9;
      sun.position.set(-25+visual.progress*50,8+Math.sin(visual.progress*Math.PI)*22,18);
      renderer.toneMappingExposure=.7+day*.08;
      solar.visible=day>.1&&!visual.rain&&!visual.snow;solar.material.opacity=(1-overcast*.7)*day;solar.material.color.set(visual.twilight>.2 ? 0xffad69 : 0xffdf74);
      moon.visible=day<.3;stars.visible=day<.2;
      precipitation.visible=visual.rain||visual.snow;precipitation.material.size=visual.snow ? .11 : .045;
      precipitation.material.color.set(visual.snow ? 0xffffff : 0xc8def1);
      clouds.forEach((cloud,i)=>{cloud.material.color.set(day>.3 ? visual.rain ? 0x89979f : 0xffffff : 0x627085);cloud.material.opacity=.5+overcast*.4;cloud.visible=i<3+Math.round(overcast*6);});
    }
    solar.position.copy(sunAnchor);
    positionInSky(moon,.65,.85,90);
    stars.position.copy(camera.position);stars.quaternion.copy(camera.quaternion);
    clouds.forEach((cloud,i)=>{const speed=reduced.matches ? 0 : elapsed*(.0008+(snapshot.current?.wind_speed_10m || 5)*.000035);positionInSky(cloud,((i*.7+speed+.3)%2.4)-.9,.8+(i%3)*.06,115+i%3*3);});
    if(precipitation.visible&&!reduced.matches) {for(let i=0;i<particles.length;i+=3){particles[i+1]-=delta*(visual.snow?1.2:12);if(particles[i+1]<0)particles[i+1]=22;}precipitationGeometry.attributes.position.needsUpdate=true;}
  }
  function dispose() {
    disposed=true;abort.abort();window.clearInterval(timer);root.removeFromParent();
    const geometries=new Set(),materials=new Set(),textures=new Set();
    root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of (Array.isArray(object.material)?object.material:[object.material]).filter(Boolean)){materials.add(material);if(material.map)textures.add(material.map);}});
    geometries.forEach(item=>item.dispose());materials.forEach(item=>item.dispose());textures.forEach(item=>item.dispose());
  }
  return {tick,refresh,setWeather,dispose,setSunAnchor:position=>sunAnchor.copy(position),groundSurfaces:[ground,skirt]};
}
