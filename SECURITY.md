# Security

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's **Report a vulnerability** button on the repository's Security tab to report privately. You'll get a reply within a few days.

## How the project handles data

- Valari runs entirely inside your own n8n instance. It has no server of its own and sends nothing to the maintainers.
- API keys live in n8n credentials, never in the workflow files. Exported workflows reference credentials by name only.
- The Call Now webhook and the MCP server both require authentication (Header Auth and Bearer Auth). Keep those secrets private and rotate them if they leak.
- The AI model sees the person's name, old company, notes from your CRM and the lookup result. Choose a model provider whose data terms fit your policies, or run a local model.
