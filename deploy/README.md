# Cloudflare Tunnel (named tunnel) — recommended for the voip.ms webhook

The voip.ms SMS URL Callback needs a stable public HTTPS URL that routes to the
local backend. A Cloudflare Tunnel does this without opening router ports.

## 1. Install cloudflared

```bash
sudo apt install cloudflared     # or: https://pkg.cloudflare.com/cloudflared/
cloudflared tunnel login         # authorise with your Cloudflare account
cloudflared tunnel create voipms-sms
```

## 2. Point a hostname at your backend

In the Cloudflare dashboard (or DNS via cloudflared), create a CNAME for e.g.
`sms.example.com` -> `voipms-sms.cfargotunnel.com`. Then create an ingress rule
mapping that hostname to your local server:

```bash
cloudflared tunnel route dns voipms-sms sms.example.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: voipms-sms
credentials-file: /home/orangey/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: sms.example.com
    service: http://localhost:8317
  - service: http_status:404
```

## 3. Run cloudflared as a service

```bash
sudo cloudflared service install
```

## 4. Configure voip.ms to call your webhook

Set in `.env`:
```
WEBHOOK_KEY=<openssl rand -hex 32>
PUBLIC_WEBHOOK_URL=https://sms.example.com
```

Restart the backend, then open the app and use **Settings → "Apply webhook to DIDs"**
(or set it manually in the voip.ms portal per DID): enable **SMS URL Callback** and
use this URL (note: the backend appends `?key=…`; voip.ms substitutes the rest):

```
https://sms.example.com/api/webhook/inbound?to={TO}&from={FROM}&message={MESSAGE}&id={ID}&date={TIMESTAMP}&media={MEDIA}&key=<WEBHOOK_KEY>
```

Enable **URL Callback Retry** so missed deliveries (laptop asleep) are retried every
30 min; the polling fallback also catches anything missed on wake.

## Alternative: Tailscale Funnel

If you use Tailscale, `tailscale funnel 8317` exposes a stable `https://*.ts.net`
URL you can use in place of the Cloudflare hostname above.
