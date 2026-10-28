import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TodoStore } from '../lib/db.ts';
import { environmentSettings, saveEnvironment, farmWeather } from '../lib/weather.ts';
import { environmentState } from '../../assets/web/farm-environment.js';

test('environment city and preview preferences persist across SQLite reopen',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'agent-farm-weather-'));
  let store=new TodoStore(join(directory,'test.sqlite'));
  try {
    assert.equal(environmentSettings(store).city,'济南');
    await saveEnvironment(store,{city:'济南',timeMode:'night',weatherMode:'rain'});
    store.close();store=new TodoStore(join(directory,'test.sqlite'));
    assert.equal(environmentSettings(store).timeMode,'night');
    assert.equal(environmentSettings(store).weatherMode,'rain');
    await assert.rejects(saveEnvironment(store,{city:'济南',timeMode:'invalid',weatherMode:'rain'}));
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test('weather cache avoids repeated requests and marks stale/offline data honestly',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'agent-farm-weather-'));
  const store=new TodoStore(join(directory,'test.sqlite'));
  let calls=0;
  const response=async()=>{calls++;return new Response(JSON.stringify({current:{weather_code:0,temperature_2m:17,cloud_cover:0},daily:{sunrise:['2026-10-28T06:31'],sunset:['2026-10-28T17:19']}}));};
  try {
    const first=await farmWeather(store,response);
    const second=await farmWeather(store,response);
    assert.equal(calls,1);assert.equal(second.available,true);assert.equal(second.stale,false);
    store.setSetting('farm-weather-cache',{...first,fetchedAt:Date.now()-20*60*1000});
    const unavailable=async()=>{throw new Error('offline');};
    const stale=await farmWeather(store,unavailable);
    assert.equal(stale.stale,true);assert.equal(stale.current.temperature_2m,17);
    store.setSetting('farm-environment',{...environmentSettings(store),latitude:40});
    const newCity=await farmWeather(store,unavailable);
    assert.equal(newCity.available,false);assert.equal(newCity.current,undefined);
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test('environment follows city timezone and distinguishes automatic from preview weather',()=>{
  const snapshot={settings:{timezone:'Asia/Shanghai',timeMode:'auto',weatherMode:'auto'},sunrise:'2026-10-28T06:31',sunset:'2026-10-28T17:19',current:{weather_code:61,cloud_cover:90}};
  assert.equal(environmentState(snapshot,new Date('2026-10-28T04:00:00Z')).daylight,1);
  assert.equal(environmentState(snapshot,new Date('2026-10-28T15:00:00Z')).daylight,0);
  assert.equal(environmentState(snapshot).rain,true);
  const preview=environmentState({...snapshot,settings:{...snapshot.settings,timeMode:'day',weatherMode:'snow'}},new Date('2026-10-28T15:00:00Z'));
  assert.equal(preview.daylight,1);assert.equal(preview.snow,true);assert.equal(preview.rain,false);
});
