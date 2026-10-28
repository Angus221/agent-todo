import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const SLOT_PREFIXES = ['Cell_Scheduled_', 'Cell_Active_', 'Cell_Done_', 'InboxSlot_'];

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

export function createAgentFarm3D({ container, tooltip, onTaskOpen, onReady, onError }) {
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
  let mixer = null;
  let activeAction = null;
  let currentAgentMode = '';
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
      if (SLOT_PREFIXES.some(prefix => node.name.startsWith(prefix))) return node;
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
    tooltip.innerHTML = `<strong>${task.title || '未命名待办'}</strong><span>${task.code || ''} · ${task.statusLabel || '待办'}</span>`;
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
    const task = hoveredSlot(event)?.userData?.task;
    if (task && onTaskOpen) onTaskOpen(task);
  });

  function clearSlot(slot) {
    slot.userData.task = null;
    const marker = slot.getObjectByName('TaskStatusRing');
    if (marker) slot.remove(marker);
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

  function setCharacterMode(mode) {
    if (!character || mode === currentAgentMode) return;
    currentAgentMode = mode;
    const working = mode === 'working';
    character.position.set(working ? 0 : 0.72, working ? 0.08 : 0.12, working ? 0.35 : -4.04);
    character.rotation.y = working ? 0.2 : 0;
    const clipName = working ? 'Dig' : 'Sit';
    const clip = character.userData.clips?.find(item => item.name === clipName);
    if (clip && mixer) {
      const nextAction = mixer.clipAction(clip, character);
      if (activeAction !== nextAction) {
        activeAction?.fadeOut(0.25);
        nextAction.reset().fadeIn(0.25).play();
        activeAction = nextAction;
      }
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

    const agent = state.agents[0] || {};
    const working = ['busy', 'working', 'waiting_approval', 'confirm'].includes(String(agent.status || '').toLowerCase());
    setCharacterMode(working ? 'working' : 'resting');
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
      name: 'RestChair', scale: 1.45, x: 0.7, z: -4.15, rotationY: Math.PI, groundY: 0.16
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
      if (object.isLight) object.intensity = 0;
      if (object.isMesh) {
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
    character = farmRoot.getObjectByName('AgentCharacter');
    if (character) {
      character.userData.clips = gltf.animations || [];
      mixer = new THREE.AnimationMixer(character);
    }
    try {
      await loadDecorativeAssets();
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
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function dispose() {
    disposed = true;
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  }

  return { update, resetCamera, dispose };
}
