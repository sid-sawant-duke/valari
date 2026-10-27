// Generates the core workflows: Daily Run, Digest, Call Now Webhook, MCP Server and Lookup Callback.
const { inline, uid, TABLES, makeBuilder } = require('./lib');
const { addInvestigator } = require('./agent');

const S = 'src/core/shared.js';
const x = (col) => col * 240;

// ------------------------------------------------------------------ Daily Run
function dailyRun() {
  const b = makeBuilder('core/daily');
  const y0 = 300; // main lane
  const H = 1800; // section height

  b.sticky('Note: Start here', [x(-2) - 40, -560], 640, H,
    `## Valari: Daily Run\n\nFinds past users of your product who changed jobs, confirms each move with an AI agent, scores it, and acts on it: new email, CRM record, sequence, alert.\n\n**This workflow never talks to a vendor directly.** It calls your **connectors** (small workflows, one per tool) by ID.\n\n**Setup (once):**\n1. Import the connectors you need from \`workflows/connectors/\` and set each one up (each has its own note).\n2. Open **Config** and paste each connector's workflow ID (from its URL: \`/workflow/<ID>\`). Leave optional ones blank.\n3. Set your lookup tools in order (\`lookup_1\` to \`lookup_3\`) with a monthly credit budget for each.\n4. Fill in your product, ICP, personas and team directory.\n5. Add your AI model credential on **Chat Model** (or swap the node for any other chat model).\n6. Click **Execute workflow** to test, then toggle **Active**.\n\nRuns every morning at 7am. The MCP server and the Lookup Callback can also call it for one person.\n\nState lives in n8n Data Tables, created automatically: \`${TABLES.state.name}\`, \`${TABLES.cases.name}\`, \`${TABLES.lookups.name}\` and \`${TABLES.usage.name}\`.`, 4);
  b.sticky('Note: 1 Load', [x(1) - 40, -560], x(6) + 120, H, `### 1. Load\nWatchlist and accounts from your CRM connector, optional product-user list, saved state, lookup cache and credit usage, and inbox signals (bounces and "I've left" auto-replies).`, 7);
  b.sticky('Note: 2 Look up', [x(7) + 100, -560], x(10) - 160, H, `### 2. Look up (waterfall)\nTries up to three lookup tools in order (for example Apollo, then Clay, then People Data Labs) and stops as soon as one finds the person's current job.\n\n**Credit guardrails:** each tool has a monthly budget and pauses at it; a Slack warning goes out at 80%. Recent results are reused instead of paying again, and a tool that found nothing isn't asked about the same person again for 30 days.\n\nClay answers later: those people wait as "pending" and are finished by the **Lookup Callback** workflow.`, 7);
  b.sticky('Note: 3 Investigate', [x(17) - 60, -560], x(3) + 160, H, `### 3. Investigate\nThe AI agent weighs the evidence and returns **confirmed**, **verify** or **no_change** with a draft opener.\n\nSwap **Chat Model** for OpenAI, Gemini, Mistral, Ollama or any chat model that supports tools.`, 6);
  b.sticky('Note: 4 Act', [x(20) + 120, -560], x(7) + 40, H, `### 4. Act\nFor confirmed moves: find the new work email (skipped when the lookup already found it), write the new contact and a task to the CRM, and enroll them in a sequence (the rep reviews the first email). Every step is optional: leave its connector ID blank to skip it.`, 5);
  b.sticky('Note: 5 Save and alert', [x(27) + 180, -560], x(3) + 60, H, `### 5. Save and alert\nLogs the case, updates state, and sends alerts through your **alert connector**.\n\nNothing is ever sent to a champion automatically.`, 3);

  // ---- Triggers and config
  b.add('Every Morning', 'n8n-nodes-base.scheduleTrigger', 1.2, [x(-1), y0 - 100], { rule: { interval: [{ field: 'days', triggerAtHour: 7 }] } });
  b.add('When Called', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [x(-1), y0 + 100], { workflowInputs: { values: [{ name: 'contact_id' }] } });
  b.config('Config', [x(0), y0], {
    crm_connector_id: '',
    product_users_connector_id: '',
    signals_connector_id: '',
    lookup_1_name: 'apollo',
    lookup_1_connector_id: '',
    lookup_1_monthly_budget: 500,
    lookup_2_name: 'clay',
    lookup_2_connector_id: '',
    lookup_2_monthly_budget: 200,
    lookup_3_name: 'people_data_labs',
    lookup_3_connector_id: '',
    lookup_3_monthly_budget: 100,
    lookup_cache_days: 14,
    lookup_repeat_days: 30,
    budget_warning_percent: 80,
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
  b.ensureTable('Ensure State Table', [x(1), y0 - 200], TABLES.state);
  b.ensureTable('Ensure Cases Table', [x(1), y0], TABLES.cases);
  b.ensureTable('Ensure Lookups Table', [x(1), y0 + 200], TABLES.lookups);
  b.ensureTable('Ensure Usage Table', [x(1), y0 + 400], TABLES.usage);
  b.chain('Every Morning', 'Config');
  b.connect('When Called', 'Config');
  b.chain('Config', 'Ensure State Table', 'Ensure Cases Table', 'Ensure Lookups Table', 'Ensure Usage Table');

  // ---- Load
  b.code('Watchlist Request', [x(2), y0], "return [{ json: { action: 'list_champions' } }];", { executeOnce: true });
  b.callConnector('Get Watchlist', [x(3), y0], 'crm_connector_id');
  b.code('Accounts Request', [x(2), y0 + 200], "return [{ json: { action: 'list_accounts' } }];", { executeOnce: true });
  b.callConnector('Get Accounts', [x(3), y0 + 200], 'crm_connector_id');
  b.code('Product Users Request', [x(4), y0], "return [{ json: { action: 'list_champions' } }];", { executeOnce: true });
  b.ifTrue('Product Users?', [x(4), y0 + 200], "={{ !!$('Config').first().json.product_users_connector_id }}");
  b.callConnector('Get Product Users', [x(5), y0 + 100], 'product_users_connector_id');
  b.readTable('Read State', [x(5), y0 + 300], TABLES.state);
  b.readTable('Read Lookup Cache', [x(5), y0 + 500], TABLES.lookups);
  b.readTable('Read Usage', [x(6), y0 + 500], TABLES.usage);
  b.code('Signals Request', [x(6), y0 + 300], "return [{ json: { action: 'get_signals' } }];", { executeOnce: true });
  b.ifTrue('Signals?', [x(6), y0 + 100], "={{ !!$('Config').first().json.signals_connector_id }}");
  b.callConnector('Get Signals', [x(7) - 120, y0 - 60], 'signals_connector_id');
  b.code('Find Candidates', [x(7) - 120, y0 + 160], `${inline(S, 'src/core/watchlist.js', 'src/core/find-candidates.js')}

// ---- n8n entry ----
const cfg = $('Config').first().json;
const rows = (name) => ($(name).isExecuted ? $(name).all().map((i) => i.json).filter((j) => j && Object.keys(j).length) : []);
const watchlist = buildWatchlist(cfg, rows('Get Watchlist'), rows('Get Product Users'), rows('Read State'));
const found = findCandidates(cfg, watchlist, rows('Get Signals'));
const candidates = restoreSignals(cfg, found.candidates, rows('Read Lookup Cache'));
const skipped = found.skipped;
console.log(\`Watchlist: \${watchlist.length} people. Investigating \${candidates.length}.\`);
if (skipped.length) console.log('Skipped this run:', skipped);
return candidates.map((c) => ({ json: c }));`);
  b.chain('Ensure Usage Table', 'Watchlist Request', 'Get Watchlist', 'Accounts Request', 'Get Accounts', 'Product Users Request', 'Product Users?');
  b.connect('Product Users?', 'Get Product Users', { output: 0 });
  b.connect('Product Users?', 'Read State', { output: 1 });
  b.chain('Get Product Users', 'Read State', 'Read Lookup Cache', 'Read Usage', 'Signals Request', 'Signals?');
  b.connect('Signals?', 'Get Signals', { output: 0 });
  b.connect('Signals?', 'Find Candidates', { output: 1 });
  b.connect('Get Signals', 'Find Candidates');

  // ---- Look up: waterfall over up to three lookup connectors
  b.code('Suspect Rows', [x(8), y0 - 340], `// People with an inbox signal are marked "suspect" first, so a failed run is retried instead of lost.
const today = new Date().toISOString().slice(0, 10);
return $input.all()
  .filter((i) => i.json.trigger === 'signal')
  .map((i) => ({ json: { contact_id: i.json.contact_id, full_name: i.json.full_name, status: 'suspect', last_checked: today } }));`);
  b.upsertRows('Save Suspects', [x(9), y0 - 340], TABLES.state);
  b.chain('Find Candidates', 'Suspect Rows', 'Save Suspects');

  const W = [S, 'src/core/waterfall.js'];
  const rowsFn = "const rows = (name) => ($(name).isExecuted ? $(name).all().map((i) => i.json).filter((j) => j && Object.keys(j).length) : []);";
  const priorNodes = [];
  for (const i of [1, 2, 3]) {
    const c = 8 + (i - 1) * 2;
    const req = `Lookup ${i} Requests`;
    const gate = `Use Lookup ${i}?`;
    const call = `Look Up ${i}`;
    b.code(req, [x(c), y0 + 160], `${inline(...W)}

// ---- n8n entry ----
// Who still needs looking up after the earlier tools, within this tool's monthly budget.
const cfg = $('Config').first().json;
${rowsFn}
const candidates = $('Find Candidates').all().map((i) => i.json);
const prior = [${priorNodes.map((n) => `...rows('${n}')`).join(', ')}];
const { requests, budget_skipped, slot } = planSlot(cfg, ${i}, candidates, rows('Read Lookup Cache'), rows('Read Usage'), prior);
if (slot && budget_skipped.length) console.log(\`\${slot.name} is at its monthly budget. Skipped:\`, budget_skipped);
return requests.map((json) => ({ json }));`);
    b.ifTrue(gate, [x(c + 1), y0 + 320], `={{ $json.action !== 'noop' && !!$('Config').first().json.lookup_${i}_connector_id }}`);
    b.callConnector(call, [x(c + 1), y0], `lookup_${i}_connector_id`);
    if (i === 1) b.connect('Find Candidates', req);
    b.connect(req, gate);
    b.connect(gate, call, { output: 0 });
    priorNodes.push(call);
    // Both the "skip" branch and the call lead to the next step.
    const next = i < 3 ? `Lookup ${i + 1} Requests` : 'Collect Lookups';
    b.connect(gate, next, { output: 1 });
    b.connect(call, next);
  }
  b.code('Collect Lookups', [x(14), y0 + 160], `${inline(...W)}

// ---- n8n entry ----
// Picks each person's answer and works out the cache, credit usage and budget warnings.
const cfg = $('Config').first().json;
${rowsFn}
const candidates = $('Find Candidates').all().map((i) => i.json);
const out = collectLookups(cfg, candidates, rows('Read Lookup Cache'), rows('Read Usage'), [rows('Look Up 1'), rows('Look Up 2'), rows('Look Up 3')]);
if (out.pending.length) console.log('Waiting on async lookups (finished by the Lookup Callback):', out.pending);
return [{ json: out }];`);
  b.code('Cache Rows', [x(15), y0 - 340], "return $('Collect Lookups').first().json.cache_rows.map((json) => ({ json }));");
  b.upsertRows('Save Lookup Cache', [x(16), y0 - 340], TABLES.lookups);
  b.code('Usage Rows', [x(15), y0 - 140], "return $('Collect Lookups').first().json.usage_rows.map((json) => ({ json }));");
  b.upsertRows('Save Usage', [x(16), y0 - 140], TABLES.usage, 'usage_key');
  b.code('Pending Rows', [x(15), y0 + 560], `// People waiting on an async lookup stay "suspect"; if the answer never comes, they're retried in 2 days.
const today = new Date().toISOString().slice(0, 10);
return $('Collect Lookups').first().json.pending.map((contact_id) => ({ json: { contact_id, status: 'suspect', last_checked: today } }));`);
  b.upsertRows('Save Pending', [x(16), y0 + 560], TABLES.state);
  b.code('Budget Alerts', [x(15), y0 + 760], "return $('Collect Lookups').first().json.alerts.map((json) => ({ json }));");
  b.callConnector('Send Budget Alerts', [x(16), y0 + 760], 'alert_connector_id', { alwaysOutputData: false });
  b.code('Prepare Brief', [x(17), y0 + 160], "return $('Collect Lookups').first().json.briefs.map((json) => ({ json }));");
  b.chain('Collect Lookups', 'Cache Rows', 'Save Lookup Cache');
  b.chain('Collect Lookups', 'Usage Rows', 'Save Usage');
  b.chain('Collect Lookups', 'Pending Rows', 'Save Pending');
  b.chain('Collect Lookups', 'Budget Alerts', 'Send Budget Alerts');
  b.connect('Collect Lookups', 'Prepare Brief');

  // ---- Investigate
  addInvestigator(b, 'Prepare Brief', x(18) + 40, y0 + 160);

  b.code('Score and Route', [x(20) + 240, y0 + 160], `${inline(S, 'src/core/score-and-route.js')}

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
  const results = "const rows = (name) => ($(name).isExecuted ? $(name).all().map((i) => i.json).filter((j) => j && j.contact_id) : []);\nconst decisions = $('Score and Route').all().map((i) => i.json);\n// Emails the lookup already found count too, so the email finder can be skipped for them.\nconst emails = [...lookupEmailResults(decisions), ...rows('Find Emails')];";
  const ax = (c) => x(c + 8) + 240;
  b.code('Email Requests', [ax(13), y0 + 160], `${inline(...A)}\n\n// ---- n8n entry ----\nreturn emailRequests($('Config').first().json, $('Score and Route').all().map((i) => i.json)).map((json) => ({ json }));`);
  b.ifTrue('Find Emails?', [ax(14), y0 + 160], "={{ $json.action !== 'noop' && !!$('Config').first().json.email_finder_connector_id }}");
  b.callConnector('Find Emails', [ax(15), y0], 'email_finder_connector_id');
  b.code('CRM Requests', [ax(15), y0 + 200], `${inline(...A)}\n\n// ---- n8n entry ----\n${results}\nreturn crmRequests($('Config').first().json, decisions, emails).map((json) => ({ json }));`);
  b.ifTrue('Write to CRM?', [ax(16), y0 + 200], "={{ $json.action !== 'noop' && !!$('Config').first().json.crm_connector_id }}");
  b.callConnector('Record Moves', [ax(17), y0 + 40], 'crm_connector_id');
  b.code('Sequence Requests', [ax(17), y0 + 240], `${inline(...A)}\n\n// ---- n8n entry ----\n${results}\nreturn sequenceRequests($('Config').first().json, decisions, emails).map((json) => ({ json }));`);
  b.ifTrue('Enroll?', [ax(18), y0 + 240], "={{ $json.action !== 'noop' && !!$('Config').first().json.sequence_connector_id }}");
  b.callConnector('Enroll in Sequence', [ax(19), y0 + 80], 'sequence_connector_id');
  b.code('Finalize', [ax(19), y0 + 280], `${inline(...A, 'src/core/finalize.js')}

// ---- n8n entry ----
${results}
const out = finalize($('Config').first().json, decisions, emails, rows('Record Moves'), rows('Enroll in Sequence'));
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
  b.code('Case Rows', [ax(20) + 40, y0 + 80], 'return $input.all().map((i) => ({ json: i.json.case_row }));');
  b.insertRows('Save Cases', [ax(21) + 40, y0 + 80], TABLES.cases);
  b.code('State Rows', [ax(20) + 40, y0 + 280], 'return $input.all().map((i) => ({ json: i.json.state_row }));');
  b.upsertRows('Save State', [ax(21) + 40, y0 + 280], TABLES.state);
  b.code('Alert Requests', [ax(20) + 40, y0 + 480], 'return $input.all().filter((i) => i.json.alert).map((i) => ({ json: i.json.alert }));');
  b.callConnector('Send Alerts', [ax(21) + 40, y0 + 480], 'alert_connector_id', { alwaysOutputData: false });
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

// ------------------------------------------------------------------ Lookup callback (async lookups such as Clay)
function lookupCallback() {
  const b = makeBuilder('core/lookup-callback');
  b.sticky('Note: Callback', [-560, -360], 600, 560, `## Valari: Lookup Callback\n\nSome lookup tools answer later instead of right away. **Clay** works this way: Valari sends a person to a Clay table, Clay runs its waterfall, and an HTTP API column posts the result here.\n\nThis workflow saves the result to the lookup cache and immediately re-runs the Daily Run for that person, which picks up the cached answer without spending another credit.\n\n**Setup:**\n1. Add a Header Auth credential on the **Webhook** and use the same header in Clay's HTTP API column.\n2. In **Config**, paste the Daily Run's workflow ID.\n3. Activate, and put the Production URL in the Clay connector's \`callback_url\`.\n\nSend at least \`valari_contact_id\` plus the current \`company_name\`, \`company_domain\`, \`job_title\` and (optionally) \`job_start_date\`, \`linkedin_url\`, \`work_email\`.`, 4);
  b.add('Webhook', 'n8n-nodes-base.webhook', 2, [-480, 300], { httpMethod: 'POST', path: 'valari-lookup-callback', authentication: 'headerAuth', responseMode: 'onReceived', options: {} }, { webhookId: uid('core/lookup-callback/webhook') });
  b.config('Config', [-240, 300], { daily_run_workflow_id: '' });
  b.ensureTable('Ensure Lookups Table', [0, 300], TABLES.lookups);
  b.readTable('Read Lookup Cache', [240, 300], TABLES.lookups);
  b.code('Normalize Result', [480, 300], `${inline(S, 'src/core/callback.js')}

// ---- n8n entry ----
const existing = $input.all().map((i) => i.json).filter((r) => r && r.contact_id);
const row = normalizeCallback($('Webhook').first().json, existing);
if (!row) { console.log('Callback without valari_contact_id, ignored'); return []; }
return [{ json: row }];`);
  b.upsertRows('Save Lookup Result', [720, 300], TABLES.lookups);
  b.code('Contact To Investigate', [960, 300], "return [{ json: { contact_id: $('Normalize Result').first().json.contact_id } }];");
  b.add('Investigate Now', 'n8n-nodes-base.executeWorkflow', 1.2, [1200, 300], {
    source: 'database',
    workflowId: { __rl: true, mode: 'id', value: "={{ $('Config').first().json.daily_run_workflow_id }}" },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: { contact_id: '={{ $json.contact_id }}' },
      matchingColumns: [],
      schema: [{ id: 'contact_id', displayName: 'contact_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false }],
      attemptToConvertTypes: false,
      convertFieldsToString: true,
    },
    mode: 'each',
    options: { waitForSubWorkflow: false },
  });
  b.chain('Webhook', 'Config', 'Ensure Lookups Table', 'Read Lookup Cache', 'Normalize Result', 'Save Lookup Result', 'Contact To Investigate', 'Investigate Now');
  return b.workflow('Valari: Lookup Callback');
}

module.exports = {
  'core/1-daily-run.json': dailyRun,
  'core/2-digest.json': digest,
  'core/3-call-now-webhook.json': engagement,
  'core/4-mcp-server.json': mcp,
  'core/5-lookup-callback.json': lookupCallback,
};
