# voipms-sms — Desktop SMS client for voip.ms

WhatsApp-style web UI (contacts left, thread right) for voip.ms SMS, running locally
on Ubuntu/GNOME and loaded in Firefox. A local Node backend holds your credentials,
talks to the voip.ms REST API, syncs contacts from your Nextcloud via CardDAV, and
delivers new messages instantly (voip.ms webhook over a Cloudflare Tunnel) with a
polling fallback. Notifications fire both natively (notify-send) and in the browser.

## Quick start

1. Copy `.env.example` to `.env` and fill in voip.ms + Nextcloud credentials.
2. Enable the voip.ms API and whitelist your IP (or set `0.0.0.0`):
   https://voip.ms/m/api.php
3. Install and run:

```bash
npm install
npm run build:web      # build the React UI into web/dist
npm run start          # serve UI + API on http://localhost:8317
```

Open http://localhost:8317 in Firefox. For instant delivery + auto-start, see
`deploy/README.md`.

## Layout

- `server/`  Node/TypeScript backend (voip.ms proxy, poller, webhook, CardDAV, SSE)
- `web/`     React + Vite + TypeScript frontend
- `deploy/`  systemd user unit, Cloudflare Tunnel example

See `TODO.md` for the build roadmap.
