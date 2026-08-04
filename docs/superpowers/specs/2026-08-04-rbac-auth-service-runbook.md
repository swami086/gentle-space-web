# Runbook: Google OAuth Client + RS256 keypair setup

One-time manual setup required before `auth-service` can authenticate real users. Neither step can be
automated by an agent (both require a human with access to the Google Cloud Console / production
secrets store).

## 1. Google Cloud OAuth 2.0 Client

1. Open [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create Credentials → OAuth client ID → Application type **Web application**.
3. Authorized redirect URIs:
   - Production: `https://auth.gentlespacesolutions.com/api/auth/callback/google`
   - Local dev: `http://localhost:3040/api/auth/callback/google`
4. Copy the generated Client ID / Client Secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   (`.env.local` for dev, the production secrets store for deploy — see Task 4's
   `docker-compose.prod.yml` env var names).
5. If this is a brand-new Google Cloud project, also enable the "Google People API" (used by the
   default OpenID Connect scopes for profile/email) under APIs & Services → Library.

## 2. RS256 keypair (the `gs_session` JWT signing key)

Generate once per environment (dev keypair and production keypair should differ):

```bash
node -e "
const { generateKeyPairSync } = require('crypto');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
console.log('AUTH_JWT_PRIVATE_KEY_PEM=' + priv.replace(/\n/g, '\\n'));
console.log('AUTH_JWT_PUBLIC_KEY_PEM=' + pub.replace(/\n/g, '\\n'));
"
```

Store `AUTH_JWT_PRIVATE_KEY_PEM` as a production secret (never commit it). `AUTH_JWT_PUBLIC_KEY_PEM` is
not secret (it's served publicly at `/.well-known/jwks.json`), but keep both vars sourced the same way
for simplicity. `AUTH_JWT_KID` is any stable string identifier (e.g. `auth-service-key-1`) — bump it
only if you rotate to a new keypair (see the design spec's Non-goals re: manual-only key rotation).

## 3. `AUTH_SECRET` (Auth.js's own internal cookie encryption)

```bash
openssl rand -base64 32
```

## 4. `INTERNAL_API_KEY` (shared secret between `ads-agent` and `auth-service`)

Any random string is fine, e.g. `openssl rand -hex 32`. Set the same value as
`INTERNAL_API_KEY` in `auth-service` and `AUTH_SERVICE_INTERNAL_API_KEY` in `ads-agent`.

## 5. `ADMIN_BOOTSTRAP_EMAILS`

Comma-separated list of the Gmail address(es) that should become admin on their very first login
(e.g. your own Google Workspace email). Every role change after the first login happens through
`ads-agent`'s `/users` page (Task 11), not by editing this list again.
