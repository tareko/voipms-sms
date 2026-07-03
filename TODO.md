# MVP (Milestone 1) — polling delivery, verifiable without a public tunnel
- [x] Scaffold monorepo (root, server/, web/, deploy/)
- [x] Backend: config + .env, voip.ms client, SQLite store
- [x] Backend: poller (fallback + primary for MVP), CardDAV sync, phone matching
- [x] Backend: native notifier (notify-send), SSE hub
- [x] Backend: Express routes + serve built web UI
- [x] Frontend: Vite + React + TS scaffold, API client, SSE + notification hooks, zustand store
- [x] Frontend: WhatsApp-style UI (contact list, thread, composer, DID switcher)
- [x] Deploy: systemd user unit, cloudflared example, deploy README
- [x] Install deps, typecheck server + web, build web, smoke-run server

# Milestone 2 — instant delivery (webhook + tunnel)
- [ ] voip.ms SMS URL Callback configured via setSMS
- [ ] Cloudflare Tunnel (or Tailscale Funnel) → backend webhook route
- [ ] SSE live updates already wired; verify end-to-end
- [ ] Web Notifications click-to-thread behaviour

# Milestone 3 — polish + MMS
- [ ] MMS media viewing + sending
- [ ] Conversation search, per-contact mute, history backfill UI
