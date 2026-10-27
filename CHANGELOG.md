# Changelog

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
