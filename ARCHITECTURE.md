# Architecture

## 1. Overview

Wirebase is a single Node.js process that serves both the JSON API and the static frontend —
no separate frontend build, no JWT. Real-time updates (QR codes, connection status, incoming
messages) are pushed over Socket.IO, authenticated with the same session cookie as the REST API.

```
                        ┌─────────────────────────────────────────────┐
                        │                index.js                     │
                        │  Express app + HTTP server + Socket.IO      │
                        │                                              │
   Browser  ──HTTP──▶   │  express.static('/public')  → HTML pages    │
   (dashboard)           │  express.static('/static')   → CSS/JS       │
                        │  /api/*                      → REST routes  │
                        │  (session cookie, connect-mongo store)      │
                        │                                              │
   Browser  ◀─WS───▶    │  Socket.IO (shares the session middleware)  │
   (instance page)       │    rooms: instance:<id>                     │
                        └───────────────┬─────────────────┬───────────┘
                                        │                 │
                                        ▼                 ▼
                              ┌──────────────────┐  ┌───────────────────┐
                              │   MongoDB          │  │  baileysManager    │
                              │  users             │  │  (in-memory map:   │
                              │  instances         │  │   instanceId →     │
                              │  messages          │  │   Baileys socket)  │
                              │  apikeys           │  │                    │
                              │  sessions           │  │  ↔ WhatsApp Web    │
                              └──────────────────┘  └───────────────────┘
                                                              ▲
                                                              │ POST /api/public/send
                                                     External systems (n8n, scripts, etc)
                                                     authenticated via X-API-Key
```

## 2. Directory layout

```
wirebase/
├── index.js                    # Entry point: wires Express + Socket.IO + Mongo + sessions + static hosting
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
│
├── src/
│   ├── config/
│   │   └── db.js                # Mongoose connection
│   │
│   ├── models/                  # Mongoose schemas
│   │   ├── User.js              # Sub-admin accounts (role: "subadmin"). Admin has no row.
│   │   ├── Instance.js          # One WhatsApp connection. ownerRole/ownerId + unique name per owner.
│   │   ├── Message.js           # Inbound/outbound message log + webhook delivery status
│   │   └── ApiKey.js            # Hashed public API keys (sha256, never plaintext)
│   │
│   ├── middleware/
│   │   ├── session.js           # requireAuth / requireAdmin - reads req.session (no JWT)
│   │   └── apiKeyAuth.js        # requireApiKey - for the public /send endpoint
│   │
│   ├── controllers/             # Request handlers (one per resource)
│   │   ├── authController.js       # admin-login, login, me, logout
│   │   ├── instanceController.js   # CRUD + connect/disconnect + webhook/proxy config
│   │   ├── subadminController.js   # admin-only: create/list/toggle/reset/delete sub-admins
│   │   ├── apiKeyController.js     # create/list/revoke/delete API keys
│   │   └── publicController.js     # the public send-message endpoint (by instanceName or id)
│   │
│   ├── routes/                  # Express routers, one per controller, mounted in index.js
│   │
│   ├── services/
│   │   ├── baileysManager.js    # Owns every live Baileys socket; QR/status/message events → Socket.IO + Mongo
│   │   └── proxyService.js      # Fetches/tests/rotates free HTTP proxies
│   │
│   └── utils/
│       └── apiKey.js            # generateApiKey() / hashApiKey()
│
├── public/                      # Static HTML pages (one per screen, no SPA router)
│   ├── login.html
│   ├── index.html               # Dashboard (instance list)
│   ├── instance.html            # Instance detail (QR, webhook, proxy, live messages)
│   ├── subadmins.html           # Admin only
│   ├── api-keys.html
│   └── developers.html
│
└── static/
    ├── css/style.css            # Single shared stylesheet (light theme, CSS variables)
    └── js/
        ├── api.js                # fetch() wrapper, sends the session cookie
        ├── layout.js             # Sidebar/mobile-drawer render + account fetch, used by every page
        ├── dashboard.js
        ├── instance.js           # Socket.IO client logic lives here
        ├── subadmins.js
        ├── apikeys.js
        └── developers.js
```

## 3. Request flow examples

**Loading the dashboard**
1. Browser requests `/` → Express serves `public/index.html`.
2. Page loads `static/js/api.js`, `layout.js`, `dashboard.js`.
3. `dashboard.js` calls `initLayout()` → `GET /api/auth/me` (session cookie sent automatically).
   - No valid session → redirect to `/login.html`.
   - Valid session → sidebar renders, nav items shown/hidden based on `role`.
4. `dashboard.js` calls `GET /api/instances` → `instanceController.listInstances` scopes by
   `req.role`/`req.ownerId` (admin sees all, sub-admin sees only their own) → renders cards.

**Connecting an instance (QR flow)**
1. `instance.html` loads, opens a Socket.IO connection, emits `join <instanceId>`.
2. Server checks the instance is owned by the caller (via the shared session) before joining
   the room `instance:<id>`.
3. Browser calls `POST /api/instances/:id/connect` → `baileysManager.startInstance()` creates a
   Baileys socket, `useMultiFileAuthState` writes creds under `sessions/<id>/`.
4. Baileys emits a QR → `baileysManager` converts it to a data-URL PNG and emits a `qr` event to
   the `instance:<id>` room → the browser renders it directly, no polling.
5. On scan, Baileys fires `connection.update` with `connection: 'open'` → status saved to
   Mongo + emitted over the socket → UI flips to "Connected".

**Sending a message via the public API**
1. External caller (n8n, script, etc) sends `POST /api/public/send` with `X-API-Key` and
   `{ instanceName, to, type, message }`.
2. `requireApiKey` hashes the key, looks it up in `apikeys`, attaches the key's owner.
3. `publicController.sendMessage` looks up the `Instance` by **name** (or id) scoped to that
   owner — this is what guarantees the message goes out from the exact number intended, even
   if the caller only knows the instance's label, not its Mongo `_id`.
4. If connected, `baileysManager.sendContent()` sends it through the live Baileys socket; the
   result is logged to `messages` and returned to the caller.

**An incoming WhatsApp message**
1. Baileys fires `messages.upsert` inside `baileysManager`.
2. Text (or caption) is extracted, saved to `messages`, emitted to the `instance:<id>` Socket.IO
   room (live table update on the instance page), and POSTed to the instance's `webhookUrl` with
   an `X-Webhook-Secret` header — delivery success/failure is recorded back on the message doc.

## 4. Auth model in one paragraph

There is no JWT anywhere. Login (`admin-login` or `login`) writes `role` and (for sub-admins)
`userId` into `req.session`, which `express-session` persists in MongoDB via `connect-mongo` and
identifies to the browser with an httpOnly cookie. Every subsequent request — REST or
Socket.IO — carries that cookie, and `requireAuth`/`requireAdmin` read straight off
`req.session`. The **public** `/api/public/send` endpoint is the one exception: it's for
machines, not browsers, so it authenticates with a static, revocable API key instead.

## 5. Data ownership model

- `ownerRole` + `ownerId` appears on both `Instance` and `ApiKey`.
- `ownerRole: 'admin'` always pairs with `ownerId: null` (Admin has no document to point to).
- `ownerRole: 'subadmin'` pairs with the sub-admin's `User._id`.
- Every scoped query (`instanceController`, `apiKeyController`, `publicController`) builds this
  same `{ ownerRole, ownerId }` filter from the caller's session or API key — there's exactly
  one place this logic lives per controller, so ownership can't leak between accounts by accident.

## 6. Process model / scaling

Everything (Express, Socket.IO, every live Baileys socket) runs in one Node process, which is
the right shape for a single-VPS Docker deployment. The two things that would need to change to
run more than one replica:
- **Baileys sockets** live in an in-memory `Map` in `baileysManager.js` — a second replica has
  no way to know which process owns which instance. Would need a shared registry (Redis) plus
  routing connect/send calls to the right process.
- **Sessions** already live in MongoDB (not in-memory), so they're already safe to share across
  replicas as-is.
