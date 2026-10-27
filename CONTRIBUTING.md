# Contributing

Thanks for helping. The most useful contributions right now:

1. **New connectors**: HubSpot, Outlook, Microsoft Teams, Apollo, Outreach and the others in the README table. Each one is a small, self-contained workflow.
2. **Bug reports** with the n8n version, the connector involved and what happened.
3. **Field-tested defaults**: Gmail search queries that catch more bounce formats, better persona keywords, scoring that worked for your team.

## How the repo is built

The workflow files in `workflows/` are **generated**. Don't edit the JSON by hand:

- `src/core/` and `src/connectors/`: the logic inside Code nodes, as plain JavaScript with unit tests.
- `prompts/`: the agent's system prompt.
- `scripts/core.js` and `scripts/connectors.js`: build each workflow's nodes and connections.
- `scripts/template.js`: builds the single-workflow n8n template in `templates/` from the same logic.
- `scripts/build-workflows.js`: writes `workflows/**.json` and the template.

```bash
npm install
npm test          # unit tests
npm run build     # regenerate workflows/ and the sheet template (needs python3 + openpyxl)
npm run check     # CI: fails if workflows/ or templates/ is out of date
```

Lines between `// @node-only-start` and `// @node-only-end` are for Node only (requires and exports). The build strips them when it inlines a file into a Code node.

## Adding a connector

Follow the [connector contract](docs/connectors.md). The quickest route:

1. Build and test the connector in n8n, starting from the closest existing one.
2. Add a builder function for it in `scripts/connectors.js` (copy a similar one) so it's generated like the rest. If it has real logic in a Code node, put that logic in `src/connectors/` and add a test in `test/connectors.test.js`.
3. Run `npm test`, `npm run build` and, if you can, `npm run test:n8n` against a throwaway n8n instance.
4. Add it to the connector table in the README.

Not comfortable with the build scripts? Open a pull request with your exported workflow JSON in `workflows/connectors/` and a maintainer will port it.

## End-to-end tests

`npm run test:n8n` runs every core workflow and connector inside a real n8n instance, with a local mock standing in for vendor APIs and the AI model. **Use a throwaway instance**: the tests create workflows and credentials and recreate the `valari_*` data tables.

```bash
N8N_USER_FOLDER=$(mktemp -d) npx n8n start       # terminal 1
N8N_TEST_INSTANCE=1 npm run test:n8n             # terminal 2
```

## Style

- Plain, specific wording in alerts, notes and docs. No em dashes.
- Every vendor node uses **On Error: Continue** and reports errors per person, so one bad record never stops a run.
- Nothing is sent to a champion automatically. Connectors may draft, enroll into reviewed sequences, or alert people. They never send.
- No scraping of LinkedIn or other sites that forbid it.

## Code of conduct

By taking part you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).
