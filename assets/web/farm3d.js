import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const SLOT_PREFIXES = ['Cell_Scheduled_', 'Cell_Active_', 'Cell_Done_', 'InboxSlot_'];

export function stabilizeCharacterMotion(character, motionAnchor, hipBone, scratch) {
  motionAnchor.position.set(0,0,0);
  character.updateMatrixWorld(true);
  hipBone.getWorldPosition(scratch);
  character.worldToLocal(scratch);
  motionAnchor.position.set(-scratch.x,0,-scratch.z);
}

export function groundCharacterFeet(character, motionAnchor, feet, surfaceY, scratch) {
  character.updateMatrixWorld(true);
  let lowest=Infinity;
  for(const foot of feet) {foot.getWorldPosition(scratch); lowest=Math.min(lowest,scratch.y);}
  // The ankle/toe bones are 0.055 world units above the shoe sole.
  if(Number.isFinite(lowest)) motionAnchor.position.y+=surfaceY+0.055-lowest;
}

function naturalSort(items) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function statusKind(statuses, statusId) {
  const value = String(statusId || '').toLowerCase();
  const status = (statuses || []).find(item => item.id === statusId);
  const semantic = String(status?.kind || status?.semantic || status?.type || '').toLowerCase();
  if (/done|complete|completed|finish|closed/.test(`${semantic} ${value}`)) return 'done';
  if (/review|accept|verify|approval|验收|确认/.test(`${semantic} ${value}`)) return 'review';
  if (/progress|active|doing|busy|进行/.test(`${semantic} ${value}`)) return 'active';
  return 'todo';
}

function makeMarker(color) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.055, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.86 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.18;
  ring.name = 'TaskStatusRing';
  return ring;
}

export function createAgentFarm3D({ container, tooltip, onTaskOpen, onSessionOpen, onReady, onError }) {
  if (!container) throw new Error('3D 农场容器不存在');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe9f5);
  scene.fog = new THREE.Fog(0xcfe9f5, 34, 62);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  const defaultCameraPosition = new THREE.Vector3(18.5, 19.5, 24.5);
  const defaultTarget = new THREE.Vector3(0, 0.8, 0.2);
  camera.position.copy(defaultCameraPosition);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Agent Todo 3D 农场，可拖动旋转、滚轮缩放并点击作物查看待办');
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xdff4ff, 0x7e9a58, 0.92);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2cf, 1.65);
  sun.position.set(-10, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  scene.add(sun);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(defaultTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 18;
  controls.maxDistance = 48;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.35;
  controls.enablePan = true;
  controls.update();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const interactiveMeshes = [];
  const slotGroups = { inbox: [], scheduled: [], active: [], done: [] };
  let farmRoot = null;
  let character = null;
  let motionAnchor = null;
  let hipBone = null;
  let footBones = [];
  const hipPosition = new THREE.Vector3();
  const footPosition = new THREE.Vector3();
  const groundRay = new THREE.Raycaster();
  const groundOrigin = new THREE.Vector3();
  const down = new THREE.Vector3(0,-1,0);
  const groundMeshes = [];
  let mixer = null;
  let activeAction = null;
  let previewTime = -1;
  let phase = 'resting';
  let phaseTime = 0;
  let route = [];
  let desiredWork = false;
  let sessionTasks = [];
  let workingSessionId = null;
  let switchAfter = 12;
  let elapsed = 0;
  const sessionPlants = new Map();
  const seat = new THREE.Vector3(0.7, 0.36, -3.68);
  const labels = document.createElement('div');
  labels.className = 'farm-session-labels';
  container.appendChild(labels);
  const previewButton = document.createElement('button');
  previewButton.className = 'farm-preview-control';
  previewButton.textContent = '演示角色动作';
  labels.appendChild(previewButton);
  previewButton.addEventListener('click', () => {
    previewTime = previewTime < 0 ? 0 : -1;
    previewButton.textContent = previewTime < 0 ? '演示角色动作' : '结束演示';
    if(previewTime===0 && character) { route=[]; character.position.copy(seat); character.rotation.y=0; enterPhase('resting'); labels.dataset.visited='resting'; }
    update(state);
  });
  const decorativeAssets = [];
  let disposed = false;
  let frameId = 0;
  const clock = new THREE.Clock();
  let state = { tasks: [], statuses: [], agents: [] };

  function resize() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  function findSlot(object) {
    let node = object;
    while (node && node !== farmRoot) {
      if (node.userData.session || SLOT_PREFIXES.some(prefix => node.name.startsWith(prefix))) return node;
      node = node.parent;
    }
    return null;
  }

  function pointerToCanvas(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function hoveredSlot(event) {
    pointerToCanvas(event);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(interactiveMeshes, false)[0];
    return hit ? findSlot(hit.object) : null;
  }

  function showTooltip(event, slot) {
    if (!tooltip) return;
    const task = slot?.userData?.task;
    if (!task) {
      tooltip.hidden = true;
      return;
    }
    tooltip.hidden = false;
    tooltip.style.left = `${event.clientX + 16}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
    tooltip.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = task.title || '未命名待办';
    const detail = document.createElement('span');
    detail.textContent = `${task.code || ''} · ${task.statusLabel || '待办'}`;
    tooltip.append(title, detail);
  }

  renderer.domElement.addEventListener('pointermove', event => {
    const slot = hoveredSlot(event);
    renderer.domElement.style.cursor = slot?.userData?.task ? 'pointer' : 'grab';
    showTooltip(event, slot);
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    if (tooltip) tooltip.hidden = true;
  });
  renderer.domElement.addEventListener('click', event => {
    const slot = hoveredSlot(event);
    if (slot?.userData.session) openSession(slot.userData.session);
    else if (slot?.userData.task && onTaskOpen) onTaskOpen(slot.userData.task);
  });

  function openSession(task) {
    if(task.id.startsWith('farm-preview')) return;
    if (onSessionOpen) onSessionOpen(task);
    else window.location.href = `codex://threads/${encodeURIComponent(task.threadId || task.id)}`;
  }

  function clearSlot(slot) {
    slot.userData.task = null;
    const marker = slot.getObjectByName('TaskStatusRing');
    if (marker) { slot.remove(marker); marker.geometry.dispose(); marker.material.dispose(); }
    slot.traverse(child => {
      if (/^Crop_/.test(child.name) || /^InboxPaper_/.test(child.name)) child.visible = false;
      if (child.isMesh && child.material?.emissive) child.material.emissiveIntensity = 0;
    });
  }

  function fillSlot(slot, task, color) {
    clearSlot(slot);
    if (!task) return;
    slot.userData.task = task;
    slot.traverse(child => {
      if (/^Crop_/.test(child.name) || /^InboxPaper_/.test(child.name)) child.visible = true;
    });
    slot.add(makeMarker(color));
  }

  function taskLabel(task) {
    const kind = statusKind(state.statuses, task.status);
    if (kind === 'active') return '进行中';
    if (kind === 'review') return '待验收';
    if (kind === 'done') return '已完成';
    return task.dueDate ? `已排期 ${task.dueDate}` : '收集箱';
  }

  function assignSlots(slots, tasks, color) {
    slots.forEach((slot, index) => {
      const task = tasks[index] || null;
      if (task) task.statusLabel = taskLabel(task);
      fillSlot(slot, task, color);
    });
  }

  function playClip(clipName, { once = false, reverse = false, hold = false } = {}) {
    const clip = character?.userData.clips?.find(item => item.name.toLowerCase() === clipName);
    if (clip && mixer) {
      const nextAction = mixer.clipAction(clip, character);
      activeAction?.fadeOut(0.2);
      nextAction.reset().setLoop(once || hold ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      nextAction.clampWhenFinished = true;
      nextAction.timeScale = reverse ? -1 : 1;
      if (reverse || hold) nextAction.time = Math.max(0, clip.duration - 0.001);
      nextAction.paused = hold;
      nextAction.fadeIn(0.2).play();
      activeAction = nextAction;
      return clip.duration;
    }
    return 1;
  }

  let phaseDuration = 0;
  function enterPhase(next) {
    phase = next;
    phaseTime = 0;
    if(character && ['resting','rising','sitting','digging','dancing'].includes(next)) character.rotation.y=0;
    if(next==='digging') switchAfter=10+Math.random()*8;
    const actions = { rising: ['sit', {once:true, reverse:true}], walking: ['walk', {}], digging: ['dig', {}], roadside: ['walk', {}], dancing: ['dance_05', {once:true}], returning: ['walk', {}], sitting: ['sit', {once:true}], resting: ['sit', {hold:true}], waiting: ['dig', {hold:true}] };
    phaseDuration = playClip(...actions[next]);
    const phaseLabels = {rising:'起身',walking:'走向田地',digging:'耕作中',roadside:'走向路边',dancing:'庆祝完成',returning:'返回躺椅',sitting:'坐下',resting:'休息中',waiting:'等待确认'};
    labels.dataset.phase=next;
    labels.dataset.visited=`${labels.dataset.visited || ''} ${next}`.trim().slice(-300);
    previewButton.title=`Codex · ${phaseLabels[next]}`;
  }

  function walkTo(points, nextPhase, walkingPhase = 'walking') {
    route = points.map(point => point.clone());
    route.nextPhase = nextPhase;
    enterPhase(walkingPhase);
  }

  function workPosition() {
    const task = sessionTasks.find(item => item.id === workingSessionId && item.status !== 'done') || sessionTasks.find(item => item.status !== 'done');
    workingSessionId = task?.id || null;
    labels.dataset.workingSession=workingSessionId || '';
    const plant = sessionPlants.get(task?.id);
    return plant ? plant.root.position.clone().add(new THREE.Vector3(0, 0, -0.4)) : new THREE.Vector3(0, 0.66, 0.35);
  }

  function isProblem(task) {
    return /waiting_approval|confirm|error|failed|blocked|needs_input/.test(String(task.status || '').toLowerCase());
  }

  function syncSessions(agent) {
    sessionTasks = previewTime >= 0 ? [
      {id:'farm-preview-1', title:'演示 · 界面开发', status:previewTime<45 ? 'in_progress':'done'},
      {id:'farm-preview-2', title:'演示 · 接口联调', status:previewTime<45 ? 'in_progress':'done'},
      {id:'farm-preview-3', title:'演示 · 等待确认', status:previewTime<45 ? 'waiting_approval':'done'}
    ] : agent.agentTasks || [];
    if (!sessionTasks.length && agent.threadId && desiredWork) sessionTasks = [{id:agent.threadId, threadId:agent.threadId, title:agent.task, status:'in_progress'}];
    const keep = new Set(sessionTasks.map(task => task.id));
    for (const [id, plant] of sessionPlants) if (!keep.has(id)) {
      if(previewTime>=0 && !id.startsWith('farm-preview')) {plant.root.visible=false; plant.button.hidden=true; continue;}
      if(!id.startsWith('farm-preview')) {
        // Finished/read threads drop out of the activity snapshot; keep their harvest.
        plant.root.userData.session={...plant.root.userData.session,status:'done'};
        plant.button.dataset.status='done';
        plant.root.visible=true;
        plant.button.setAttribute('aria-label',`${plant.root.userData.session.title}，已完成，点击打开会话`);
        continue;
      }
      scene.remove(plant.root);
      plant.button.remove();
      plant.root.traverse(mesh => { if(mesh.isMesh) { mesh.geometry.dispose(); mesh.material.dispose(); const index=interactiveMeshes.indexOf(mesh); if(index>=0) interactiveMeshes.splice(index,1); } });
      sessionPlants.delete(id);
    }
    sessionTasks.forEach((task, index) => {
      let plant = sessionPlants.get(task.id);
      if (!plant) {
        const root = new THREE.Group();
        const occupied = new Set([...sessionPlants.values()].map(plant=>plant.root.userData.slot));
        const available = [...slotGroups.active,...slotGroups.done,...slotGroups.scheduled].filter(slot=>!occupied.has(slot.name));
        const slot = available.find(slot=>!slot.userData.task) || available[0];
        if(!slot) return;
        slot?.getWorldPosition(root.position);
        root.position.y = 0.66;
        root.userData.session = task;
        root.userData.slot = slot.name;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.08,0.62,7), new THREE.MeshStandardMaterial({color:0x518735}));
        stem.position.y = 0.32;
        root.add(stem);
        for(let leafIndex=0;leafIndex<5;leafIndex++) {
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22,10,6), new THREE.MeshStandardMaterial({color:leafIndex%2 ? 0x83bd40 : 0xb2d85e}));
          const angle=leafIndex*Math.PI*2/5;
          leaf.scale.set(1,0.48,1.6); leaf.position.set(Math.sin(angle)*0.15,0.5+leafIndex*0.055,Math.cos(angle)*0.15); leaf.rotation.z=Math.sin(angle)*0.6;
          root.add(leaf);
        }
        root.traverse(mesh => {if(mesh.isMesh) interactiveMeshes.push(mesh);});
        scene.add(root);
        const button = document.createElement('button');
        button.className='farm-session-bubble';
        button.addEventListener('click',()=>openSession(root.userData.session));
        labels.appendChild(button);
        plant={root,button,age:0.65}; sessionPlants.set(task.id,plant);
      }
      plant.root.userData.session=task;
      plant.root.visible=true;
      const fullTitle=task.title || 'Codex 会话';
      plant.button.textContent=Array.from(fullTitle).slice(0,10).join('');
      plant.button.title=fullTitle;
      plant.button.dataset.status=task.status;
      plant.button.dataset.slot=plant.root.userData.slot;
      plant.button.setAttribute('aria-label',`${task.title}，${task.status==='done' ? '已完成' : isProblem(task) ? '待确认或异常' : '进行中'}，点击打开会话`);
    });
  }

  function tickCharacter(delta) {
    if(!character) return;
    elapsed+=delta;
    if(previewTime>=0) {
      const previous=previewTime; previewTime+=delta;
      if(previous<45 && previewTime>=45) update(state);
      if(previewTime>=85) {previewTime=-1; previewButton.textContent='演示角色动作'; update(state);}
    }
    phaseTime+=delta;
    if (route.length) {
      const target=route[0]; const difference=target.clone().sub(character.position);
      const distance=difference.length();
      const step=delta*1.35;
      if(distance<=step) { character.position.copy(target); route.shift(); if(!route.length) enterPhase(route.nextPhase); }
      else {
        character.rotation.y=Math.atan2(difference.x,difference.z);
        character.position.addScaledVector(difference.normalize(),step);
      }
    } else if(phase==='rising' && phaseTime>=phaseDuration) {
      walkTo([workPosition()], 'digging');
    } else if(phase==='dancing' && phaseTime>=phaseDuration) {
      walkTo([seat], 'sitting','returning');
    } else if(phase==='sitting' && phaseTime>=phaseDuration) enterPhase('resting');
    if(desiredWork && ['resting','sitting','returning','dancing','roadside'].includes(phase)) { route=[]; if(phase==='resting'||phase==='sitting') enterPhase('rising'); else walkTo([workPosition()],'digging'); }
    if(desiredWork && phase==='digging' && phaseTime>=switchAfter) {
      const others=sessionTasks.filter(task=>task.status!=='done' && task.id!==workingSessionId && sessionPlants.has(task.id));
      if(others.length) {workingSessionId=others[Math.floor(Math.random()*others.length)].id; walkTo([workPosition()],'digging');}
      else switchAfter=phaseTime+12;
    }
    if(!desiredWork && ['digging','waiting','walking','rising'].includes(phase)) {
      walkTo([new THREE.Vector3(-4+Math.random()*8,0.3,-3.05)], 'dancing','roadside');
    }
    for(const plant of sessionPlants.values()) {
      if(!plant.root.visible) continue;
      if(phase==='digging' && plant.root.userData.session.id===workingSessionId) plant.age=Math.min(1,plant.age+delta/3);
      const task=plant.root.userData.session;
      const completed=task.status==='done';
      if(completed) plant.age=1;
      const growth=Math.max(0.1,plant.age);
      plant.root.scale.set(growth*0.4, growth*(completed ? 1.35 : 0.42), growth*0.4);
      plant.root.rotation.z=isProblem(task) ? Math.sin(elapsed*5)*0.14 : 0;
      // Ground label sits in front of the plant (+Z), away from the farmer's head.
      const position=plant.root.position.clone().add(new THREE.Vector3(0,0.04,0.55)).project(camera);
      plant.button.style.transform=`translate(-50%, -100%) translate(${(position.x*.5+.5)*container.clientWidth}px,${(-position.y*.5+.5)*container.clientHeight}px)`;
      plant.button.hidden=position.z>1 || plant.age<0.1;
      plant.button.dataset.phase=phase;
    }
  }

  function update(nextState = {}) {
    state = {
      tasks: Array.isArray(nextState.tasks) ? nextState.tasks : state.tasks,
      statuses: Array.isArray(nextState.statuses) ? nextState.statuses : state.statuses,
      agents: Array.isArray(nextState.agents) ? nextState.agents : state.agents
    };
    if (!farmRoot) return;

    const grouped = { inbox: [], scheduled: [], active: [], done: [] };
    [...state.tasks].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).forEach(task => {
      const kind = statusKind(state.statuses, task.status);
      if (kind === 'done') grouped.done.push(task);
      else if (kind === 'active' || kind === 'review') grouped.active.push(task);
      else if (task.dueDate) grouped.scheduled.push(task);
      else grouped.inbox.push(task);
    });

    assignSlots(slotGroups.inbox, grouped.inbox, 0x94a3b8);
    assignSlots(slotGroups.scheduled, grouped.scheduled, 0x65a30d);
    assignSlots(slotGroups.active, grouped.active, 0x2563eb);
    assignSlots(slotGroups.done, grouped.done, 0x16a34a);

    slotGroups.active.forEach(slot => {
      if (slot.userData.task && statusKind(state.statuses, slot.userData.task.status) === 'review') {
        const ring = slot.getObjectByName('TaskStatusRing');
        if (ring) ring.material.color.setHex(0xf59e0b);
      }
    });

    if(!state.agents.length) return;
    const agent = state.agents[0];
    desiredWork = previewTime >= 0 ? previewTime < 45 : ['busy', 'working', 'waiting_approval', 'confirm'].includes(String(agent.status || '').toLowerCase());
    syncSessions(agent);
    if(desiredWork && phase==='digging' && !sessionTasks.some(task=>task.id===workingSessionId && task.status!=='done')) walkTo([workPosition()],'digging');
  }

  function resetCamera() {
    camera.position.copy(defaultCameraPosition);
    controls.target.copy(defaultTarget);
    controls.update();
  }

  const loader = new GLTFLoader();

  function prepareDecorativeAsset(root, { name, scale, x, z, rotationY, groundY }) {
    root.name = name;
    root.scale.setScalar(scale);
    root.rotation.y = rotationY;
    root.position.set(x, 0, z);
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    root.position.y += groundY - bounds.min.y;
    root.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach(material => {
        material.transparent = false;
        material.opacity = 1;
        material.alphaTest = 0;
        material.depthWrite = true;
        material.side = THREE.FrontSide;
        if (material.map) {
          material.map.colorSpace = THREE.SRGBColorSpace;
          material.map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
        }
        material.needsUpdate = true;
      });
    });
    decorativeAssets.push(root);
    scene.add(root);
    return root;
  }

  async function loadDecorativeAssets() {
    const [houseGltf, chairGltf, stallGltf] = await Promise.all([
      loader.loadAsync('/models/house-clean.glb'),
      loader.loadAsync('/models/chair-clean.glb'),
      loader.loadAsync('/models/stall-clean.glb')
    ]);
    prepareDecorativeAsset(houseGltf.scene, {
      name: 'FarmHouse', scale: 5.1, x: 5.6, z: -4.8, rotationY: -Math.PI / 2, groundY: 0.02
    });
    prepareDecorativeAsset(chairGltf.scene, {
      name: 'RestChair', scale: 1.45, x: 0.7, z: -4.15, rotationY: -Math.PI / 2, groundY: 0.38
    });
    prepareDecorativeAsset(stallGltf.scene, {
      name: 'TodoInboxStall', scale: 3.5, x: -7.5, z: -4.8, rotationY: -Math.PI / 2, groundY: 0.02
    });
  }

  loader.load('/models/agent-farm.glb', async gltf => {
    if (disposed) return;
    farmRoot = gltf.scene;
    scene.add(farmRoot);
    farmRoot.traverse(object => {
      if(/^Review(Marker|Bloom|Stem)_/.test(object.name)) {object.visible=false; return;}
      if (object.isLight) object.intensity = 0;
      if (object.isMesh) {
        if(/^(FarmMeadow|FarmIsland|BackPath|FrontPath|HousePath|Soil_|PlotBase_)/.test(object.name)) groundMeshes.push(object);
        object.castShadow = !/Water|Pond|Path/.test(object.name);
        object.receiveShadow = true;
        interactiveMeshes.push(object);
      }
      if (object.name.startsWith('Cell_Scheduled_')) slotGroups.scheduled.push(object);
      else if (object.name.startsWith('Cell_Active_')) slotGroups.active.push(object);
      else if (object.name.startsWith('Cell_Done_')) slotGroups.done.push(object);
      else if (object.name.startsWith('InboxSlot_')) slotGroups.inbox.push(object);
    });
    Object.keys(slotGroups).forEach(key => { slotGroups[key] = naturalSort(slotGroups[key]); });
    // Short access lanes connect the main road to the back edge of each plot.
    const laneMaterial=new THREE.MeshStandardMaterial({color:0xc8b88d,roughness:1});
    for(const x of [-5.7,0,5.7]) {
      const lane=new THREE.Mesh(new THREE.BoxGeometry(0.85,0.06,2.3),laneMaterial);
      lane.name='PlotAccessPath';
      lane.position.set(x,0.23,-2.5);
      lane.receiveShadow=true;
      scene.add(lane);
      groundMeshes.push(lane);
    }
    const oldCharacter = farmRoot.getObjectByName('AgentCharacter');
    if(oldCharacter) {
      oldCharacter.traverse(mesh=>{const index=interactiveMeshes.indexOf(mesh); if(index>=0) interactiveMeshes.splice(index,1);});
      oldCharacter.removeFromParent();
    }
    try {
      const [, animated] = await Promise.all([loadDecorativeAssets(), loader.loadAsync('/models/character-animated.glb')]);
      if(disposed) return;
      character = new THREE.Group();
      const model=animated.scene;
      model.scale.setScalar(1.8);
      // Tripo's face and forward leg direction are +X; routes use world +Z.
      model.rotation.y=-Math.PI/2;
      motionAnchor=new THREE.Group();
      motionAnchor.add(model);
      character.add(motionAnchor);
      hipBone=model.getObjectByName('Hip');
      footBones=['L_Foot','R_Foot','L_ToeBase','R_ToeBase'].map(name=>model.getObjectByName(name)).filter(Boolean);
      character.position.copy(seat);
      scene.add(character);
      character.userData.clips=animated.animations;
      mixer=new THREE.AnimationMixer(character);
      model.traverse(mesh=>{if(mesh.isMesh) {mesh.castShadow=true; if(mesh.isSkinnedMesh) mesh.frustumCulled=false;}});
      enterPhase('resting');
      update(state);
      if (onReady) onReady();
    } catch (error) {
      console.error('3D farm decorative asset load failed', error);
      if (onError) onError(error);
    }
  }, undefined, error => {
    console.error('3D farm load failed', error);
    if (onError) onError(error);
  });

  function animate() {
    if (disposed) return;
    frameId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    mixer?.update(delta);
    tickCharacter(delta);
    // Tripo stores locomotion in Hip (in a rotated rig), not only BoneRoot.
    // Cancel world-horizontal hip motion after mixing, including crossfades,
    // so looping clips cannot move the visible actor away from the route.
    if(motionAnchor && hipBone) {
      stabilizeCharacterMotion(character,motionAnchor,hipBone,hipPosition);
      if(['walking','returning','roadside','dancing'].includes(phase) && footBones.length) {
        // Sample only walkable surfaces: this changes height, never the X/Z route.
        scene.updateMatrixWorld(true);
        groundOrigin.set(character.position.x,10,character.position.z);
        groundRay.set(groundOrigin,down);
        const surface=groundRay.intersectObjects(groundMeshes,false)[0];
        if(surface) {
          groundCharacterFeet(character,motionAnchor,footBones,surface.point.y,footPosition);
        }
      }
    }
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function dispose() {
    disposed = true;
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    controls.dispose();
    mixer?.stopAllAction();
    labels.remove();
    scene.traverse(object => {
      if(!object.isMesh) return;
      object.geometry?.dispose();
      const materials=Array.isArray(object.material) ? object.material : [object.material];
      for(const material of materials.filter(Boolean)) {
        for(const value of Object.values(material)) if(value?.isTexture) value.dispose();
        material.dispose();
      }
    });
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  }

  return { update, resetCamera, dispose };
}
