# ACN Real Backend

This is the real multiplayer backend for Arizona Communications Network.

It uses Cloudflare Workers + a SQLite-backed Durable Object. Durable Objects are used as the single coordination point for ACN WebSockets, which is suitable for real-time chat/signaling/presence. The backend provides:

- ACN account registration/login
- automatic 928-555-XXXX ACN numbers
- roles: user / dispatcher / admin
- real-time presence
- persistent 1-to-1 text messages
- real-time WebSocket signaling for voice calls
- 911 routing to the current Central Dispatch user
- protected Central Dispatch claim/release
- admin announcements
- call lifecycle events

## Deploy

1. Install Node.js and Wrangler.
2. From this `backend` folder run:

```bash
npm install -D wrangler
npx wrangler login
npx wrangler deploy
```

3. Copy the Worker URL, e.g. `https://acn-network-api.YOUR-SUBDOMAIN.workers.dev`.
4. In the ACN website set:

```js
window.ACN_API_BASE = 'https://acn-network-api.YOUR-SUBDOMAIN.workers.dev';
```

before `acn-client.js` loads.

## First admin

For safety, registration creates normal users. Promote the first owner manually in the Durable Object database using Wrangler/Dashboard tooling, or add an admin-only bootstrap route before public launch. Do not expose a public "make me admin" button.

## Voice calls

The backend supplies WebRTC signaling. Browsers still require microphone permission. For users behind restrictive NATs, production voice should also use a TURN server; STUN-only WebRTC is not guaranteed to connect every pair of users.
