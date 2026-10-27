# Security

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's **Report a vulnerability** button on the repository's Security tab to report privately. You'll get a reply within a few days.

## How the project handles data

- Valari runs entirely inside your own n8n instance. It has no server of its own and sends nothing to the maintainers.
- API keys live in n8n credentials, never in the workflow files. The exported workflows contain no credentials at all; you add your own after importing.
- The Call Now webhook, the Lookup Callback and the MCP server all require authentication (Header Auth or Bearer Auth). If no credential is set, n8n rejects every request. Keep those secrets private and rotate them if they leak.
- The Lookup Callback only accepts a result Valari is waiting for, and only once, so a replayed or forged call can't overwrite data or trigger alerts.
- The AI model sees the person's name, old company, notes from your CRM and the lookup result. Choose a model provider whose data terms fit your policies, or run a local model.

## Guard rails against untrusted input

Bounce emails, auto-replies, lookup results, CRM notes and webhook payloads all come from outside, and some of that text reaches the AI agent. Valari limits what it can do with it:

- The agent has no tools that take actions. It returns a fixed set of fields, and the code checks them.
- A "confirmed" move must name a company that a lookup tool actually returned (`require_lookup_match`). Otherwise it becomes [VERIFY] for a person to check.
- Links are removed from draft openers, and evidence is length-capped.
- Every outside value is escaped before it goes into Slack or email, so it can't add links, @channel pings or mentions. Only plain `http(s)` links are used.
- A bounce only counts if it comes from a mail system (mailer-daemon or postmaster).
- Values written to Google Sheets can't run as formulas.
- People marked `do_not_contact` are never investigated, and their "call now" alerts stop.
- Monthly budgets cap what each lookup tool can spend, even if someone floods the inbox with fake signals.

## Data you keep

- Tracker state lives in n8n Data Tables (`valari_state`, `valari_cases`, `valari_lookups`, `valari_usage`) in your instance. Delete rows you no longer need.
- n8n saves execution data, including webhook headers and lookup results. Turn on execution pruning (`EXECUTIONS_DATA_PRUNE=true`, with `EXECUTIONS_DATA_MAX_AGE` in hours) so it isn't kept forever.
