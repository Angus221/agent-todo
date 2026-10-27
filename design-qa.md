# 3D Task Farm Design QA

final result: passed

## Verified scope

- Compared the supplied warm farm reference and the live browser implementation side by side at a 1280×720 desktop viewport.
- Confirmed the intended spatial hierarchy: stall at the far left/top, scheduled field on the left, active/review field in the center, completed field on the right, cottage and rest chair behind the fields.
- Corrected the initial browser overexposure by disabling the exported Blender light and tuning the Three.js hemisphere light, sun, and tone-mapping exposure.
- Confirmed live SQLite counts, empty-slot behavior, status-colored rings, hover title/status feedback, and clicking a crop to open the matching todo drawer.
- Confirmed lazy loading, loading and failure states, camera reset, orbit/zoom controls, and safe teardown when leaving the module.
- Confirmed the `Dig` and `Sit` animation clips are embedded in the GLB and selected from Codex activity state.
- Confirmed visible controls have accessible names and keyboard focus styles; reduced-motion behavior remains available for the existing dashboard animations.

## Intentional differences

- The reference image shows every field fully planted. The implementation renders only real todos, so empty cells remain bare soil by design.
- The live view keeps the dashboard's existing compact left navigation and adds a small translucent farm legend for interaction guidance.
- The 3D mode is desktop-first, matching the existing dashboard shell. Narrow viewports retain access to the canvas but are not a separate mobile composition.
