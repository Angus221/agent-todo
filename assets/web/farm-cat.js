import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { createCatBehavior } from './farm-cat-behavior.js';

export function applyCatHeadYaw(head, animatedRotation, yaw, parentInverse, correction, axis) {
  head.quaternion.copy(animatedRotation);
  axis.set(0,1,0).applyQuaternion(parentInverse);
  correction.setFromAxisAngle(axis,THREE.MathUtils.clamp(yaw,-.1,.1));
  head.quaternion.premultiply(correction);
}

export function createFarmCat(scene, groundMeshes) {
  let lastMeal;
  try { const stored=localStorage.getItem('agent-todo:cat-meal'); if(stored!==null)lastMeal=Number(stored); } catch {}
  const behavior=createCatBehavior({lastMeal:Number.isFinite(lastMeal)?lastMeal:null,onMeal:slot=>{try {localStorage.setItem('agent-todo:cat-meal',String(slot));}catch{}}});
  const root=new THREE.Group(); root.name='FarmSiameseCat';
  root.position.set(behavior.bed.x,.36,behavior.bed.z);scene.add(root);
  const bowl=new THREE.Group(); bowl.position.set(behavior.bowl.x+.45,.36,behavior.bowl.z);scene.add(bowl);
  const dish=new THREE.Mesh(new THREE.CylinderGeometry(.23,.17,.12,24),new THREE.MeshStandardMaterial({color:0xb87548,roughness:.8}));
  dish.position.y=.06;bowl.add(dish);
  const food=new THREE.Mesh(new THREE.CylinderGeometry(.185,.18,.025,24),new THREE.MeshStandardMaterial({color:0x674331}));
  food.position.y=.12;bowl.add(food);
  let mixer, model, current, head, disposed=false, meowTime=0;
  const catMeshes=[];
  const caption=document.createElement('canvas');caption.width=192;caption.height=128;
  const context=caption.getContext('2d');context.font='bold 80px sans-serif';context.textAlign='center';context.textBaseline='middle';
  context.lineWidth=7;context.strokeStyle='#65402c';context.strokeText('喵',96,62);context.fillStyle='#fff8df';context.fillText('喵',96,62);
  const meow=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(caption),transparent:true,depthWrite:false}));
  meow.scale.set(.72,.48,1);meow.visible=false;scene.add(meow);
  const parentRotation=new THREE.Quaternion(),correction=new THREE.Quaternion(),axis=new THREE.Vector3();
  const animatedHeadRotation=new THREE.Quaternion();
  let hasHeadPose=false,headYaw=0;
  const paws=[],pawPosition=new THREE.Vector3();
  const actions=new Map(), ray=new THREE.Raycaster(), origin=new THREE.Vector3(), down=new THREE.Vector3(0,-1,0);
  new GLTFLoader().loadAsync('/models/cat-animated.glb').then(gltf=>{
    if(disposed){ release(gltf.scene); return; }
    model=gltf.scene;model.scale.setScalar(.95);model.rotation.y=-Math.PI/2;root.add(model);
    model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;catMeshes.push(o);}if(o.isBone && /[01]_(Left|Right)_Limb_3$/.test(o.name))paws.push(o);if(o.isBone&&/Head_0$/.test(o.name))head=o;});
    mixer=new THREE.AnimationMixer(model);
    for(const clip of gltf.animations)actions.set(clip.name.replace(/^Cat_/,''),mixer.clipAction(clip));
  }).catch(error=>console.warn('农场猫模型加载失败',error));
  function release(object){object.traverse(o=>{o.geometry?.dispose();for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}});}
  function hitTest(pointerRay){
    if(!model||disposed)return null;
    root.updateMatrixWorld(true);
    for(const mesh of catMeshes)if(mesh.isSkinnedMesh)mesh.computeBoundingSphere();
    return pointerRay.intersectObjects(catMeshes,false)[0]||null;
  }
  function interact(camera){
    if(!mixer||disposed)return;
    const response=behavior.interact({now:Date.now(),position:root.position,camera:camera.position});
    meowTime=response==='meow'?2:0;
  }
  function tick(delta,farmerPhase,farmer,camera){
    if(!mixer||disposed)return;
    const b=behavior.tick({delta,now:Date.now(),position:root.position,farmerPhase,farmer:farmer?.position});
    if(current!==b.clip){const next=actions.get(b.clip);if(next){const previous=actions.get(current);next.reset().fadeIn(.35).play();previous?.fadeOut(.35);current=b.clip;}}
    if(b.moving){
      const dx=b.target.x-root.position.x,dz=b.target.z-root.position.z,distance=Math.hypot(dx,dz);
      const step=Math.min(distance,b.speed*delta);root.position.x+=dx/distance*step;root.position.z+=dz/distance*step;
      const yaw=Math.atan2(dx,dz);root.rotation.y+=Math.atan2(Math.sin(yaw-root.rotation.y),Math.cos(yaw-root.rotation.y))*Math.min(1,delta*10);
    }else if(b.watching&&farmer){root.rotation.y=Math.atan2(farmer.position.x-root.position.x,farmer.position.z-root.position.z);}
    else if(b.state==='eat'){root.rotation.y=Math.PI/2;}
    scene.updateMatrixWorld(true);origin.set(root.position.x,10,root.position.z);ray.set(origin,down);
    const surface=ray.intersectObjects(groundMeshes,false)[0];if(surface)root.position.y=surface.point.y+.015;
    // Mixer bindings may skip unchanged keys. Restore the unmodified animated
    // pose first so the previous frame's attention rotation cannot accumulate.
    if(head&&hasHeadPose)head.quaternion.copy(animatedHeadRotation);
    mixer.update(delta);
    if(head){animatedHeadRotation.copy(head.quaternion);hasHeadPose=true;}
    if(surface&&paws.length){model.position.y=0;root.updateMatrixWorld(true);let lowest=Infinity;for(const paw of paws)lowest=Math.min(lowest,paw.getWorldPosition(pawPosition).y);model.position.y+=surface.point.y+.035-lowest;}
    if(head&&camera){
      root.updateMatrixWorld(true);head.parent.getWorldQuaternion(parentRotation);parentRotation.invert();
      const yaw=Math.atan2(camera.position.x-root.position.x,camera.position.z-root.position.z);
      const turn=b.state==='alert'?THREE.MathUtils.clamp(Math.atan2(Math.sin(yaw-root.rotation.y),Math.cos(yaw-root.rotation.y)),-.1,.1):0;
      headYaw+=(turn-headYaw)*(1-Math.exp(-delta*3));
      applyCatHeadYaw(head,animatedHeadRotation,headYaw,parentRotation,correction,axis);
    }
    meowTime=Math.max(0,meowTime-delta);meow.visible=meowTime>0;
    if(meow.visible){root.updateMatrixWorld(true);if(head)head.getWorldPosition(meow.position);else meow.position.copy(root.position);meow.position.y+=.5+(2-meowTime)*.08;meow.material.opacity=Math.min(1,meowTime*3);}
    origin.set(bowl.position.x,10,bowl.position.z);ray.set(origin,down);
    const bowlSurface=ray.intersectObjects(groundMeshes,false)[0];if(bowlSurface)bowl.position.y=bowlSurface.point.y;
  }
  return { tick, hitTest, interact, dispose(){disposed=true;mixer?.stopAllAction();if(model)mixer?.uncacheRoot(model);release(root);release(bowl);release(meow);root.removeFromParent();bowl.removeFromParent();meow.removeFromParent();} };
}
