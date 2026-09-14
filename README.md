# Arizona Communications Network — PWA

Upload every file/folder in this package to the root of the GitHub repository.

Included:
- `index.html` — existing ACN REAL PHONE prototype plus PWA enhancement layer
- `manifest.json` — installable standalone PWA configuration
- `service-worker.js` — offline shell/update support
- `icons/acn-icon.svg` — ACN app icon

The enhancement layer adds virtual battery drain/charging, Control Center, mute, virtual Wi‑Fi, Battery Saver, brightness, volume, calculator, swipe-down Control Center, incoming-call/911 hooks, global announcement hook, and hides the old Radio item.

The virtual phone controls do not affect the physical device. Real accounts, real-time messaging/calls, 911 routing, Central Dispatch authorization, and server-side announcements require the ACN backend.
