// Generates the core workflows: Daily Run, Digest, Engagement Webhook ("call now") and MCP Server.
const { inline, uid, TABLES, makeBuilder } = require('./lib');
const { addInvestigator } = require('./agent');

const S = 'src/core/shared.js';
const x = (col) => col * 240;

// ------------------------------------------------------------------ Daily Run
function dailyRun() {
  const b = makeBuilder('core/daily');
  const y0 = 300; // main lane

  b.sticky('Note: Start here', [x(-2), -420], 620, 1040,
    `## Valari: Daily Run\n\nFinds past users of your product who changed jobs, confirms each move with an AI agent, scores it, and acts on it: new email, CRM record, sequence, alert.\n\n**This workflow never talks to a vendor directly.** It calls your **connectors** (small workflows, one per tool) by ID.\n\n**Setup (once):**\n1. Import the connectors you need from \`workflows/connectors/\` and set each one up (each has its own note).\n2. Open **Config** and paste each connector's workflow ID (from its URL: \`/workflow/<ID>\`). Leave optional ones blank.\n3. Fill in your product, ICP, personas and team directory.\n4. Add your AI model credential on **Chat Model** (or swap the node for any other chat model).\n5. Click **Execute workflow** to test, then toggle **Active**.\n\nRuns every morning at 7am. The MCP server can also call it for one person.\n\nTracker state lives in two n8n Data Tables, created automatically: \`${TABLES.state.name}\` and \`${TABLES.cases.name}\`.`, 4);
  b.sticky('Note: 1 Load', [x(1) - 40, -420], x(6) + 40, 1040, `### 1. Load\nWatchlist and accounts from your CRM connector, optional product-user list, saved state, and inbox signals (bounces and "I've left" auto-replies).`, 7);
  b.sticky('Note: 2 Investigate', [x(7) + 20, -420], x(5) - 40, 1040, `### 2. Investigate\nLooks each person up through the **lookup connector**, then the AI agent weighs the evidence and returns **confirmed**, **verify** or **no_change** with a draft opener.\n\nSwap **Chat Model** for OpenAI, Gemini, Mistral, Ollama or any chat model that supports tools.`, 6);
  b.sticky('Note: 3 Act', [x(12) + 20, -420], x(7) - 40, 1040, `### 3. Act\nFor confirmed moves: find the new work email, write the new contact and a task to the CRM, and enroll them in a sequence (the rep reviews the first email). Every step is optional: leave its connector ID blank to skip it.`, 5);
  b.sticky('Note: 4 Save and alert', [x(19) + 20, -420], x(3) + 40, 1040, `### 4. Save and alert\nLogs the case, updates state, and sends alerts through your **alert connector**.\n\nNothing is ever sent to a champion automatically.`, 3);

  // ---- Triggers and config
  b.add('Every Morning', 'n8n-nodes-base.scheduleTrigger', 1.2, [x(-1), y0 - 100], { rule: { interval: [{ field: 'days', triggerAtHour: 7 }] } });
  b.add('When Called', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [x(-1), y0 + 100], { workflowInputs: { values: [{ name: 'contact_id' }] } });
  b.config('Config', [x(0), y0], {
    crm_connector_id: '',
    product_users_connector_id: '',
    signals_connector_id: '',
    lookup_connector_id: '',
    email_finder_connector_id: '',
    sequence_connector_id: '',
    alert_connector_id: '',
    crm_name: 'Salesforce',
    crm_write_back: 'true',
    product_description: 'REPLACE: describe your product in one or two sentences.',
    icp_description: 'REPLACE: describe your ideal customer (company type, size, team).',
    personas: '[]',
    scoring: '{}',
    team_directory: '{}',
    opener_guidelines: 'Warm and plain. 2 to 4 sentences, under 70 words. Congratulate them, mention what they did with our product before, offer help getting set up. No hard pitch.',
    enroll_min_score: 45,
    max_lookups_per_run: 40,
    sweep_day_of_month: 1,
    recheck_after_days: 30,
    requested_contact_id: "={{ $json.contact_id || '' }}",
  });
  b.ensureTable('Ensure State Table', [x(1), y0], TABLES.state);
  b.ensureTable('Ensure Cases Table', [x(1), y0 + 200], TABLES.cases);
  b.chain('Every Morning', 'Config');
  b.connect('When Called', 'Config');
  b.chain('Config', 'Ensure State Table', 'Ensure Cases Table');

  // ---- Load
  b.code('Watchlist Request', [x(2), y0], "return [{ json: { action: 'list_champions' } }];", { executeOnce: true });
  b.callConnector('Get Watchlist', [x(3), y0], 'crm_connector_id');
  b.code('Accounts Request', [x(2), y0 + 200], "return [{ json: { action: 'list_accounts' } }];", { executeOnce: true });
  b.callConnector('Get Accounts', [x(3), y0 + 200], 'crm_connector_id');
  b.code('Product Users Request', [x(4), y0], "return [{ json: { action: 'list_champions' } }];", { executeOnce: true });
  b.ifTrue('Product Users?', [x(4), y0 + 200], "={{ !!$('Config').first().json.product_users_connector_id }}");
  b.callConnector('Get Product Users', [x(5), y0 + 100], 'product_users_connector_id');
  b.readTable('Read State', [x(5), y0 + 300], TABLES.state);
  b.code('Signals Request', [x(6), y0 + 300], "return [{ json: { action: 'get_signals' } }];", { executeOnce: true });
  b.ifTrue('Signals?', [x(6), y0 + 100], "={{ !!$('Config').first().json.signals_connector_id }}");
  b.callConnector('Get Signals', [x(7) - 120, y0 - 60], 'signals_connector_id');
  b.code('Find Candidates', [x(7) - 120, y0 + 160], `${inline(S, 'src/core/watchlist.js', 'src/core/find-candidates.js')}

// ---- n8n entry ----
const cfg = $('Config').first().json;
const rows = (name) => ($(name).isExecuted ? $(name).all().map((i) => i.json).filter((j) => j && Object.keys(j).length) : []);
const watchlist = buildWatchlist(cfg, rows('Get Watchlist'), rows('Get Product Users'), rows('Read State'));
const { candidates, skipped } = findCandidates(cfg, watchlist, rows('Get Signals'));
console.log(\`Watchlist: \${watchlist.length} people. Investigating \${candidates.length}.\`);
if (skipped.length) console.log('Skipped this run:', skipped);
return candidates.map((c) => ({ json: c }));`);
  b.chain('Ensure Cases Table', 'Watchlist Request', 'Get Watchlist', 'Accounts Request', 'Get Accounts', 'Product Users Request', 'Product Users?');
  b.connect('Product Users?', 'Get Product Users', { output: 0 });
  b.connect('Product Users?', 'Read State', { output: 1 });
  b.chain('Get Product Users', 'Read State', 'Signals Request', 'Signals?');
  b.connect('Signals?', 'Get Signals', { output: 0 });
  b.connect('Signals?', 'Find Candidates', { output: 1 });
  b.connect('Get Signals', 'Find Candidates');

  // ---- Investigate
  b.code('Suspect Rows', [x(8), y0 - 200], `// People with an inbox signal are marked "suspect" first, so a failed run is retried instead of lost.
const today = new Date().toISOString().slice(0, 10);
return $input.all()
  .filter((i) => i.json.trigger === 'signal')
  .map((i) => ({ json: { contact_id: i.json.contact_id, full_name: i.json.full_name, status: 'suspect', last_checked: today } }));`);
  b.upsertRows('Save Suspects', [x(9), y0 - 200], TABLES.state);
  b.code('Lookup Requests', [x(8), y0 + 160], `return $input.all().map((i) => ({ json: {
  action: 'lookup_person',
  contact_id: i.json.contact_id,
  full_name: i.json.full_name,
  first_name: i.json.first_name,
  last_name: i.json.last_name,
  work_email: i.json.work_email,
  linkedin_url: i.json.linkedin_url,
  last_company: i.json.last_company,
  last_company_domain: i.json.last_company_domain,
} }));`);
  b.callConnector('Look Up People', [x(9), y0 + 160], 'lookup_connector_id');
  b.code('Prepare Brief', [x(10), y0 + 160], `// Joins each candidate with their lookup result (connectors return contact_id).
const results = new Map($input.all().map((i) => i.json).filter((j) => j && j.contact_id).map((j) => [String(j.contact_id), j]));
return $('Find Candidates').all().map((i) => {
  const c = i.json;
  const r = results.get(String(c.contact_id)) || { found: false, note: 'Lookup connector returned nothing for this person.' };
  const { contact_id, ...lookup } = r;
  return { json: { ...c, lookup_json: JSON.stringify(lookup, null, 1) } };
});`);
  b.chain('Find Candidates', 'Suspect Rows', 'Save Suspects');
  b.connect('Find Candidates', 'Lookup Requests');
  b.chain('Lookup Requests', 'Look Up People', 'Prepare Brief');

  addInvestigator(b, 'Prepare Brief', x(11), y0 + 160);

  b.code('Score and Route', [x(12) + 120, y0 + 160], `${inline(S, 'src/core/score-and-route.js')}

// ---- n8n entry ----
const cfg = $('Config').first().json;
const accounts = $('Get Accounts').all().map((i) => i.json).filter((j) => j && j.domain);
const briefs = $('Prepare Brief').all();
const out = [];
$input.all().forEach((item, i) => {
  const idx = item.pairedItem && typeof item.pairedItem.item === 'number' ? item.pairedItem.item : i;
  const candidate = { ...briefs[idx].json };
  delete candidate.lookup_json;
  if (item.json.error) {
    // The agent failed for this person. Signal-based rows stay "suspect" and are retried in 2 days.
    console.log('Investigator error for', candidate.contact_id, item.json.error);
    return;
  }
  out.push({ json: scoreAndRoute(cfg, candidate, item.json.output, accounts) });
});
return out;`);
  b.connect('Investigator', 'Score and Route');

  // ---- Act (each step optional)
  const A = [S, 'src/core/actions.js'];
  const results = "const rows = (name) => ($(name).isExecuted ? $(name).all().map((i) => i.json).filter((j) => j && j.contact_id) : []);";
  b.code('Email Requests', [x(13) + 120, y0 + 160], `${inline(...A)}\n\n// ---- n8n entry ----\nreturn emailRequests($('Config').first().json, $('Score and Route').all().map((i) => i.json)).map((json) => ({ json }));`);
  b.ifTrue('Find Emails?', [x(14) + 120, y0 + 160], "={{ $json.action !== 'noop' && !!$('Config').first().json.email_finder_connector_id }}");
  b.callConnector('Find Emails', [x(15) + 120, y0], 'email_finder_connector_id');
  b.code('CRM Requests', [x(15) + 120, y0 + 200], `${inline(...A)}\n\n// ---- n8n entry ----\n${results}\nreturn crmRequests($('Config').first().json, $('Score and Route').all().map((i) => i.json), rows('Find Emails')).map((json) => ({ json }));`);
  b.ifTrue('Write to CRM?', [x(16) + 120, y0 + 200], "={{ $json.action !== 'noop' && !!$('Config').first().json.crm_connector_id }}");
  b.callConnector('Record Moves', [x(17) + 120, y0 + 40], 'crm_connector_id');
  b.code('Sequence Requests', [x(17) + 120, y0 + 240], `${inline(...A)}\n\n// ---- n8n entry ----\n${results}\nreturn sequenceRequests($('Config').first().json, $('Score and Route').all().map((i) => i.json), rows('Find Emails')).map((json) => ({ json }));`);
  b.ifTrue('Enroll?', [x(18) + 120, y0 + 240], "={{ $json.action !== 'noop' && !!$('Config').first().json.sequence_connector_id }}");
  b.callConnector('Enroll in Sequence', [x(19) + 120, y0 + 80], 'sequence_connector_id');
  b.code('Finalize', [x(19) + 120, y0 + 280], `${inline(...A, 'src/core/finalize.js')}

// ---- n8n entry ----
${results}
const out = finalize($('Config').first().json, $('Score and Route').all().map((i) => i.json), rows('Find Emails'), rows('Record Moves'), rows('Enroll in Sequence'));
return out.map((json) => ({ json }));`);
  b.connect('Score and Route', 'Email Requests');
  b.connect('Email Requests', 'Find Emails?');
  b.connect('Find Emails?', 'Find Emails', { output: 0 });
  b.connect('Find Emails?', 'CRM Requests', { output: 1 });
  b.connect('Find Emails', 'CRM Requests');
  b.connect('CRM Requests', 'Write to CRM?');
  b.connect('Write to CRM?', 'Record Moves', { output: 0 });
  b.connect('Write to CRM?', 'Sequence Requests', { output: 1 });
  b.connect('Record Moves', 'Sequence Requests');
  b.connect('Sequence Requests', 'Enroll?');
  b.connect('Enroll?', 'Enroll in Sequence', { output: 0 });
  b.connect('Enroll?', 'Finalize', { output: 1 });
  b.connect('Enroll in Sequence', 'Finalize');

  // ---- Save and alert
  b.code('Case Rows', [x(20) + 160, y0 + 80], 'return $input.all().map((i) => ({ json: i.json.case_row }));');
  b.insertRows('Save Cases', [x(21) + 160, y0 + 80], TABLES.cases);
  b.code('State Rows', [x(20) + 160, y0 + 280], 'return $input.all().map((i) => ({ json: i.json.state_row }));');
  b.upsertRows('Save State', [x(21) + 160, y0 + 280], TABLES.state);
  b.code('Alert Requests', [x(20) + 160, y0 + 480], 'return $input.all().filter((i) => i.json.alert).map((i) => ({ json: i.json.alert }));');
  b.callConnector('Send Alerts', [x(21) + 160, y0 + 480], 'alert_connector_id', { alwaysOutputData: false });
  b.chain('Finalize', 'Case Rows', 'Save Cases');
  b.chain('Finalize', 'State Rows', 'Save State');
  b.chain('Finalize', 'Alert Requests', 'Send Alerts');
  return b.workflow('Valari: Daily Run');
}

// ------------------------------------------------------------------ Digest
function digest() {
  const b = makeBuilder('core/digest');
  b.sticky('Note: Digest', [-520, -280], 480, 420, `## Valari: Digest\n\nEvery other Monday at 9am, sends a summary of confirmed moves, open [VERIFY] cases and the funnel (investigated → confirmed → enrolled → meetings) through your alert connector.\n\n**Setup:** paste the alert connector's workflow ID into **Config** (Slack posts to your channel, Gmail emails \`digest_recipients\` set in that connector), then toggle **Active**.`, 4);
  b.add('Every Other Monday', 'n8n-nodes-base.scheduleTrigger', 1.2, [-440, 200], { rule: { interval: [{ field: 'weeks', weeksInterval: 2, triggerAtDay: [1], triggerAtHour: 9 }] } });
  b.config('Config', [-200, 200], { alert_connector_id: '', digest_lookback_days: 14, digest_title: 'Champion moves' });
  b.ensureTable('Ensure Cases Table', [40, 200], TABLES.cases);
  b.readTable('Read Cases', [280, 200], TABLES.cases);
  b.code('Build Digest', [520, 200], `${inline(S, 'src/core/build-digest.js')}

// ---- n8n entry ----
const cases = $input.all().map((i) => i.json).filter((c) => c && c.case_id);
return [{ json: buildDigest($('Config').first().json, cases) }];`);
  b.callConnector('Send Digest', [760, 200], 'alert_connector_id', { alwaysOutputData: false });
  b.chain('Every Other Monday', 'Config', 'Ensure Cases Table', 'Read Cases', 'Build Digest', 'Send Digest');
  return b.workflow('Valari: Digest');
}

// ------------------------------------------------------------------ Engagement webhook ("call now")
function engagement() {
  const b = makeBuilder('core/engagement');
  b.sticky('Note: Call now', [-560, -380], 560, 560, `## Valari: "Call now" alerts\n\nWhen a champion who recently moved **opens your email**, **clicks**, **replies**, or **someone from their new company visits your website**, the rep gets a Slack/email alert to call while they're warm.\n\n**Setup:**\n1. Paste the alert connector's workflow ID into **Config**.\n2. Add a Header Auth credential on the **Webhook** (any name/secret pair your tools can send).\n3. Activate, copy the Production URL, and point your tools at it: your sequencing tool's webhooks (email opened/clicked/replied) and your website visitor tool (RB2B, Warmly, Snitcher, Leadfeeder, Apollo, Clearbit, etc.).\n\nAny JSON with an \`email\` or a company \`domain\` works. If a tool names fields differently, the **Match Event** node lists the names it understands.`, 4);
  b.add('Webhook', 'n8n-nodes-base.webhook', 2, [-480, 260], { httpMethod: 'POST', path: 'valari-engagement', authentication: 'headerAuth', responseMode: 'onReceived', options: {} }, { webhookId: uid('core/engagement/webhook') });
  b.config('Config', [-240, 260], { alert_connector_id: '', engagement_window_days: 90, engagement_cooldown_hours: 24 });
  b.ensureTable('Ensure State Table', [0, 260], TABLES.state);
  b.readTable('Read State', [240, 260], TABLES.state);
  b.code('Match Event', [480, 260], `${inline(S, 'src/core/engagement.js')}

// ---- n8n entry ----
const event = normalizeEvent($('Webhook').first().json);
const state = $input.all().map((i) => i.json).filter((s) => s && s.contact_id);
const matches = matchEngagement($('Config').first().json, event, state);
console.log('Engagement event', event, 'matches', matches.length);
return matches.map((json) => ({ json }));`);
  b.code('Alert Times', [720, 160], 'return $input.all().map((i) => ({ json: i.json.state_update }));');
  b.upsertRows('Save Alert Times', [960, 160], TABLES.state);
  b.code('Call Now Alerts', [720, 360], 'return $input.all().map((i) => ({ json: i.json.alert }));');
  b.callConnector('Send Call Now', [960, 360], 'alert_connector_id', { alwaysOutputData: false });
  b.chain('Webhook', 'Config', 'Ensure State Table', 'Read State', 'Match Event');
  b.chain('Match Event', 'Alert Times', 'Save Alert Times');
  b.chain('Match Event', 'Call Now Alerts', 'Send Call Now');
  return b.workflow('Valari: Call Now Webhook');
}

// ------------------------------------------------------------------ MCP server
function mcp() {
  const b = makeBuilder('core/mcp');
  b.sticky('Note: MCP', [-560, -360], 600, 480, `## Valari: MCP server\n\nLets Claude, ChatGPT, Cursor or any MCP client ask about champion moves and trigger an investigation.\n\n**Setup:**\n1. Run the Daily Run once first (it creates the data tables).\n2. In **investigate_contact**, pick the **Valari: Daily Run** workflow. If **contact_id** is blank, click the AI sparkle next to it.\n3. Add a Bearer Auth credential on the trigger, activate, and add the Production URL to your AI client as a remote MCP server.`, 4);
  b.add('MCP Server', '@n8n/n8n-nodes-langchain.mcpTrigger', 2, [-200, 200], { path: 'valari', authentication: 'bearerAuth' }, { webhookId: uid('core/mcp/webhook') });
  const tableTool = (name, pos, table, description) => b.add(name, 'n8n-nodes-base.dataTableTool', 1.1, pos, {
    descriptionType: 'manual', toolDescription: description,
    resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'name', value: table.name },
    returnAll: false, limit: 200, orderBy: true, orderByColumn: 'createdAt', orderByDirection: 'DESC',
  });
  tableTool('list_cases', [-420, 440], TABLES.cases, 'Returns the 200 most recent cases: who was investigated, when, the outcome (confirmed, verify, no_change), old and new company, new title, persona, score, priority, evidence, new email, CRM record, sequence status, draft opener and owner. Use it for questions like "who changed jobs this month" or "which [VERIFY] cases are open".');
  tableTool('list_tracked', [-200, 440], TABLES.state, 'Returns the tracker state per champion: contact_id, name, status (active, suspect, verify, moved), current company and title if moved, new email, owner, next recheck date. Use it to find a contact_id before calling investigate_contact.');
  b.add('investigate_contact', '@n8n/n8n-nodes-langchain.toolWorkflow', 2.2, [20, 440], {
    description: 'Investigates one champion right now: checks whether they changed jobs, logs a case, and alerts their owner if they moved. Input: the contact_id (or their old work email). Uses one lookup credit, so only call it when asked. Afterwards call list_cases to read the result.',
    workflowId: { __rl: true, value: '', mode: 'list' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: { contact_id: "={{ $fromAI('contact_id', 'The contact_id of the champion to investigate, or their old work email', 'string') }}" },
      matchingColumns: [],
      schema: [{ id: 'contact_id', displayName: 'contact_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false }],
      attemptToConvertTypes: false, convertFieldsToString: false,
    },
  });
  for (const t of ['list_cases', 'list_tracked', 'investigate_contact']) b.connect(t, 'MCP Server', { kind: 'ai_tool' });
  return b.workflow('Valari: MCP Server');
}

module.exports = {
  'core/1-daily-run.json': dailyRun,
  'core/2-digest.json': digest,
  'core/3-call-now-webhook.json': engagement,
  'core/4-mcp-server.json': mcp,
};
