# Kudos Cards — Zapier integration

A [Zapier Platform](https://platform.zapier.com/) app that lets anyone push contacts
into Kudos Cards from any of Zapier's 6,000+ apps — the no-code end of the CRM
integration story (see `docs/adr/0015-crm-integrations.md`, the long-tail lane).

It's a thin front door over the existing inbound endpoint: every action just calls
`POST /integrations/contacts` with the customer's per-account API key, so the hard
parts (mapping, dedupe, plan cap, audit) are the same ones the API already enforces.

## What it does

- **Authentication** — API key. The customer pastes a `kudos_…` key created on their
  Kudos **Integrations** page. It's validated against `GET /integrations/me`, which
  also labels the connection with the account name.
- **Action: _Create or Update Recipient_** — maps a contact from any Zap into a Kudos
  recipient. Re-sending the same **External ID** updates rather than duplicates
  (one-way import; Kudos never writes back).

## Layout

```
integrations/zapier/
├─ index.js               # App definition (auth, creates, x-api-key middleware)
├─ authentication.js      # API-key auth + connection test (GET /integrations/me)
├─ creates/
│  └─ create-recipient.js # POST /integrations/contacts
├─ constants.js           # API base URL (override with KUDOS_API_BASE_URL)
└─ test/                  # offline unit tests (node:test, no network)
```

## Develop & test

The unit tests run with plain Node — no install, no network:

```bash
cd integrations/zapier
node --test
```

## Publish (one-time, done by a Kudos admin)

Requires a [Zapier developer account](https://developer.zapier.com/) and the Zapier CLI.

```bash
npm install -g zapier-platform-cli
cd integrations/zapier
npm install                 # pulls zapier-platform-core for the CLI
zapier login
zapier register "Kudos Cards"   # first time only — creates the app in Zapier
zapier push                     # upload this version
```

Then, in the Zapier app settings, invite testers or submit for public listing.
To point a build at a non-production API during testing:

```bash
KUDOS_API_BASE_URL="https://staging-host" zapier push
```

## How a customer uses it

1. In Kudos → **Integrations** → create an API key (copy it — shown once).
2. In Zapier, add a **Kudos Cards → Create or Update Recipient** step to a Zap.
3. Connect the account by pasting the API key.
4. Map the trigger's fields (name, email, DOB, address) to the recipient fields.
   Set **External ID** to a stable id from the source so re-runs update, not duplicate.
