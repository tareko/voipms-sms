# voipms-sms — Desktop SMS/MMS client for voip.ms

A WhatsApp-style web UI (contacts left, thread right) for voip.ms SMS and MMS,
running locally on Ubuntu/GNOME and loaded in Firefox. A local Node backend
holds your credentials, talks to the voip.ms REST API, syncs contacts from your
Nextcloud via CardDAV, polls for new messages, and pushes them to the browser
live over SSE. Notifications fire natively (as "Voip.ms text", with a phone
icon) and in the browser.

## Features

- **Two-pane UI** — searchable contact list on the left, conversation thread on
  the right; switch between multiple voip.ms DIDs.
- **SMS + MMS** — send and receive text and **image** messages. Images are
  auto-resized client-side to fit voip.ms's ~1.2 MB cap; messages over 160
  characters auto-upgrade to MMS (2048-char limit).
- **Reactions (iMessage / Android interop)** — incoming tapbacks
  (`Loved/Liked/Disliked/Laughed at/Emphasized/Questioned`, including the iOS 16+
  inline-emoji form) render as emoji badges on the reacted message instead of
  `Liked "…"` text bubbles. React to any message via a hover picker; a one-shot
  backfill converts existing reaction texts in history.
- **Emoji** — a searchable picker plus WhatsApp-style `:shortcod` autocomplete.
- **Optimistic send** — messages send instantly with a per-bubble status icon:
  ⏳ sending → ✓ sent → ⚠ failed (click to retry); hover for a legend.
- **Contacts** — CardDAV sync from Nextcloud (only FN/TEL requested, so tens of
  thousands of contacts sync in seconds) with fuzzy phone-number matching.
- **Notifications** — GNOME notifications attributed to **Voip.ms text** with a
  phone icon (via a freedesktop `.desktop` entry), plus browser Web
  Notifications with click-to-thread.
- **Live updates** — new messages flow to open tabs over Server-Sent Events,
  with a configurable polling fallback.
- **Local-first** — credentials never reach the browser; the backend is the only
  thing that talks to voip.ms / Nextcloud. Optional instant delivery via voip.ms
  SMS webhook over a Cloudflare/Tailscale tunnel (`deploy/`).

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
`deploy/README.md`. For GNOME notifications to appear as "Voip.ms text" with the
phone icon, run once:

```bash
deploy/install-desktop.sh
```

## Layout

- `server/`  Node/TypeScript backend (voip.ms proxy, poller, webhook, CardDAV, MMS media cache, SSE)
- `web/`     React + Vite + TypeScript frontend
- `assets/`  app icon
- `deploy/`  systemd user unit, Cloudflare Tunnel guide, desktop-entry installer

See `TODO.md` for the build roadmap.

## License

Copyright (C) 2026 Tarek Loubani. This program is free software: you can
redistribute it and/or modify it under the terms of the **GNU Affero General
Public License v3.0** as published by the Free Software Foundation. See
[LICENSE](./LICENSE) for the full text.
