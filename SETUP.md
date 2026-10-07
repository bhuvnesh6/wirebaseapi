# Setup

Two paths: **local development** (Node + a local/Atlas MongoDB) or **Docker on a VPS**
(recommended for actually running this). Commands for both below.

---

## Option A — Local development

### 1. Prerequisites
- Node.js 20+
- MongoDB running locally, or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster

### 2. Install and configure
```bash
git clone <your-repo-url> wirebase
cd wirebase
npm install
cp .env.example .env
```

Open `.env` and set at least these:
```bash
MONGO_URI=mongodb://127.0.0.1:27017/wirebase
ADMIN_API_KEY=$(openssl rand -hex 24)          # or just paste any long random string
SESSION_SECRET=$(openssl rand -hex 24)
PUBLIC_BASE_URL=http://localhost:4000
```
(The `$(openssl rand -hex 24)` snippets only work if you paste them into a shell, not directly
into the `.env` file — run `openssl rand -hex 24` once, copy the output, paste it as the value.)

### 3. Run
```bash
npm run dev      # nodemon, auto-restarts on file changes
# or:
npm start        # plain node
```

### 4. Open it
Visit `http://localhost:4000` → log in on the **Admin** tab using the `ADMIN_API_KEY` you set.
From there: create your first instance, scan the QR code, and (optionally) create sub-admins
from the Sub-admins page.

---

## Option B — Docker on an Ubuntu VPS (recommended for real use)

### 1. Install Docker on the VPS (skip if already installed)
```bash
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin
```

### 2. Get the code onto the VPS
```bash
git clone <your-repo-url> wirebase
cd wirebase
```

### 3. Configure environment
```bash
cp .env.example .env
nano .env
```
Set at minimum:
```bash
ADMIN_API_KEY=<a long random string — run: openssl rand -hex 24>
SESSION_SECRET=<a different long random string>
PUBLIC_BASE_URL=https://your-domain.com        # or http://<vps-ip>:4000 if you don't have a domain yet
```
Leave `MONGO_URI` as-is — `docker-compose.yml` overrides it to point at the `mongo` container
automatically.

### 4. Build and start
```bash
docker compose build
docker compose up -d
```

### 5. Verify it's running
```bash
docker compose ps
docker compose logs -f app       # Ctrl+C to stop tailing (containers keep running)
curl http://localhost:4000/api/health   # → {"ok":true}
```

Visit `http://<your-vps-ip>:4000` (or your domain once step 6 is done) and log in with the
`ADMIN_API_KEY` you set.

### 6. (Recommended) Put it behind HTTPS with a real domain
Point your domain's DNS `A` record at the VPS, then either:
- **Caddy** (auto-HTTPS, simplest): install Caddy, and use a Caddyfile with
  `your-domain.com { reverse_proxy localhost:4000 }`.
- **Nginx + Certbot**: see the full reverse-proxy config in `README.md` section 4.

After DNS + HTTPS are working, update `.env`:
```bash
PUBLIC_BASE_URL=https://your-domain.com
COOKIE_SECURE=true
```
then:
```bash
docker compose up -d app
```

### 7. Common day-2 commands
```bash
# View logs
docker compose logs -f app

# Restart after editing .env
docker compose up -d app

# Redeploy after a `git pull`
docker compose build app
docker compose up -d app

# Stop everything (data volumes are preserved)
docker compose down

# Full reset (⚠ deletes MongoDB data AND all linked WhatsApp sessions)
docker compose down -v
```

---

## What each secret actually protects

| Variable          | If leaked...                                                                 |
|--------------------|-------------------------------------------------------------------------------|
| `ADMIN_API_KEY`   | Attacker gets full Admin access — every instance, every sub-admin, everything |
| `SESSION_SECRET`  | Attacker could forge session cookies and impersonate any logged-in account   |
| API keys (in-app) | Attacker can send WhatsApp messages through whichever instance that key owns |

Treat `.env` like a password file. It's already excluded from git via `.gitignore` — never
commit a real `.env`, only `.env.example`.
