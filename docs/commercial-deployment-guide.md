# AI XiaoBao Academy Commercial Deployment Guide

## Required Cloud Settings

Set these on the Web/API server before launch:

```env
NODE_ENV=production
DESKTOP_AUTH_MODE=cloud
CENTRAL_AUTH_BASE_URL=https://your-domain.example
XIAOBAO_CLOUD_API_URL=https://your-domain.example
CENTRAL_ACCOUNT_SYNC_SECRET=replace-with-a-long-random-secret

JWE_SECRET=replace-with-a-long-random-secret
ENCRYPTION_KEY=replace-with-a-long-random-secret

DB_PROVIDER=drizzle
DATABASE_PATH=data/app.db

CREDIT_PRICE_CENTS=10
CREDITS_SIGNUP_BONUS=20
CREDITS_COST_CHAT=1
CREDITS_COST_TASK=10
CREDITS_COST_IMAGE=8
CREDITS_COST_MUSIC=30
CREDITS_COST_VIDEO=180

DOWNLOAD_WINDOWS_PATH=/opt/ai-xiaobao/public/downloads/AI-XiaoBao-Academy-Windows.zip
```

## Account Rules

- New users must register with an 11-digit mainland China phone number.
- Registration requires SMS verification.
- One phone number can only create one account.
- The signup bonus is granted once after successful registration.
- Desktop login/register uses the same cloud account service as the website.
- Desktop task usage consumes the same cloud credit balance when `CENTRAL_ACCOUNT_SYNC_SECRET` is configured on both sides.

## SMS Configuration

Verification codes are delivered through Tencent Cloud SMS. Before launch set all three values
from the Tencent Cloud SMS console on the server:

```env
TENCENT_SMS_APP_ID=1400000000
TENCENT_SMS_SIGN_NAME=AI小宝学院
TENCENT_SMS_TEMPLATE_ID=1234567
```

- The signing name must be approved in the Tencent Cloud SMS console first.
- The template must contain a single verification-code placeholder, e.g. `您的验证码为{1}，5分钟内有效。`.
- `TCB_SECRET_ID` / `TCB_SECRET_KEY` are reused as the SMS API credentials.

### Development placeholder mode

Before real SMS credentials are available, set `SMS_MOCK=1` to run the whole registration flow
without sending anything. The verification code is fixed to `123456`, and the login page shows a
hint. **Never enable `SMS_MOCK` in production.**

```env
SMS_MOCK=1
```

## Suggested Commercial Pricing

The default model uses `1 credit = RMB 0.10`.

- Chat: 1 credit
- Coding/project task: 10 credits
- Image: 8 credits
- Music: 30 credits
- Video: 180 credits

This keeps video usage safer under publicly visible Tencent Cloud and Volcengine pricing ranges, but you should still update the environment variables after confirming your final API package invoice.

## Windows App Download

Place the Windows installer at:

```text
/opt/ai-xiaobao/public/downloads/AI-XiaoBao-Academy-Windows.zip
```

Then the website download button can use:

```text
/api/download/win
```

## Desktop Release Config

Before rebuilding the commercial desktop installer, update:

```text
resources/desktop-config.json
```

Set:

```json
{
  "desktopAuthMode": "cloud",
  "centralAuthBaseUrl": "https://your-domain.example",
  "xiaobaoCloudApiUrl": "https://your-domain.example",
  "centralAccountSyncSecret": "same-secret-as-server"
}
```

Keep the sync secret private. Do not publish it in frontend code or public docs.

### Configuration order before public launch

The desktop build ships with `desktopAuthMode: cloud` and empty central URLs. With the URLs empty
the desktop app starts normally but blocks login/register with a "Desktop cloud account service is
not configured" message. This is intentional: it prevents a shipped build from silently falling back
to a local-only account database.

To make a build usable, complete the cloud side first and then rebuild the installer:

1. Deploy the Web/API service and set `CENTRAL_AUTH_BASE_URL` / `XIAOBAO_CLOUD_API_URL` on it.
2. Configure real SMS credentials (`TENCENT_SMS_*`) or `SMS_MOCK=1` for testing.
3. Fill `resources/desktop-config.json` with the deployed origin and the shared sync secret.
4. Re-run `pnpm build:electron` and re-distribute the installer.

Until step 1 is done, use `desktopAuthMode: "local"` only for private development builds
(never for a distributed installer).

## Recommended Lightweight Server Deployment

Use Node.js 22 if deploying without Docker.

### Option A: Docker

From the unzipped project folder:

```bash
docker build -t ai-xiaobao-academy:commercial .
docker run -d --name ai-xiaobao \
  --restart unless-stopped \
  -p 80:80 \
  --env-file .env.production \
  -v /opt/ai-xiaobao/data:/app/packages/server/data \
  -v /opt/ai-xiaobao/public/downloads:/opt/ai-xiaobao/public/downloads \
  ai-xiaobao-academy:commercial
```

### Option B: Node.js 22 + pnpm

From the unzipped project folder:

```bash
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm install --prod --ignore-scripts
cp .env.production.example .env.production
node packages/server/dist/index.js
```

For manual Node deployment, keep this folder layout:

```text
packages/server/dist
packages/server/migrations
packages/web/dist
```

The server uses that structure to find the database migrations and serve the web app.
