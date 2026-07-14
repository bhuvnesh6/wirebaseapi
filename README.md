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

## 4. Docker deployment on an Ubuntu VPS

### Prerequisites on the VPS
```bash
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin
```

### Deploy
```bash
git clone <your-repo-url> wirebase
cd wirebase
cp .env.example .env
nano .env   # set ADMIN_API_KEY, SESSION_SECRET, PUBLIC_BASE_URL to your real domain, etc.

docker compose build
docker compose up -d
```

That's it — `docker-compose.yml` runs two containers:
- **`mongo`** — MongoDB 7, data persisted in the `mongo-data` volume, not exposed to the host
- **`app`** — this Node app, persisted Baileys sessions in the `sessions-data` volume, listening
  on port `4000`

Check logs / status:
```bash
docker compose logs -f app
docker compose ps
```

Update after a `git pull`:
```bash
docker compose build app
docker compose up -d app
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
session cookies are marked `Secure`, and restart: `docker compose up -d app`.

## 5. MongoDB collections

| Collection  | Purpose                                                                          |
|-------------|-----------------------------------------------------------------------------------|
| `users`     | Sub-admin accounts only (`role: "subadmin"`) — Admin itself has no row            |
| `instances` | One doc per WhatsApp connection: owner, name (unique per owner), status, webhook |
| `messages`  | Every inbound/outbound message + webhook delivery status                        |
| `apikeys`   | Hashed API keys per owner (the full key is never stored, only its sha256)        |
| `sessions`  | Login sessions (`connect-mongo`) — this is what replaces JWT                      |

## 6. Free proxies & scaling notes

`src/services/proxyService.js` pulls candidate proxies from public lists, tests them, and keeps
a pool of the fastest ones; an instance with "use proxy" enabled gets one as its HTTP(S) agent.
Free proxies are inherently unreliable — treat as best-effort, swap in a paid provider for
anything real.

Baileys sockets live in-memory in a single Node process (`src/services/baileysManager.js`).
Running multiple app replicas would need a shared registry (e.g. Redis) so each WhatsApp
instance is only ever "owned" by one process — the current single-container setup is the right
starting point for one VPS.
