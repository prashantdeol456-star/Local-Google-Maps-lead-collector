# n8n integration (optional)

The platform works without n8n. Use it when you want to automate things around your leads:
add new leads to Google Sheets or a CRM, get a Slack/Telegram alert on every reply, sync
opt-outs to another system, and so on.

There are two directions:

| Direction | How | Set up in |
|---|---|---|
| Platform → n8n | Signed webhooks for events (new lead, reply, opt-out…) | Admin → **Integrations** → Webhooks |
| n8n → Platform | REST API with an API token (read-only recommended) | Admin → **Integrations** → API tokens |

n8n never gets provider keys (Resend, Meta, Anthropic…), and it cannot change the webhook
or token settings: those can only be changed in the admin panel.

## 1. Run n8n locally

Either way is fine:

- `npx n8n`, which runs on this computer and listens on `http://localhost:5678`.
- Docker: `docker run -it --rm -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n`

> The backend listens on `127.0.0.1` only. A **Docker** n8n can receive webhooks from it
> (they go to `localhost:5678`), but it cannot call the backend's API unless you change
> `HOST`. That exposes the backend to your network, so only do it behind a firewall. For
> API calls from n8n, running n8n with `npx` is simpler.

## 2. Receive events (Platform → n8n)

1. In n8n create a workflow with a **Webhook** node:
   - HTTP Method: `POST`
   - Authentication: **Header Auth**. Create the credential with Name `X-Lead-Platform-Token`;
     the Value is the signing secret from step 3.
   - Respond: *Immediately*. The platform only needs a 2xx answer.
2. Copy the node's **Test URL** while you build the workflow, or the **Production URL**
   after you publish it. Test URLs only work while n8n is listening for a test event.
3. Admin → Integrations → **Add webhook**: paste the URL and choose the events. The
   signing secret is shown **once**: put it in the Header Auth credential.
4. Press **Send test**. n8n receives a `ping` event.

### Event format

Every request is a JSON `POST`:

```json
{
  "id": "lead.created:cmuw…",
  "type": "lead.created",
  "createdAt": "2026-10-06T10:15:00.000Z",
  "data": { "…": "see below" }
}
```

`id` stays the same if a delivery is retried. Deliveries are *at least once*, so use `id`
to ignore an event you have already handled.

| Header | Meaning |
|---|---|
| `X-Lead-Platform-Event` | event type |
| `X-Lead-Platform-Event-Id` | same as `id` in the body |
| `X-Lead-Platform-Delivery` | this delivery's id |
| `X-Lead-Platform-Timestamp` | unix seconds when it was sent |
| `X-Lead-Platform-Signature` | `v1=` + hex HMAC-SHA256 of `"<timestamp>.<raw body>"` with the secret |
| `X-Lead-Platform-Token` | the secret itself, for n8n's Header Auth |

### Events

| Type | `data` |
|---|---|
| `lead.created` | `lead` (id, name, category, phone, email, website, address, city, state, country, postalCode, latitude, longitude, rating, reviewCount, mapsUrl, placeId, searchKeyword, source, createdAt), `jobId`. Duplicates are not sent. |
| `collection.finished` | `job` (id, searchKeyword, location, maxRecords, status `completed` / `stopped` / `failed`, statusReason, totalFound, newRecords, duplicateRecords, errorRecords, startedAt, completedAt, createdAt) |
| `campaign.completed` | `campaign` (id, channel, name, provider, startedAt, completedAt, `counts` by status) |
| `reply.received` | `reply` (channel `whatsapp` / `email`, from, text, receivedAt, campaignId; WhatsApp also profileName and messageType), `lead` (id, name) or null for unknown numbers |
| `optout.recorded` | `optOut` (channel, address, reason, source, recordedAt), `lead` (id, name) or null |
| `ping` | `message`, sent only by the **Send test** button |

### Retries

A non-2xx answer, a timeout (10 s) or a connection error is retried after 1, 5, 15 and
60 minutes, and then marked **failed**. Redirects are not followed. The delivery log
(Integrations → Log) shows every attempt; **Send now** resends one. A disabled webhook
receives nothing.

### Stricter check: verify the signature (optional)

Header Auth is enough when n8n runs on the same machine or behind HTTPS. To also reject
replays and changed bodies, check the signature against the **raw** request body (not the
re-serialized JSON):

1. Take `X-Lead-Platform-Timestamp` (`ts`) and the raw body as text.
2. Compute `"v1=" + hex(HMAC-SHA256(secret, ts + "." + rawBody))`.
3. Accept only if it equals `X-Lead-Platform-Signature` and `ts` is within 5 minutes.

Example for a small Node.js receiver (the same check the platform's tests use):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function isGenuine(secret, headers, rawBody) {
  const ts = headers["x-lead-platform-timestamp"];
  const expected = Buffer.from("v1=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex"));
  const given = Buffer.from(String(headers["x-lead-platform-signature"] ?? ""));
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
  return fresh && given.length === expected.length && timingSafeEqual(given, expected);
}
```

In n8n this means turning on the Webhook node's *Raw Body* option and computing the HMAC
in a Code node (n8n blocks `require("crypto")` unless `NODE_FUNCTION_ALLOW_BUILTIN=crypto`
is set) or with the Crypto node. How a Code node reads the raw body depends on your n8n
version and binary-data settings, so check n8n's Code node docs for that part.

## 3. Read data from the platform (n8n → Platform)

1. Admin → Integrations → **API tokens** → Create token. *Read only* is recommended. Copy the
   token; it is shown once.
2. In n8n add an **HTTP Request** node with Authentication **Header Auth**, Name
   `Authorization`, Value `Bearer mlp_…`.
3. Useful GET endpoints (base URL `http://localhost:3000`):
   - `/api/leads?page=1&pageSize=100&city=Lucknow&q=…`: leads, paginated
   - `/api/leads/<id>` and `/api/leads/<id>/communications`
   - `/api/export/csv` and `/api/export/xlsx` (same filters as the Leads page)
   - `/api/stats`, `/api/jobs`, `/api/email/campaigns`, `/api/whatsapp/campaigns`

A read-only token gets `403` for anything that is not a GET, and for token and integration
settings. Revoke a token at any time on the Integrations page.

## Rules that still apply

- Campaign messages are sent only by the platform's own queues, with their pacing, opt-in
  and opt-out checks. Do not use n8n to message leads directly around those checks.
- Opt-outs (`optout.recorded`) should also stop any messaging you do in other tools.
- Nothing is ever sent back to a person automatically: replies reach n8n so *you* can
  decide what to do.
