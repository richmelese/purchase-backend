# purchase-backend – API service

NestJS 12 API for the Purchase & Sales Management System (Ethiopian VAT, withholding, credit,
inventory, bank reconciliation and the VAT declaration). Data is stored in SQLite through Node's
built-in `node:sqlite`.

This service is **private**. Browsers talk only to the Next.js backend-for-frontend (BFF) in the
project root, which forwards `/api/*` here:

```
Browser ──► Next.js BFF (:3000) ──x-bff-secret──► this API (127.0.0.1:5000/api) ──► SQLite
```

- When `BFF_SHARED_SECRET` is set, every request except `GET /api/health` must carry the same value in
  the `x-bff-secret` header, or it gets a 403. Otherwise a startup warning is logged.
- CORS is off by default; the BFF calls server-to-server.
- `trust proxy` is enabled for loopback/private addresses, so the login lockout and the activity log
  see the client address that the BFF forwards in `X-Forwarded-For`.
- Sessions are an HttpOnly `psm_session` cookie. It is set here and passed through by the BFF
  unchanged, and gets the `Secure` flag when the BFF reports HTTPS (`X-Forwarded-Proto`).

## Layout

```
src/
├── main.ts              HTTP bootstrap (BFF secret check, body parsers, /api prefix)
├── env.ts               loads .env
├── app.module.ts        module wiring, database path, global guards / interceptor / filter
├── modules/<feature>/   controller + service per area (auth, users, roles, invoices, parties,
│                        products, inventory, vat, withholding, credit, reports, lookups,
│                        settings, import-export, reconciliation, audit)
├── common/              auth & role guards, decorators, error filter, tax / Ethiopian-calendar rules
├── entities/            table definitions
├── orm/                 small repository layer over node:sqlite (schema + migrations in data-source.ts)
└── cli/                 command-line tools that reuse the services (workbook import, demo data)
tests/
├── calc.test.mjs        tax and calendar rules
└── api.test.mjs         end-to-end: starts the server on a temporary database and calls it over HTTP
```

## Commands

From the project root, `npm run dev` starts this API together with the UI. To work on the API alone:

```bash
npm install
npm run dev            # tsc --watch + auto-restart on http://127.0.0.1:5000/api
npm test               # build + all tests
npm run build && npm start
npm run import -- "C:\path\to\All In One Sales.xlsx"
npm run demo           # / npm run demo:remove
```

## Configuration (`.env`, see `.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `5000` / `127.0.0.1` | Listen address. Docker uses `0.0.0.0` on the private network. |
| `DATABASE_PATH` | `../data/psm.db` | SQLite file. |
| `BFF_SHARED_SECRET` | – | Secret the BFF must send. Always set it in production. |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Express `trust proxy` setting. |
| `CORS_ORIGIN` | – | Comma-separated origins, only for API tooling. |
