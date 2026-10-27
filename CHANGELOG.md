# Changelog

## Unreleased

**Security hardening** after a full review:

- The Lookup Callback only accepts a result Valari is waiting for, and only once. Clay answers are finished on the next Daily Run in one batch, which also keeps budgets accurate.
- A "confirmed" move must match what a lookup tool returned (`require_lookup_match`), so outside text can't talk the AI into a fake move. Draft openers no longer contain links.
- Slack and email alerts escape every outside value and only use plain http(s) links.
- Bounces only count when they come from a mail system.
- `do_not_contact` now also stops "call now" alerts.
- Google Sheets writes can't run as formulas.
- CI runs with read-only permissions; Dependabot added; `.env` and key files ignored.
- New Security notes on guard rails and data retention.

## 0.3.0 (2026-10-27)

- **Lookup waterfall**: up to three lookup tools in order; each person goes to the next tool only if the earlier ones couldn't find them.
- **Apollo connector** (new default lookup): only charges on a match, never requests phone numbers, and its new work email skips the email finder.
- **Clay connector** plus a **Lookup Callback** workflow, since Clay answers later.
- **Credit guardrails**: monthly budget per tool, a warning at 80%, results reused for 14 days, no repeat asks for 30 days after a miss, and the source of every answer recorded.
- The n8n template now uses Apollo instead of People Data Labs. People Data Labs stays as an optional connector.
- When Clay answers, the re-run keeps the bounce or auto-reply that started it, so "nothing found" still ends as [VERIFY].
- Setup docs and connector notes now say to **publish** every connector: n8n 2.x only lets scheduled and webhook-started runs call published workflows.

## 0.2.0

**Plug in your own tools.** The core no longer talks to any vendor directly. It calls connectors, one small workflow per tool, picked by ID in Config.

- New connector design with a documented [contract](docs/connectors.md).
- Connectors: Salesforce, Google Sheets (CRM or product-user list), Gmail (signals and alerts), People Data Labs, Hunter, Salesloft, Slack.
- **Persona scoring**: score moves by the people you care about (for example UX researchers), not only seniority. Every weight is configurable.
- **New work email**: finds the switcher's email at their new company.
- **CRM write-back**: creates a Contact on the account (or a Lead) and a Task for the owner.
- **Sequences**: enrolls confirmed switchers in a per-bucket cadence. The first step is a manual email a rep reviews.
- **"Call now" alerts**: a webhook for email opens, clicks, replies and website visits from a champion's new company.
- **Product users**: a second watchlist merged with the CRM by email.
- **Team directory**: Slack IDs and sequence users for owners, plus a default owner.
- Tracker state moved to n8n Data Tables, created automatically.
- Digest shows the funnel: investigated, confirmed, enrolled, meetings.
- **n8n template edition**: one self-contained workflow (Google Sheets, Gmail, People Data Labs, Slack, optional Hunter) for the n8n template library, generated from the same source.
- "Call now" event classification: website events like `page_view` are no longer mistaken for email opens.
- Lookup credential errors are reported as failures instead of "no matching profile".
- End-to-end tests against a real n8n instance (`npm run test:n8n`), including the template.

## 0.1.0

- First version: Google Sheets watchlist, Gmail bounce detection, People Data Labs lookup, AI investigator, Slack alerts, digest and MCP server.
