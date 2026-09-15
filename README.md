# Arizona Communications Network — Installable PWA

Upload the CONTENTS of this folder to the ROOT of the GitHub repository. Do not upload the ZIP itself.

Required structure:
- index.html
- manifest.json
- service-worker.js
- icons/acn-192.png
- icons/acn-512.png

Cloudflare Pages: Framework=None, build command blank, output directory=root/blank, root directory blank.

Once deployed over HTTPS, Chrome/Edge/Android can offer Install ACN. iPhone/iPad Safari can use Share → Add to Home Screen. Installed mode uses the PWA standalone window.

Included in this version: the existing ACN REAL PHONE prototype, PWA install metadata, app icons, service worker, install prompt, virtual battery/charging, Control Center, mute, virtual Wi-Fi, Battery Saver, brightness/volume, calculator, incoming-call/911 hooks, global announcement hook, animations, and Radio removed/hidden.

Real accounts, real-time messaging, real voice calls, 911 routing, Central Dispatch authorization and server-side global announcements require the ACN backend.
