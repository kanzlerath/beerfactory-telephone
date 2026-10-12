# Beer Factory Telephone

HTTP adapter between Fine Numbers and RestoPlace telephony.

## Flow

Fine Numbers -> `POST /finenumbers/webhook` -> adapter -> RestoPlace.

Supported incoming call mapping:

- `INCOMING` -> `call`
- `ACCEPTED` -> `talking`
- `COMPLETED` -> `ended`
- `CANCELLED` -> `missed`
- `history / Success` -> `ended` fallback
- `history / Missed|Cancel` -> `missed` fallback

Outgoing calls and transfers are ignored.

Phone normalization includes Novosibirsk landlines:

- `1234567` -> `73831234567`
- `3831234567` -> `73831234567`
- `8XXXXXXXXXX` -> `7XXXXXXXXXX`

## Deploy

```bash
git clone https://github.com/kanzlerath/beerfactory-telephone.git
cd beerfactory-telephone
cp .env.example .env
nano .env
docker compose up -d --build
```

Set these values in `.env`:

```env
FINE_TOKEN=...
RESTOPLACE_SECRET=...
```

The container is exposed only on localhost:

```text
127.0.0.1:3100
```

Health check:

```bash
curl http://127.0.0.1:3100/health
```

Expected:

```json
{"ok":true}
```

Logs:

```bash
docker compose logs -f
```

## Nginx

Use an existing HTTPS virtual host and add a dedicated location:

```nginx
location = /__telephony/finenumbers {
    proxy_pass http://127.0.0.1:3100/finenumbers/webhook;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_read_timeout 15s;
}
```

Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Point Fine Numbers "CRM address" to:

```text
https://YOUR_EXISTING_HTTPS_DOMAIN/__telephony/finenumbers
```

Keep the Fine Numbers "CRM authorization key" equal to `FINE_TOKEN`.

## Test

Replace the URL/token as needed:

```bash
curl -X POST "https://YOUR_EXISTING_HTTPS_DOMAIN/__telephony/finenumbers" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "cmd=event&type=INCOMING&direction=in&phone=1234567&ext=301&callid=vps-test-001&crm_token=YOUR_FINE_TOKEN"
```

Then finish the test call:

```bash
curl -X POST "https://YOUR_EXISTING_HTTPS_DOMAIN/__telephony/finenumbers" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "cmd=event&type=COMPLETED&direction=in&phone=1234567&ext=301&callid=vps-test-001&crm_token=YOUR_FINE_TOKEN"
```
