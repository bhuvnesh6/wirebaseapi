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
  -H "Cookie: wfirebase.sid=<session-cookie>" \
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
    "externalUserId": "customer_123"
  }
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

#### Get message history
```bash
curl "https://your-domain.com/api/v1/developer/instances/6650.../messages?limit=50" \
  -H "Authorization: Bearer <APP_SECRET>"
```

### 4.6 Webhook payload

For developer tenants, webhook events are scoped to the app and customer and include the tenant
metadata when available.

```json
{
  "event": "message.received",
  "instanceId": "6650...",
  "externalUserId": "customer_123",
  "message": {
    "id": "wamid...",
    "from": "919876543210",
    "text": "Hello",
    "timestamp": "2026-09-24T12:00:00.000Z"
  }
}
```

Headers sent by Wirebase:

```http
X-Wirebase-Event: message.received
X-Wirebase-Timestamp: 1727179200
X-Wirebase-Signature: sha256=...
```

The signature is HMAC-based and should be checked on your backend before trusting the payload.

### 4.7 Node.js example

```js
const axios = require('axios');

const APP_SECRET = process.env.WIFIREBASE_APP_SECRET;
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
    }
}
```
Then set `COOKIE_SECURE=true` and `PUBLIC_BASE_URL=https://your-domain.com` in `.env` so
session cookies are marked `Secure`, and restart: `docker compose -p wirebaseapi up -d --build`.

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
