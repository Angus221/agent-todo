import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../assets/web/vendor/three.module.js';
import { GLTFLoader } from '../../assets/web/vendor/GLTFLoader.js';
import { stabilizeCharacterMotion, groundCharacterFeet, sortFieldSlots, groundLabelTransform } from '../../assets/web/farm3d.js';

test('plots number from front-right to back before moving one column left',()=>{
  const slots=[];
  for(const x of [-1,0,1,2]) for(const z of [0,1,2]) {
    const slot=new THREE.Group(); slot.position.set(x,0,z); slots.push(slot);
  }
  const ordered=sortFieldSlots(slots.reverse());
  assert.deepEqual(ordered.slice(0,6).map(slot=>[slot.position.x,slot.position.z]),[[2,2],[2,1],[2,0],[1,2],[1,1],[1,0]]);
});

test('ground title corners follow the same perspective plane as soil',()=>{
  const camera=new THREE.PerspectiveCamera(38,1280/720,0.1,120);
  camera.position.set(18.5,19.5,24.5); camera.lookAt(0,0.8,0.2); camera.updateMatrixWorld(true);
  const center=new THREE.Vector3(1,0.7,1);
  const transform=new THREE.Matrix4().fromArray(groundLabelTransform(camera,center,110,21,1280,720));
  for(const [x,y] of [[0,0],[110,0],[0,21],[110,21],[55,10.5]]) {
    const css=new THREE.Vector4(x,y,0,1).applyMatrix4(transform);
    const world=new THREE.Vector3(center.x-0.56+x/110*1.12,center.y,center.z-0.13+y/21*0.26).project(camera);
    assert(Math.abs(css.x/css.w-(world.x+1)*640)<1e-6);
    assert(Math.abs(css.y/css.w-(1-world.y)*360)<1e-6);
  }
});

// Keep the actual skeleton and animation buffers, but omit rendering resources.
// This exercises the shipped clips and Three.js mixer without a browser/GPU.
async function loadRig() {
  const source = await readFile(new URL('../../assets/web/models/character-animated.glb', import.meta.url));
  const jsonLength = source.readUInt32LE(12);
  const data = JSON.parse(source.subarray(20,20+jsonLength).toString());
  for(const node of data.nodes) { delete node.mesh; delete node.skin; }
  delete data.meshes; delete data.materials; delete data.textures; delete data.images;
  delete data.extensionsUsed; delete data.extensionsRequired;
  const json=Buffer.from(JSON.stringify(data));
  const padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);
  json.copy(padded);
  const binary=source.subarray(20+jsonLength);
  const buffer=Buffer.alloc(20+padded.length+binary.length);
  buffer.writeUInt32LE(0x46546c67,0); buffer.writeUInt32LE(2,4);
  buffer.writeUInt32LE(buffer.length,8); buffer.writeUInt32LE(padded.length,12);
  buffer.writeUInt32LE(0x4e4f534a,16); padded.copy(buffer,20);
  binary.copy(buffer,20+padded.length);
  return new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
}

test('native Hip locomotion is cancelled through walk loops and pose crossfades', async () => {
  const gltf=await loadRig();
  const actor=new THREE.Group();
  const anchor=new THREE.Group();
  gltf.scene.scale.setScalar(1.8);
  gltf.scene.rotation.y=-Math.PI/2;
  anchor.add(gltf.scene); actor.add(anchor);
  const hip=gltf.scene.getObjectByName('Hip');
  const feet=['L_Foot','R_Foot','L_ToeBase','R_ToeBase'].map(name=>gltf.scene.getObjectByName(name));
  assert(hip);
  const mixer=new THREE.AnimationMixer(actor);
  const scratch=new THREE.Vector3();
  const world=new THREE.Vector3();
  const walk=gltf.animations.find(clip=>clip.name==='walk');
  const action=mixer.clipAction(walk,actor).play();
  let rawMin=Infinity, rawMax=-Infinity;
  for(let frame=0;frame<180;frame++) {
    mixer.update(1/60); actor.updateMatrixWorld(true);
    hip.getWorldPosition(world); rawMin=Math.min(rawMin,world.z); rawMax=Math.max(rawMax,world.z);
  }
  assert(rawMax-rawMin>1,'fixture must reproduce the visible root-motion bug');
  mixer.stopAllAction();
  let previousAction=action;
  const stages=['walk','dig','walk','dance_05','sit'];
  let previousWorld=null;
  for(const [stage,name] of stages.entries()) {
    const next=mixer.clipAction(gltf.animations.find(clip=>clip.name===name),actor);
    previousAction.fadeOut(0.2); next.reset().fadeIn(0.2).play(); previousAction=next;
    for(let frame=0;frame<360;frame++) {
      actor.position.z=stage*8.1+frame/60*1.35;
      actor.rotation.y=stage===2 ? Math.PI : 0;
      mixer.update(1/60);
      stabilizeCharacterMotion(actor,anchor,hip,scratch);
      const surface=[0.18,0.36,0.66][Math.floor(frame/60)%3];
      if(name==='walk' || name==='dance_05') groundCharacterFeet(actor,anchor,feet,surface,scratch);
      actor.updateMatrixWorld(true); hip.getWorldPosition(world);
      if(name==='walk' || name==='dance_05') {
        const lowest=Math.min(...feet.map(foot=>foot.getWorldPosition(new THREE.Vector3()).y));
        assert(Math.abs(lowest-surface-0.055)<1e-5,`${name}: shoe sole left the ground`);
      }
      assert(Math.hypot(world.x-actor.position.x,world.z-actor.position.z)<1e-5,`${name}: actor left its route`);
      if(previousWorld) assert(Math.hypot(world.x-previousWorld.x,world.z-previousWorld.z)<0.023,`${name}: visible jump at loop/transition`);
      previousWorld=world.clone();
    }
  }
});
