import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatBehavior } from '../../assets/web/farm-cat-behavior.js';
import * as THREE from '../../assets/web/vendor/three.module.js';
import { applyCatHeadYaw } from '../../assets/web/farm-cat.js';

test('head attention stays within six degrees and never accumulates across frames',()=>{
  const head=new THREE.Bone();
  const animated=new THREE.Quaternion().setFromEuler(new THREE.Euler(.3,.1,-.2));
  const parentInverse=new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,.4,.1)).invert();
  const correction=new THREE.Quaternion(),axis=new THREE.Vector3();
  for(let frame=0;frame<2000;frame++){
    applyCatHeadYaw(head,animated,frame<1000?3:-3,parentInverse,correction,axis);
    assert(head.quaternion.angleTo(animated)<=.100001);
  }
  applyCatHeadYaw(head,animated,0,parentInverse,correction,axis);
  assert(head.quaternion.angleTo(animated)<1e-7);
});

test('cat feeds once at a half-hour boundary, wanders and sleeps',()=>{
  const start=new Date('2026-10-30T10:29:59+08:00').getTime(), meals=[];
  const b=createCatBehavior({now:start,random:()=>.5,onMeal:s=>meals.push(s)});
  const tick=(now,position,delta=1)=>b.tick({now,position,delta});
  assert.equal(tick(start,b.bed).state,'sleep');
  assert.equal(tick(start+1000,b.bed).state,'toFood');
  assert.equal(tick(start+2000,b.bowl).state,'eat');
  const roaming=tick(start+25000,b.bowl,23);
  assert.equal(roaming.state,'afterMeal');
  assert.equal(tick(start+35000,roaming.target,10).state,'sleep');
  assert.equal(meals.length,1);
  tick(start+1801000,b.bed,1);assert.equal(meals.length,2);
});

test('cat runs to celebrate, watches, follows and sleeps beside chair',()=>{
  const b=createCatBehavior({now:0,random:()=>.5});
  const tick=(phase,position,delta=1)=>b.tick({now:1000,delta,position,farmerPhase:phase,farmer:{x:4,z:-2}});
  const run=tick('roadside',b.bed);assert.equal(run.clip,'Run');assert(run.moving);
  const watching=tick('dancing',run.target);assert.equal(watching.clip,'TailWag');assert(watching.watching);
  assert.equal(tick('returning',run.target).state,'follow');
  assert.equal(tick('resting',run.target).state,'toBed');
  assert.equal(tick('resting',b.bed).state,'sleep');
});

test('random action starts at five minutes and feeding has priority',()=>{
  const b=createCatBehavior({now:0,random:()=>0});
  assert.equal(b.tick({now:300000,delta:1,position:b.bed}).state,'random');
  assert.equal(b.tick({now:1800000,delta:1,position:b.bed,farmerPhase:'dancing',farmer:{x:0,z:0}}).state,'toFood');
});

test('optimized cat contains required skeletal clips within the mesh budget',async()=>{
  const data=await readFile(new URL('../../assets/web/models/cat-animated.glb',import.meta.url));
  const gltf=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
  const names=gltf.animations.map(a=>a.name);
  for(const name of ['Idle','Walk','Run','Sit','Sleep','Alert','Eat','TailWag','LookAround','Stretch','Groom'])assert(names.includes('Cat_'+name));
  assert.equal(names.length,11);
  assert(gltf.skins[0].joints.length>=41);
  const triangles=gltf.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+gltf.accessors[p.indices].count/3,0);
  assert(triangles<60000);assert(data.length<8*1024*1024);
});

test('first click looks up, second click runs away and arrival resumes idle',()=>{
  const b=createCatBehavior({now:0,random:()=>.5}),position={...b.bed},camera={x:18,z:26};
  assert.equal(b.interact({now:1000,position,camera}),'meow');
  let result=b.tick({now:1000,delta:.1,position,farmerPhase:'dancing'});
  assert.equal(result.state,'alert');assert.equal(result.clip,'Alert');assert.equal(result.moving,false);
  assert.equal(b.interact({now:2000,position,camera}),'run');
  result=b.tick({now:2000,delta:.1,position});
  assert.equal(result.state,'flee');assert.equal(result.clip,'Run');assert(result.moving);
  assert(Math.hypot(result.target.x-position.x,result.target.z-position.z)>=1.5);
  assert.equal(b.interact({now:2200,position,camera}),'running');
  assert.equal(b.tick({now:3000,delta:1,position:result.target}).state,'idle');
});

test('unanswered attention settles back down and defers a meal without losing it',()=>{
  const b=createCatBehavior({now:1799000}),position={...b.bed},camera={x:18,z:26};
  b.interact({now:1799000,position,camera});
  assert.equal(b.tick({now:1800000,delta:1,position}).state,'alert');
  assert.equal(b.tick({now:1809000,delta:9,position}).state,'sleep');
  assert.equal(b.tick({now:1810000,delta:1,position}).state,'toFood');
});
