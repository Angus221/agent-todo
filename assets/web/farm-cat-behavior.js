// Independent of rendering so clock boundaries and priorities can be tested.
export function createCatBehavior({ now = Date.now(), random = Math.random, lastMeal = null, onMeal = () => {} } = {}) {
  const bowl = { x: 4.6, z: -4.7 }, bed = { x: 1.8, z: -3.6 };
  let state = 'sleep', elapsed = 0, target = { ...bed }, clip = 'Sleep';
  let previousPhase = 'resting', nextRandom = now + 300000, mealUntil = 0;
  let currentMeal = lastMeal ?? Math.floor(now / 1800000);
  let celebrating = false;
  function enter(next, animation, point = target) { state = next; clip = animation; target = { ...point }; elapsed = 0; }
  const roam = () => ({ x: -6 + random() * 11, z: -2.9 + random() * 1.3 });
  function interact({ now, position, camera }) {
    if(state==='flee')return 'running';
    celebrating=false;mealUntil=0;nextRandom=now+300000;
    if(state==='alert') {
      const dx=position.x-camera.x,dz=position.z-camera.z,distance=Math.hypot(dx,dz)||1;
      const point={x:Math.max(-8,Math.min(8,position.x+dx/distance*3)),z:Math.max(-3,Math.min(5,position.z+dz/distance*3))};
      if(Math.hypot(point.x-position.x,point.z-position.z)<1.5)point.x=position.x>0?position.x-3:position.x+3;
      enter('flee','Run',point);return 'run';
    }
    enter('alert','Alert',position);return 'meow';
  }
  function tick({ delta, now, position, farmerPhase = 'resting', farmer = bed }) {
    elapsed += delta;
    const interacting=state==='alert'||state==='flee';
    const slot = Math.floor(now / 1800000);
    if (slot > currentMeal && !interacting) {
      currentMeal = slot; onMeal(slot); mealUntil = now + 180000;
      celebrating = false; enter('toFood', 'Walk', bowl);
    }
    const atTarget = () => Math.hypot(position.x - target.x, position.z - target.z) < .08;
    if (mealUntil && now > mealUntil) mealUntil = 0;
    if (!interacting && !mealUntil && ['roadside', 'dancing'].includes(farmerPhase) && !['roadside', 'dancing'].includes(previousPhase)) {
      celebrating = true; enter('toFarmer', 'Run', { x: farmer.x + .9, z: farmer.z + .6 });
    }
    previousPhase = farmerPhase;
    if (celebrating) {
      if (['returning', 'sitting', 'resting'].includes(farmerPhase)) {
        if (farmerPhase === 'returning') { target = { x: farmer.x + .8, z: farmer.z + .5 }; state = 'follow'; clip = atTarget() ? 'TailWag' : 'Walk'; }
        else if (state !== 'toBed') enter('toBed', 'Walk', bed);
      } else if (['roadside', 'dancing'].includes(farmerPhase)) {
        target = { x: farmer.x + .9, z: farmer.z + .6 }; state = 'toFarmer'; clip = atTarget() ? 'TailWag' : 'Run';
      } else { celebrating = false; enter('roam', 'Walk', roam()); }
    }
    const arrived=atTarget();
    if(state==='alert' && elapsed>8)enter('sleep','Sleep',position);
    else if(state==='flee' && arrived)enter('idle','LookAround');
    else if (state === 'toFood' && arrived) enter('eat', 'Eat');
    else if (state === 'eat' && elapsed > 20) enter('afterMeal', 'Walk', roam());
    else if (state === 'afterMeal' && arrived) { mealUntil = 0; enter('sleep', 'Sleep'); }
    else if (state === 'toBed' && arrived) { celebrating = false; nextRandom=now+300000; enter('sleep', 'Sleep'); }
    else if (state === 'roam' && arrived) enter('idle', 'LookAround');
    else if (!celebrating && !mealUntil && state === 'sleep' && elapsed > 100) enter('roam', 'Walk', roam());
    else if (state === 'idle' && elapsed > 18) enter('roam', 'Walk', roam());
    else if (state === 'random' && elapsed > 10) enter('roam', 'Walk', roam());
    if (now >= nextRandom && !interacting && !celebrating && !mealUntil) {
      nextRandom = now + 300000;
      const actions = ['Sit', 'LookAround', 'TailWag', 'Stretch', 'Groom'];
      enter('random', actions[Math.floor(random() * actions.length)]);
    }
    const moving = ['flee','toFood','afterMeal','roam','toFarmer','follow','toBed'].includes(state) && !atTarget();
    return { state, clip, target, moving, speed: clip === 'Run' ? 2.4 : 1.0, watching: celebrating && !moving };
  }
  return { tick, interact, bowl, bed };
}
