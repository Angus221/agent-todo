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
- The replacement character export contains five native Tripo clips: `dance_05`, `dig`, `shovel`, `sit`, and `walk`. Verified the browser uses these original clips instead of the former custom actions.
- Verified the complete preview phase trace: `resting → rising → walking → digging → roadside → dancing → returning → sitting → resting`. A newly busy real session can interrupt the rest and start another cycle.
- Verified the chair's local long axis and backrest geometry: its foot end is local +X, so a -90° Y rotation points it toward the fields (+Z). The final browser view shows the chair aligned front-to-back with the fields rather than parallel to the road.
- Added keyboard-focusable game-style labels above growing session plants, plus a local action-preview control. Session titles use text content rather than interpolated HTML.
- Corrected the native character's +X forward axis to world +Z (the house entrance/field-facing direction). Seated and digging poses now face forward; walking turns toward the direct destination instead of strafing sideways.
- Raised the chair's lowest contact point to 0.32 and aligned the seated character with its front cushion. Removed the `ReviewMarker_*` balloon-like decorations.
- Replaced two-line 240px labels with single-line 138px compact bubbles and 10px text. Session plants now grow to 45% of their previous scale, on top of the soil; the character follows the direct shortest segment and rises to the field surface when entering cells.
- Allocated distinct persistent cells to each Codex session. Multiple unfinished sessions are visited in random order every 10–18 seconds of digging. Active plants remain short, completed plants grow tall, and approval/error/blocked plants sway. The preview includes two active sessions and one approval session to exercise these states without modifying live tasks.
- Fixed locomotion jumps at walk-loop boundaries and pose changes: the native `walk` clip stores substantial translation in `Hip`, not `BoneRoot`. A parent motion anchor now cancels the mixed hip's world-horizontal displacement every frame while preserving vertical motion. Position follows one continuous straight A-to-B segment; no obstacle/terrain detours or threshold snaps are used. Dance phases explicitly face the house-forward direction.
- Added a regression using the actual shipped GLB and Three.js animation mixer. It first reproduces over one world unit of uncorrected drift, then checks repeated walk loops and crossfades through dig, return, dance, and sit for route error below 0.00001 and frame-to-frame horizontal movement below 0.023 at 60 FPS. Disabled static frustum bounds on the animated skinned mesh to prevent incorrect disappearance after motion compensation.
- Moved session titles from above plants to the ground in front of them (+Z, 0.04 above the plant's soil plane). Each label displays at most ten Unicode characters; its native hover title retains the full session title, and clicking still opens the thread.
- Moved the seated root forward another 0.34 world units and raised the chair/root together by 0.06, preserving cushion contact while allowing the lower legs to hang beyond the lounge-chair foot end. Verified the live seated view against the user's supplied close-up.
- Added three short access paths from the main road to the plot entrances. Walking and dancing now raycast only walkable surfaces and align the lowest ankle/toe bone with the shoe-sole clearance. This corrects grass hovering without changing the straight horizontal route. The native-rig regression also checks foot contact on grass, road, and soil heights throughout walking/dancing.
- Matched the latest annotated screenshots: titles are projected as ground-parallel rectangles at the front edge of each cell, including camera perspective rather than screen-horizontal billboards. Full hover titles and thread-click handlers remain intact.
- Field allocation now follows world-space columns: maximum X/rightmost column first, maximum Z/front cell first, then toward the rear before moving left. Verified the first six cells follow front-right 1, rearward 2/3, then the next column's 4/5/6. Applied to all three task plots and session cell allocation.
- Added regression checks for the explicit first-six-cell order and for all four ground-label corners plus its center matching the camera's perspective projection.
- Replaced the suspended appearance shown in the latest user screenshot with an extended meadow, a sloped edge transition, distant hills, blue sky, clouds, and a visible sun. Kept the supplied farm models and task interactions intact.
- Verified the environment dialog displays Jinan by default, saves to SQLite, and retains selected settings after reload/server restart. Visually checked rain, snow, sunset, and night previews (moon/stars plus warm porch/stall lights), then restored Jinan with automatic time and live weather.
- Verified a successful live Open-Meteo response for Jinan. Tests cover settings persistence/validation, 15-minute caching, stale/offline fallback without reusing another city's data, city-local daylight calculation, and manual weather preview semantics. The environment obeys reduced-motion preferences for cloud/precipitation movement and disposes its timer/resources on exit.
- Anchored the sun above the actual cottage roof bounds and reduced its size. Verified the live sunny view and an empty browser error log; weather and daylight visibility remain unchanged.
- Added a Blender-built quota water tower beside the cottage. Verified readable default-view labels, live weekly-only fallback (65%), duration-based window selection, zero/missing data handling, and an empty browser error log.
- Replaced the quota plaque with transparent curved percentage lettering on the tank. Moved the weather anchor above the stall/field gap. Visually verified rain clouds, partial cloudy sun, white snow clouds and snow-coated cottage surfaces; restored automatic Jinan weather after previews.
