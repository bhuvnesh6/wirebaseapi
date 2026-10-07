# Wirebase — Multi-Instance WhatsApp Gateway (single-project)

One Node.js app (Express + Socket.IO + Baileys + MongoDB) serving both the API and a plain
HTML/CSS/JS dashboard — no build step, no frontend framework, ready to run in a single Docker
container on a VPS.

```
wirebase/
  index.js            <- entry point: Express + Socket.IO + sessions + Mongo, wires everything together
  src/                 <- models, controllers, routes, services (imported by index.js)
  public/              <- HTML pages (served at /)
  static/               <- CSS + JS assets (served at /static)
  Dockerfile
  docker-compose.yml
```

⚠️ **Baileys is an unofficial WhatsApp Web client**, not the official Business API. Great for
internal tools, but against WhatsApp's Terms of Service — numbers can get rate-limited or
banned. This is inherent to how Baileys works. For customer-facing production use, consider
Meta's official Cloud API instead.

---

## 1. Auth model — no JWT

- **Admin** has no database row. Whoever holds the `ADMIN_API_KEY` value from `.env` *is* the
  Admin — logs in from the "Admin" tab by pasting that key.
- **Sub-admins** are documents in the `users` MongoDB collection with `role: "subadmin"`,
  created only by the Admin (Sub-admins page). A password is generated and shown **once**
  right after creation (only its bcrypt hash is ever stored).
- Both log in the same way under the hood: the server writes `role` (and `userId` for
  sub-admins) into an **httpOnly session cookie**, backed by MongoDB via `connect-mongo` — no
  JWTs anywhere. Socket.IO shares the exact same session (via `io.engine.use(sessionMiddleware)`)
  so the QR/status/message live feed on the instance page is authenticated the same way.

## 2. Ownership & the public send API

- Every instance has `ownerRole` (`admin` | `subadmin`) and `ownerId`. Admin sees every instance
  system-wide (with an owner badge); a sub-admin only ever sees their own.
- An instance **name is unique per owner** (enforced by a MongoDB unique index), which is what
  lets the public send endpoint accept a human-readable `instanceName` instead of a raw ID —
  you always know exactly which number a message will go out from:

```
  POST /api/public/send
  Headers: X-API-Key: <your key>
  {
    "instanceName": "Support line",
    "to": "919876543210",
    "type": "text",
    "message": "Hello!"
  }
```
  `instanceId` is also still accepted if you prefer it. Media types (`image`, `video`, `audio`,
  `document`) take a public `url` instead of `message`. Full field reference and live, copyable
  code for cURL / JavaScript / Python / PHP / n8n is in the app's **Developers** page.
- A key can only send through instances owned by the same account (Admin or that specific
  sub-admin) it belongs to.

## 3. Local development

```bash
npm install
cp .env.example .env
```

Edit `.env` — at minimum:
```
MONGO_URI=mongodb://127.0.0.1:27017/wirebase
ADMIN_API_KEY=some-long-random-string     # this IS the admin login credential
SESSION_SECRET=some-other-long-random-string
PUBLIC_BASE_URL=http://localhost:4000
PORT=4000                                 # the server defaults to 4030 if this is not set
```

Optional:
```
DEVELOPER_SIGNUP_ENABLED=false            # close public developer registration (default: open)
TRUST_PROXY=true                          # set when running behind Nginx/Caddy (also implied by COOKIE_SECURE=true)
COOKIE_SECURE=true                        # production over HTTPS only
```

Run it (needs a local MongoDB, or point `MONGO_URI` at Atlas):
```bash
npm run dev     # nodemon, or: npm start
```

Open `http://localhost:4000`.

## 4. Developer API: multi-tenant usage

Wirebase supports a second layer on top of the admin/sub-admin dashboard: a developer app model.
This is meant for external product teams that want to manage their own customers and WhatsApp
instances without sharing the admin API key or a single global account key.

### 4.1 Developer model

A developer has:
- `name`
- `email`
- `password`
- `status`

A developer app has:
- `developer`
- `name`
- `clientId`
- `clientSecretHash`
- `webhookUrl`
- `status`

A tenant has:
- `app`
- `externalUserId` (your customer ID from your own app)
- `name`
- `status`

Each WhatsApp instance can be linked to:
- `app`
- `tenant`
- `externalUserId`

This allows you to scope tasks to a specific application and customer instead of a global
admin-owned API key.

### 4.2 Developer authentication

Use a developer app secret as a bearer token (recommended):

```bash
curl -H "Authorization: Bearer <APP_SECRET>" \
  https://your-domain.com/api/v1/developer/tenants
```

You can also send:

```bash
curl -H "X-Firebase-App-Key: <APP_SECRET>" \
  https://your-domain.com/api/v1/developer/tenants
```

> Do not ship the app secret in browser JavaScript. Keep it on your backend server only.

### 4.3 Developer app lifecycle

> Sign-up is open by default. To close it on a production server, set `DEVELOPER_SIGNUP_ENABLED=false`
> in `.env` (registration then returns `403`). Passwords must be at least 8 characters.

#### 1) Register a developer account
```bash
curl -X POST https://your-domain.com/api/v1/developer/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Dev",
    "email": "dev@acme.com",
    "password": "super-secret-password"
  }'
```

#### 2) Login as a developer
```bash
curl -X POST https://your-domain.com/api/v1/developer/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "dev@acme.com",
    "password": "super-secret-password"
  }'
```

#### 3) Create an app
```bash
curl -X POST https://your-domain.com/api/v1/developer/apps \
  -H "Content-Type: application/json" \
  -H "Cookie: wirebase.sid=<session-cookie>" \
  -d '{
    "name": "Acme Production App",
    "webhookUrl": "https://api.acme.com/webhooks/wfirebase"
  }'
```

The response includes a one-time `clientSecret` that should be stored securely on your backend:

```json
{
  "app": {
    "id": "...",
    "name": "Acme Production App",
    "clientId": "app_xxx",
    "webhookUrl": "https://api.acme.com/webhooks/wfirebase",
    "status": "active"
  },
  "clientSecret": "firebase_app_xxxxxxxxxx",
  "note": "Store this secret securely. It is shown once only."
}
```

#### 4) Rotate or revoke an app secret

```bash
# issue a new secret (the old one stops working immediately; shown once)
curl -X POST https://your-domain.com/api/v1/developer/apps/<APP_ID>/rotate-secret \
  -H "Cookie: wirebase.sid=<session-cookie>"

# revoke the app
curl -X POST https://your-domain.com/api/v1/developer/apps/<APP_ID>/revoke \
  -H "Cookie: wirebase.sid=<session-cookie>"
```

### 4.4 Tenant / user flow

Each tenant represents one customer or user in your own platform.

#### Create or update a tenant
```bash
curl -X POST https://your-domain.com/api/v1/developer/tenants \
  -H "Authorization: Bearer <APP_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "externalUserId": "customer_123",
    "name": "John Doe",
    "webhookUrl": "https://api.acme.com/webhooks/wfirebase/customer_123"
  }'
```

#### Create a WhatsApp instance for that tenant
```bash
curl -X POST https://your-domain.com/api/v1/developer/tenants/customer_123/instances \
  -H "Authorization: Bearer <APP_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "john-whatsapp",
    "webhookUrl": "https://api.acme.com/webhooks/wfirebase/customer_123"
  }'
```

Response:

```json
{
  "instance": {
    "id": "6650...",
    "name": "john-whatsapp",
    "status": "created",
    "externalUserId": "customer_123",
    "webhookSecret": "9f2c..."
  },
  "note": "Use webhookSecret to verify X-Wirebase-Signature on incoming webhooks."
}
```

#### Connect an instance
```bash
curl -X POST https://your-domain.com/api/v1/developer/instances/6650.../connect \
  -H "Authorization: Bearer <APP_SECRET>"
```

#### Check status
```bash
curl https://your-domain.com/api/v1/developer/instances/6650.../status \
  -H "Authorization: Bearer <APP_SECRET>"
```

Example response:

```json
{
  "instanceId": "6650...",
  "externalUserId": "customer_123",
  "tenantId": "...",
  "status": "connected",
  "phoneNumber": "919876543210",
  "lastConnectedAt": "2026-09-24T12:00:00.000Z",
  "connected": true
}
```

#### Get QR code
```bash
curl https://your-domain.com/api/v1/developer/instances/6650.../qr \
  -H "Authorization: Bearer <APP_SECRET>"
```

#### Manage tenants and instances

All of these use `Authorization: Bearer <APP_SECRET>`.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/tenants/:externalUserId` | Get one tenant |
| `DELETE` | `/tenants/:externalUserId` | Delete the tenant, log out and delete all its instances and their messages |
| `POST` | `/tenants/:ref/webhook` | Set the tenant webhook (`:ref` = tenant id **or** `externalUserId`) |
| `GET` | `/tenants/:externalUserId/instances` | List a tenant's instances |
| `GET` | `/instances?externalUserId=...` | List all app instances (optional filter) |
| `GET` | `/instances/:id` | Instance details, effective webhook URL and `webhookSecret` |
| `PATCH` | `/instances/:id/webhook` | Override the instance webhook (`{"webhookUrl": null}` = inherit again) |
| `POST` | `/instances/:id/logout` | Log the WhatsApp device out and wipe the session (call `/connect` to pair again) |
| `DELETE` | `/instances/:id` | Log out and permanently delete the instance and its messages |

```bash
# who is connected for customer_123?
curl https://your-domain.com/api/v1/developer/tenants/customer_123/instances \
  -H "Authorization: Bearer <APP_SECRET>"

# get the webhook signing secret for an instance
curl https://your-domain.com/api/v1/developer/instances/6650... \
  -H "Authorization: Bearer <APP_SECRET>"

# log out a customer's number
curl -X POST https://your-domain.com/api/v1/developer/instances/6650.../logout \
  -H "Authorization: Bearer <APP_SECRET>"
```

**Webhook URL resolution.** For each event Wirebase picks the first URL that is set:
instance override → tenant `webhookUrl` → app `webhookUrl`. It is resolved when the event fires, so
updating a tenant or app webhook affects existing instances immediately.

**Upserting tenants.** `POST /tenants` only changes the fields you send. Omitting `name` or `webhookUrl`
on an existing tenant leaves the stored value untouched.

Creating an instance returns `webhookSecret` — use it to verify webhook signatures (see 4.6).
`409` is returned if the instance name is already taken.

### 4.5 Send messages for a tenant instance

```bash
curl -X POST https://your-domain.com/api/v1/developer/instances/6650.../messages \
  -H "Authorization: Bearer <APP_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "919876543210",
    "type": "text",
    "message": "Hello from my application"
  }'
```

Media messages are supported too:

```bash
curl -X POST https://your-domain.com/api/v1/developer/instances/6650.../messages \
  -H "Authorization: Bearer <APP_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "919876543210",
    "type": "image",
    "url": "https://example.com/image.jpg",
    "caption": "Hello"
  }'
```

**Sending rules**

- `to` — phone number with country code (`919876543210`, `+91 98765-43210` and numeric values are all accepted)
  or a full JID such as `120363...@g.us` for groups.
- `url` (image / video / audio / document) must be a public **http(s)** URL. Anything else (local paths,
  `file://`, etc.) is rejected with `400`.
- `409` — the instance is not connected (call `/connect` and wait for `status: "connected"`).
- `400` — validation error. `502` — WhatsApp rejected or failed the send.

#### Get message history

Optional query params: `limit` (max 200), `number`, `direction` (`in` | `out`), `before` (ISO date, for paging).

```bash
curl "https://your-domain.com/api/v1/developer/instances/6650.../messages?limit=50" \
  -H "Authorization: Bearer <APP_SECRET>"
```

### 4.6 Webhook payload

For developer tenants, webhook events are scoped to the app and customer and include the tenant
metadata. Events: `message.received`, `message.sent` (only if the instance opted in to own messages)
and `instance.status`.

```json
{
  "event": "message.received",
  "instanceId": "6650...",
  "instanceName": "john-whatsapp",
  "appId": "...",
  "tenantId": "...",
  "externalUserId": "customer_123",
  "message": {
    "id": "wamid...",
    "from": "919876543210",
    "text": "Hello",
    "timestamp": "2026-09-24T12:00:00.000Z"
  },
  "direction": "in",
  "isLid": false,
  "isGroup": false,
  "groupId": null,
  "pushName": "John"
}
```

Status events (`connected`, `disconnected`, `logged_out`, `qr_expired`) are sent for developer instances:

```json
{
  "event": "instance.status",
  "instanceId": "6650...",
  "appId": "...",
  "tenantId": "...",
  "externalUserId": "customer_123",
  "status": "connected",
  "phoneNumber": "919876543210",
  "timestamp": "2026-09-24T12:00:00.000Z"
}
```

Headers sent by Wirebase:

```http
X-Wirebase-Event: message.received
X-Wirebase-Timestamp: 1727179200
X-Wirebase-Signature: sha256=<hex>
```

`X-Wirebase-Signature` = `sha256=` + `HMAC_SHA256(webhookSecret, "<timestamp>.<raw request body>")`,
where `webhookSecret` is the per-instance secret returned by `POST /tenants/:id/instances` and
`GET /instances/:id`. Always verify it on your backend, using the **raw** body, before trusting a payload:

```js
import crypto from 'crypto';
import express from 'express';

app.post('/webhooks/wirebase', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.header('X-Wirebase-Timestamp') || '';
  const sig = req.header('X-Wirebase-Signature') || '';
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WIREBASE_WEBHOOK_SECRET)
    .update(`${ts}.${req.body}`)           // req.body is the raw Buffer here
    .digest('hex');

  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300; // reject replays older than 5 min
  const valid = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid || !fresh) return res.sendStatus(401);

  const event = JSON.parse(req.body);
  // ... handle event ...
  res.sendStatus(200);
});
```

Respond with any `2xx` within 10 seconds. Failed deliveries are retried 3 times in total with
exponential backoff (1s, 2s); the final result is stored on the message (`webhookDelivered`, `webhookAttempts`).

### 4.7 Node.js example

```js
const axios = require('axios');

const APP_SECRET = process.env.WIREBASE_APP_SECRET;
const BASE = 'https://your-domain.com/api/v1/developer';

async function createTenant() {
  const res = await axios.post(`${BASE}/tenants`, {
    externalUserId: 'customer_123',
    name: 'John Doe',
    webhookUrl: 'https://api.acme.com/webhooks/wfirebase/customer_123'
  }, {
    headers: { Authorization: `Bearer ${APP_SECRET}` }
  });

  return res.data;
}

async function createInstanceForTenant(externalUserId) {
  const res = await axios.post(`${BASE}/tenants/${externalUserId}/instances`, {
    name: 'john-whatsapp'
  }, {
    headers: { Authorization: `Bearer ${APP_SECRET}` }
  });

  return res.data;
}

async function sendMessage(instanceId) {
  const res = await axios.post(`${BASE}/instances/${instanceId}/messages`, {
    to: '919876543210',
    type: 'text',
    message: 'Hello from my app'
  }, {
    headers: { Authorization: `Bearer ${APP_SECRET}` }
  });

  return res.data;
}
```

### 4.8 Python example

```python
import requests

APP_SECRET = "<APP_SECRET>"
BASE = "https://your-domain.com/api/v1/developer"

resp = requests.post(
    f"{BASE}/tenants",
    json={"externalUserId": "customer_123", "name": "John Doe"},
    headers={"Authorization": f"Bearer {APP_SECRET}"},
    timeout=30,
)
print(resp.json())
```

## 5. Docker deployment on an Ubuntu VPS

### Prerequisites on the VPS
```bash
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin
```

### Deploy with the project name `wirebaseapi`

For a stable container name and easier management, use:

```bash
git clone <your-repo-url> wirebaseapi
cd wirebaseapi
cp .env.example .env
nano .env   # set ADMIN_API_KEY, SESSION_SECRET, PUBLIC_BASE_URL to your real domain, etc.

docker compose -p wirebaseapi up -d --build
```

This gives you container names like:
- `wirebaseapi-app`
- `wirebaseapi-mongo`

Check logs / status:
```bash
docker compose -p wirebaseapi logs -f wirebaseapi
docker ps
```

Update after a git pull:
```bash
docker compose -p wirebaseapi up -d --build
```

### Putting it behind a domain with HTTPS
Baileys/WhatsApp and browsers both expect a real TLS certificate for anything public-facing.
Put Nginx (or Caddy, which auto-issues Let's Encrypt certs) in front of port 4000:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;   # required for Socket.IO websockets
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # required for Secure session cookies
    }
}
```
Then set `COOKIE_SECURE=true` and `PUBLIC_BASE_URL=https://your-domain.com` in `.env` so
session cookies are marked `Secure`, and restart: `docker compose -p wirebaseapi up -d --build`.
(`COOKIE_SECURE=true` also makes Express trust the first proxy hop; the `X-Forwarded-Proto` header
above is what lets it see the request as HTTPS. Without both, login cookies are silently never set.)

## 6. MongoDB collections

| Collection  | Purpose                                                                          |
|-------------|-----------------------------------------------------------------------------------|
| `users`     | Sub-admin accounts only (`role: "subadmin"`) — Admin itself has no row            |
| `instances` | One doc per WhatsApp connection: owner, name (unique per owner), status, webhook |
| `messages`  | Every inbound/outbound message + webhook delivery status                        |
| `apikeys`   | Hashed API keys per owner (the full key is never stored, only its sha256)        |
| `sessions`  | Login sessions (`connect-mongo`) — this is what replaces JWT                      |
| `developers` | Developer accounts and login data                                                  |
| `developerapps` | Developer app credentials and webhook configuration                              |
| `tenants`   | Tenant records scoped to a specific developer app                                 |

## 7. Free proxies & scaling notes

`src/services/proxyService.js` pulls candidate proxies from public lists, tests them, and keeps
a pool of the fastest ones; an instance with "use proxy" enabled gets one as its HTTP(S) agent.
Free proxies are inherently unreliable — treat as best-effort, swap in a paid provider for
anything real.

Baileys sockets live in-memory in a single Node process (`src/services/baileysManager.js`).
Running multiple app replicas would need a shared registry (e.g. Redis) so each WhatsApp
instance is only ever "owned" by one process — the current single-container setup is the right
starting point for one VPS.

On boot, the server automatically reconnects every previously-paired instance (status `connected` /
`disconnected` with a saved session), one per second. On `SIGTERM`/`SIGINT` sockets are closed
**without** logging out, so deploys and restarts don't unpair anyone's WhatsApp.