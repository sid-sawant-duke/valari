#!/usr/bin/env node
// End-to-end tests against a real n8n instance.
//
// USE A THROWAWAY INSTANCE: these tests create workflows and credentials, and they delete and
// recreate the valari_* data tables.
//
//   npx n8n start                          # in another terminal (fresh N8N_USER_FOLDER recommended)
//   N8N_TEST_INSTANCE=1 npm run test:n8n
//
// Env: N8N_URL (default http://127.0.0.1:5678), N8N_EMAIL, N8N_PASSWORD (owner login; created on a fresh instance).
// A local mock (port 9997) stands in for People Data Labs, Hunter, Salesloft, Slack and the AI model.
// Salesforce, Google Sheets and Gmail connectors run with pinned vendor responses.
const { spawnSync } = require('child_process');
const path = require('path');

if (process.env.N8N_TEST_INSTANCE !== '1') {
  console.error('Refusing to run: set N8N_TEST_INSTANCE=1 to confirm the n8n instance is a throwaway test instance.');
  process.exit(1);
}
for (const file of ['core.js', 'connectors.js', 'template.js']) {
  console.log(`\n=== ${file}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status || 1);
}
