# 0148 — Tuck the API / push-contacts block into an "Advanced" section (and label the URL copy)

## Status

Accepted — implemented. From early customer feedback (Wave 2).

## Context

Feedback on the contacts/integrations experience: the **API keys** and **"Push
contacts to your account" (POST … `curl`)** blocks were **too technical and too
prominent**. On the Integrations page they sat at the same visual level as the
one-click CRM connectors (Brevo / HubSpot / Zapier), so a non-technical owner —
the majority — was met with API keys and a raw `curl` snippet as if they were a
primary path.

The same feedback flagged the **copy button**: it *"copies a curl command when
the user expected a URL."* The endpoint's copy button used the default label
(`"Copy"`) while the example's was labelled `"Copy curl"`, so it wasn't obvious
which button copied the plain endpoint URL versus the whole curl command.

## Decision

- **Collapse the technical bits into an "Advanced — API access" `<details>`**,
  closed by default, below the CRM connectors. Non-developers see a single quiet
  line ("For developers: push contacts in from your own systems with an API
  key"); developers click to expand the API-key management + push endpoint + curl
  example exactly as before.
- **Label the endpoint copy button `"Copy URL"`** so the two copy actions are
  unambiguous: **Copy URL** next to the endpoint, **Copy curl** next to the
  example.

## Consequences

- The Integrations page now leads with the connectors an ordinary user actually
  wants; the API surface is present and complete but no longer competes for
  attention or reads as "you need to be a developer".
- The copy buttons say what they copy, resolving the "expected a URL, got curl"
  confusion.
- Purely presentational (a `<details>` wrapper + one button label); no route,
  API, or dependency change. The API-key and push-contacts functionality is
  unchanged.

## Note

The feedback described this as the "Recipients page" block; the API/push UI
actually lives on the **Integrations** page (reached from the Contacts page's
"Sync a CRM" link). This ADR fixes it where it lives.
