# 3D Task Farm Design QA

final result: passed

## Comparison evidence

- Source truth: the two user screenshots showing corrupted cottage/stall UVs, a chair intersecting the terrain, a shovel, and incorrect prop placement.
- Implementation evidence: `assets/web/models/farm-browser.png`, captured from the live `http://127.0.0.1:8021/` farm at a 1280×720 desktop viewport.
- The source screenshots and final browser capture were inspected together in one composite image.

## Fix history

- P1 — Cottage and stall textures appeared perforated after destructive mesh decimation. Rebuilt clean browser assets from the original GLBs with UV-preserving mesh optimization; the final capture has continuous walls, roof tiles, timber, and stall shelves.
- P1 — The rest chair intersected the terrain and faced away from the task fields. Grounded it from its computed bounding box, raised its contact plane, and rotated it toward the fields.
- P1 — The cottage orientation did not present its entrance to the fields. Rotated the cottage and stall to face the working area.
- P1 — The character used an unwanted shovel. Removed the shovel meshes from the browser scene and retained the rig-driven `Dig`/`Sit` actions.
- P1 — The idle character floated above the chair. Lowered the character root to the chair seat; the final capture shows the character seated rather than standing on the furniture.

## Runtime verification

- Confirmed the farm, clean cottage, chair, and stall GLBs load without console errors.
- Confirmed live task counts, empty soil cells, camera reset, orbit/zoom controls, lazy loading, and five-second dashboard state updates remain intact.
- The supplied character GLB contains an armature but no exported animation clips; the browser farm therefore keeps its rig-based custom crouching/digging and sitting clips.
