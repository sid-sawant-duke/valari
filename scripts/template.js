// Generates the single-workflow n8n template (for the n8n template library).
// Same logic as the core, with a fixed stack instead of connectors:
// Google Sheets (watchlist), Gmail (signals), Apollo (lookup, with credit guardrails), optional Hunter (new email), Slack (alerts).
const { inline, uid, TABLES, makeBuilder } = require('./lib');
const { addInvestigator } = require('./agent');

const S = 'src/core/shared.js';
const REPO = 'https://github.com/sid-sawant-duke/valari';
const x = (c) => c * 240;

function template() {
  const b = makeBuilder('template');
  const D = 0; // daily lane
  const G = 1240; // digest lane
  const W = 1600; // call-now lane

  // ---------------------------------------------------------------- notes
  b.sticky('Main note', [x(-5), -420], 640, 1380, `## Valari: track champion job changes and alert the right rep

**Who it's for:** B2B sales, customer success and GTM teams who want to know when people who used their product move to a new company, without paying for a job-change tool.

### How it works
1. **Every morning** it reads your champions from Google Sheets and scans Gmail for bounces and "no longer with the company" auto-replies. A monthly sweep also checks a third of the list.
2. Each person with a signal is looked up in **Apollo**, within a **monthly credit budget** you set (with a Slack warning at 80%). Recent results are reused instead of paying twice.
3. An **AI agent** decides: confirmed move, **[VERIFY]** or no change, with evidence and a draft opener.
4. Moves are **scored** (role, persona, seniority, account status, ICP fit, recency) and posted to **Slack** with an @mention for the owner, plus their new work email when Apollo has it. Optional: **Hunter** fills in missing emails.
5. **Every other Monday** a digest goes to Slack.
6. A **webhook** sends "call now" alerts when a moved champion opens your email or their new company visits your site.

Nothing is ever sent to a champion automatically. State is kept in n8n Data Tables, created on the first run.

### Set up (about 15 minutes)
1. Make a Google Sheet with a **Champions** tab and a **Customers** tab ([template](${REPO}/raw/main/sheet/valari-template.xlsx)).
2. Add credentials: Google Sheets, Gmail, Slack, your AI model, and a Header Auth credential for Apollo (name \`x-api-key\`).
3. Fill in **Config**: sheet ID, Slack channel, Apollo monthly budget, product, ICP, personas, team directory.
4. Put a contact ID in **Test Contact**, run **Test One Person**, then publish the workflow (top right).

### Customize
- **Personas and scoring:** reward the roles you care about (for example UX researchers) instead of only seniority.
- **Any AI model:** swap **Chat Model** for OpenAI, Gemini, Mistral, Ollama and others.
- **Full version** with a lookup waterfall (Apollo, Clay, People Data Labs), Salesforce, Salesloft and plug-in connectors for any CRM: [GitHub](${REPO}).`, 1);
  b.sticky('Section: Start', [x(-1) - 60, -420], x(3) + 60, W + 400 + 420, '## 1. Triggers and settings\nFour ways in: the daily run, a one-person test, the biweekly digest and the "call now" webhook. They all share **Config**.', 7);
  b.sticky('Section: Detect', [x(3) + 20, -420], x(8) - 80, 1380, '## 2. Detect\nReads the watchlist, accounts, saved state, lookup cache and credit usage, scans the inbox for bounces and "I\'ve left" auto-replies, and picks who to investigate.', 7);
  b.sticky('Section: Investigate', [x(11) - 40, -420], x(9) + 100, 1380, '## 3. Look up and investigate\nLooks each person up in Apollo (skipping anyone looked up recently, and never past the monthly budget), then the AI agent weighs the evidence and writes a draft opener.', 7);
  b.sticky('Section: Act', [x(20) + 120, -420], x(7) + 80, 1380, '## 4. Score, save and alert\nScores each move, uses the email Apollo found (or optionally asks Hunter), saves the case and posts to Slack.', 7);
  b.sticky('Section: Digest', [x(3) + 20, G - 160], x(5), 340, '## Digest\nEvery other Monday: confirmed moves, open [VERIFY] cases and the funnel.', 7);
  b.sticky('Section: Call now', [x(3) + 20, W - 160], x(7), 520, '## "Call now" alerts\nPoint your sequencing tool (email opened, clicked, replied) and website visitor tool (RB2B, Warmly, Snitcher, Leadfeeder and others) at the webhook. Any JSON with an email or a company domain works.', 7);
  b.sticky('Note: Config', [x(1) - 120, 430], 300, 320, '### Fill in Config first\nSheet ID, Slack channel, Apollo monthly budget, product and ICP descriptions, personas and team directory (Slack member IDs for @mentions).\n\nSet `find_new_emails` to `true` after adding a Hunter credential.', 3);
  b.sticky('Note: Apollo', [x(12) - 60, D + 300], 280, 240, '### Apollo\nHeader Auth credential: name `x-api-key`, value your Apollo API key. Apollo only charges when it finds someone, and phone numbers are never requested.', 3);
  b.sticky('Note: Hunter', [x(24) + 40, 420], 260, 220, '### Hunter (optional)\nHeader Auth credential: name `X-API-KEY`, value your API key. Then set `find_new_emails` to `true` in Config.', 3);

  // ---------------------------------------------------------------- triggers and config
  const mark = (name, pos, fields) => b.config(name, pos, fields, { includeOther: true });
  b.add('Every Morning', 'n8n-nodes-base.scheduleTrigger', 1.2, [x(-1), D - 80], { rule: { interval: [{ field: 'days', triggerAtHour: 7 }] } });
  mark('Daily Run', [x(0), D - 80], { job: 'daily' });
  b.add('Test One Person', 'n8n-nodes-base.manualTrigger', 1, [x(-1), D + 160], {});
  mark('Test Contact', [x(0), D + 160], { job: 'daily', contact_id: 'PASTE_A_CONTACT_ID_OR_OLD_WORK_EMAIL' });
  b.add('Every Other Monday', 'n8n-nodes-base.scheduleTrigger', 1.2, [x(-1), G], { rule: { interval: [{ field: 'weeks', weeksInterval: 2, triggerAtDay: [1], triggerAtHour: 9 }] } });
  mark('Digest Run', [x(0), G], { job: 'digest' });
  b.add('Engagement Webhook', 'n8n-nodes-base.webhook', 2, [x(-1), W], { httpMethod: 'POST', path: 'valari-engagement', authentication: 'headerAuth', responseMode: 'onReceived', options: {} }, { webhookId: uid('template/webhook') });
  mark('Call Now Run', [x(0), W], { job: 'call_now' });
  b.config('Config', [x(1), D + 160], {
    google_sheet_id: 'PASTE_YOUR_GOOGLE_SHEET_ID',
    champions_tab: 'Champions',
    customers_tab: 'Customers',
    slack_channel: '#champion-moves',
    apollo_monthly_budget: 500,
    lookup_cache_days: 14,
    lookup_repeat_days: 30,
    budget_warning_percent: 80,
    product_description: 'REPLACE: describe your product in one or two sentences.',
    icp_description: 'REPLACE: describe your ideal customer (company type, size, team).',
    personas: '[]',
    require_lookup_match: true,
    scoring: '{}',
    team_directory: '{}',
    opener_guidelines: 'Warm and plain. 2 to 4 sentences, under 70 words. Congratulate them, mention what they did with our product before, offer help getting set up. No hard pitch.',
    find_new_emails: 'false',
    crm_write_back: 'false',
    max_lookups_per_run: 25,
    sweep_day_of_month: 1,
    recheck_after_days: 30,
    gmail_search_query: 'newer_than:3d (from:mailer-daemon OR from:postmaster OR subject:("delivery status notification" OR undeliverable OR "undelivered mail" OR "mail delivery failed" OR "returned mail" OR "delivery has failed") OR "no longer with" OR "has left the company" OR "no longer employed" OR "is no longer")',
    digest_lookback_days: 14,
    digest_title: 'Champion moves',
    engagement_window_days: 90,
    engagement_cooldown_hours: 24,
    requested_contact_id: "={{ $json.contact_id || '' }}",
  }, { includeOther: true });
  b.ensureTable('Ensure State Table', [x(2), D - 140], TABLES.state);
  b.ensureTable('Ensure Cases Table', [x(2), D + 40], TABLES.cases);
  b.ensureTable('Ensure Lookups Table', [x(2), D + 220], TABLES.lookups);
  b.ensureTable('Ensure Usage Table', [x(2), D + 400], TABLES.usage);
  b.route('Which Job?', [x(2), G - 200], ['daily', 'digest', 'call_now'], 'job');
  b.chain('Every Morning', 'Daily Run', 'Config');
  b.chain('Test One Person', 'Test Contact', 'Config');
  b.chain('Every Other Monday', 'Digest Run', 'Config');
  b.chain('Engagement Webhook', 'Call Now Run', 'Config');
  b.chain('Config', 'Ensure State Table', 'Ensure Cases Table', 'Ensure Lookups Table', 'Ensure Usage Table');
  b.code('Pass Job', [x(2), D + 580], "// Hands the trigger's job to the router after the tables exist.\nreturn [{ json: { job: $('Config').first().json.job } }];", { executeOnce: true });
  b.chain('Ensure Usage Table', 'Pass Job', 'Which Job?');

  // ---------------------------------------------------------------- daily: detect
  const doc = { __rl: true, mode: 'id', value: "={{ $('Config').first().json.google_sheet_id }}" };
  const tab = (k) => ({ __rl: true, mode: 'name', value: `={{ $('Config').first().json.${k} }}` });
  const col = (k) => `={{ $json.${k} ?? "" }}`;
  const setMap = (name, pos, keys) => b.add(name, 'n8n-nodes-base.set', 3.4, pos, {
    assignments: { assignments: keys.map((k) => ({ id: uid(`template/${name}/${k}`), name: k, value: col(k), type: 'string' })) }, options: {},
  });
  b.add('Read Champions', 'n8n-nodes-base.googleSheets', 4.6, [x(4), D], { documentId: doc, sheetName: tab('champions_tab'), options: {} }, { executeOnce: true, alwaysOutputData: true });
  setMap('Map Champions', [x(5), D], ['contact_id', 'full_name', 'work_email', 'linkedin_url', 'last_company', 'last_company_domain', 'last_title', 'role_type', 'owner_ae', 'owner_ae_email', 'owner_ae_slack_id', 'do_not_contact', 'notes']);
  b.add('Read Customers', 'n8n-nodes-base.googleSheets', 4.6, [x(6), D], { documentId: doc, sheetName: tab('customers_tab'), options: {} }, { executeOnce: true, alwaysOutputData: true });
  setMap('Map Accounts', [x(7), D], ['domain', 'company_name', 'relationship', 'owner_ae', 'owner_ae_email', 'owner_ae_slack_id']);
  b.readTable('Read State', [x(8), D], TABLES.state);
  b.readTable('Read Lookup Cache', [x(8), D + 220], TABLES.lookups);
  b.readTable('Read Usage', [x(9), D + 220], TABLES.usage);
  b.add('Search Inbox', 'n8n-nodes-base.gmail', 2.1, [x(9), D], { resource: 'message', operation: 'getAll', returnAll: false, limit: 100, simple: false, filters: { q: "={{ $('Config').first().json.gmail_search_query }}" }, options: {} }, { executeOnce: true, alwaysOutputData: true });
  b.code('Find Candidates', [x(10), D], `${inline(S, 'src/core/watchlist.js', 'src/core/find-candidates.js', 'src/connectors/misc.js')}

// ---- n8n entry ----
const cfg = $('Config').first().json;
const rows = (name) => $(name).all().map((i) => i.json).filter((j) => j && Object.keys(j).length);
const watchlist = buildWatchlist(cfg, rows('Map Champions'), [], rows('Read State'));
const messages = rows('Search Inbox').map(normalizeGmail).filter(Boolean);
const { candidates, skipped } = findCandidates(cfg, watchlist, messages);
console.log(\`Watchlist: \${watchlist.length} people. Investigating \${candidates.length}.\`);
if (skipped.length) console.log('Skipped this run:', skipped);
return candidates.map((c) => ({ json: c }));`);
  b.connect('Which Job?', 'Read Champions', { output: 0 });
  b.chain('Read Champions', 'Map Champions', 'Read Customers', 'Map Accounts', 'Read State', 'Read Lookup Cache', 'Read Usage', 'Search Inbox', 'Find Candidates');
  b.code('Opt-out Rows', [x(9), D + 420], `${inline(S, 'src/core/watchlist.js', 'src/core/find-candidates.js')}

// ---- n8n entry ----
// Opted-out people who already moved (or are being checked): stop their alerts, including "call now".
const cfg = $('Config').first().json;
const rows = (name) => ($(name).isExecuted ? $(name).all().map((i) => i.json).filter((j) => j && Object.keys(j).length) : []);
const watchlist = buildWatchlist(cfg, rows('Map Champions'), [], rows('Read State'));
return optOutRows(watchlist).map((json) => ({ json }));`);
  b.upsertRows('Save Opt-outs', [x(10), D + 420], TABLES.state);
  b.chain('Read Usage', 'Opt-out Rows', 'Save Opt-outs');

  // ---------------------------------------------------------------- daily: look up (Apollo, with credit guardrails) and investigate
  b.code('Suspect Rows', [x(11), D - 220], `// People with an inbox signal are marked "suspect" first, so a failed run is retried instead of lost.
const today = new Date().toISOString().slice(0, 10);
return $input.all()
  .filter((i) => i.json.trigger === 'signal')
  .map((i) => ({ json: { contact_id: i.json.contact_id, full_name: i.json.full_name, status: 'suspect', last_checked: today } }));`);
  b.upsertRows('Save Suspects', [x(12), D - 220], TABLES.state);
  const apolloCfg = "const base = $('Config').first().json;\n// The template has one lookup tool: Apollo, in slot 1 of the waterfall.\nconst cfg = { ...base, lookup_1_name: 'apollo', lookup_1_connector_id: 'built-in', lookup_1_monthly_budget: base.apollo_monthly_budget };\nconst rows = (name) => ($(name).isExecuted ? $(name).all().map((i) => i.json).filter((j) => j && Object.keys(j).length) : []);";
  b.code('Plan Lookups', [x(11), D + 60], `${inline(S, 'src/core/waterfall.js', 'src/connectors/apollo.js')}

// ---- n8n entry ----
// Who needs an Apollo lookup: skips fresh cached results and people tried recently, and stops at the monthly budget.
${apolloCfg}
const candidates = $('Find Candidates').all().map((i) => i.json);
const { requests, budget_skipped } = planSlot(cfg, 1, candidates, rows('Read Lookup Cache'), rows('Read Usage'), []);
if (budget_skipped.length) console.log('Apollo is at its monthly budget. Skipped:', budget_skipped);
return requests.map((r) => ({ json: r.action === 'noop' ? r : { ...r, apollo_body: apolloMatchBody(r) } }));`);
  b.ifTrue('Use Apollo?', [x(12), D + 60], "={{ $json.action !== 'noop' }}");
  b.add('Look Up in Apollo', 'n8n-nodes-base.httpRequest', 4.2, [x(13), D - 60], {
    method: 'POST',
    url: 'https://api.apollo.io/api/v1/people/match',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.apollo_body) }}',
    options: {},
  }, { onError: 'continueRegularOutput' });
  b.code('Map Apollo', [x(14), D - 60], `${inline('src/connectors/apollo.js')}

// ---- n8n entry ----
return { json: { contact_id: $('Plan Lookups').item.json.contact_id, provider: 'apollo', ...summarizeApollo($json) } };`, {}, 'runOnceForEachItem');
  b.code('Collect Lookups', [x(15), D + 60], `${inline(S, 'src/core/waterfall.js')}

// ---- n8n entry ----
// Picks each person's answer and works out the cache, credit usage and the 80% budget warning.
${apolloCfg}
const candidates = $('Find Candidates').all().map((i) => i.json);
return [{ json: collectLookups(cfg, candidates, rows('Read Lookup Cache'), rows('Read Usage'), [rows('Map Apollo'), [], []]) }];`);
  b.code('Cache Rows', [x(16), D - 220], "return $('Collect Lookups').first().json.cache_rows.map((json) => ({ json }));");
  b.upsertRows('Save Lookup Cache', [x(17), D - 220], TABLES.lookups);
  b.code('Usage Rows', [x(16), D + 560], "return $('Collect Lookups').first().json.usage_rows.map((json) => ({ json }));");
  b.upsertRows('Save Usage', [x(17), D + 560], TABLES.usage, 'usage_key');
  b.code('Budget Alerts', [x(16), D + 740], "return $('Collect Lookups').first().json.alerts.map((json) => ({ json }));");
  b.code('Prepare Brief', [x(16), D + 60], "return $('Collect Lookups').first().json.briefs.map((json) => ({ json }));");
  b.chain('Find Candidates', 'Suspect Rows', 'Save Suspects');
  b.chain('Find Candidates', 'Plan Lookups', 'Use Apollo?');
  b.connect('Use Apollo?', 'Look Up in Apollo', { output: 0 });
  b.connect('Use Apollo?', 'Collect Lookups', { output: 1 });
  b.chain('Look Up in Apollo', 'Map Apollo', 'Collect Lookups');
  b.chain('Collect Lookups', 'Cache Rows', 'Save Lookup Cache');
  b.chain('Collect Lookups', 'Usage Rows', 'Save Usage');
  b.connect('Collect Lookups', 'Budget Alerts');
  b.connect('Collect Lookups', 'Prepare Brief');
  addInvestigator(b, 'Prepare Brief', x(18), D + 60);

  // ---------------------------------------------------------------- daily: act
  b.code('Score and Route', [x(21), D + 60], `${inline(S, 'src/core/score-and-route.js')}

// ---- n8n entry ----
const cfg = $('Config').first().json;
const accounts = $('Map Accounts').all().map((i) => i.json).filter((j) => j && j.domain);
const briefs = $('Prepare Brief').all();
const out = [];
$input.all().forEach((item, i) => {
  const idx = item.pairedItem && typeof item.pairedItem.item === 'number' ? item.pairedItem.item : i;
  const candidate = { ...briefs[idx].json };
  delete candidate.lookup_json;
  if (item.json.error) { console.log('Investigator error for', candidate.contact_id, item.json.error); return; }
  out.push({ json: scoreAndRoute(cfg, candidate, item.json.output, accounts) });
});
return out;`);
  b.code('Email Requests', [x(22), D + 60], `${inline(S, 'src/core/actions.js')}\n\n// ---- n8n entry ----\n// People whose new email Apollo already found are skipped.\nreturn emailRequests($('Config').first().json, $('Score and Route').all().map((i) => i.json)).map((json) => ({ json }));`);
  b.ifTrue('Find New Emails?', [x(23), D + 60], "={{ $json.action !== 'noop' && String($('Config').first().json.find_new_emails).toLowerCase() === 'true' }}");
  b.add('Hunter Request', 'n8n-nodes-base.httpRequest', 4.2, [x(24), D - 80], {
    url: "={{ 'https://api.hunter.io/v2/email-finder?domain=' + encodeURIComponent($json.domain) + ($json.first_name && $json.last_name ? '&first_name=' + encodeURIComponent($json.first_name) + '&last_name=' + encodeURIComponent($json.last_name) : '&full_name=' + encodeURIComponent($json.full_name || '')) }}",
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: {},
  }, { onError: 'continueRegularOutput' });
  b.code('Map Emails', [x(25), D - 80], `${inline('src/connectors/misc.js')}\n\n// ---- n8n entry ----\nreturn { json: mapHunter($('Email Requests').item.json, $json) };`, {}, 'runOnceForEachItem');
  b.code('Finalize', [x(25), D + 160], `${inline(S, 'src/core/actions.js', 'src/core/finalize.js')}

// ---- n8n entry ----
const decisions = $('Score and Route').all().map((i) => i.json);
const found = $('Map Emails').isExecuted ? $('Map Emails').all().map((i) => i.json).filter((j) => j && j.contact_id) : [];
const emails = [...lookupEmailResults(decisions), ...found];
return finalize($('Config').first().json, decisions, emails, [], []).map((json) => ({ json }));`);
  b.chain('Investigator', 'Score and Route', 'Email Requests', 'Find New Emails?');
  b.connect('Find New Emails?', 'Hunter Request', { output: 0 });
  b.connect('Find New Emails?', 'Finalize', { output: 1 });
  b.chain('Hunter Request', 'Map Emails', 'Finalize');

  const slack = (name, pos) => b.add(name, 'n8n-nodes-base.slack', 2.3, pos, {
    resource: 'message', operation: 'post', select: 'channel',
    channelId: { __rl: true, mode: 'name', value: "={{ $('Config').first().json.slack_channel }}" },
    messageType: 'text', text: '={{ $json.text_md }}', otherOptions: { includeLinkToWorkflow: false },
  }, { onError: 'continueRegularOutput' });
  slack('Post Budget Warning', [x(17), D + 740]);
  b.connect('Budget Alerts', 'Post Budget Warning');
  b.code('Case Rows', [x(26), D - 140], 'return $input.all().map((i) => ({ json: i.json.case_row }));');
  b.insertRows('Save Cases', [x(27) - 40, D - 140], TABLES.cases);
  b.code('State Rows', [x(26), D + 60], 'return $input.all().map((i) => ({ json: i.json.state_row }));');
  b.upsertRows('Save State', [x(27) - 40, D + 60], TABLES.state);
  b.code('Alert Messages', [x(26), D + 260], 'return $input.all().filter((i) => i.json.alert).map((i) => ({ json: i.json.alert }));');
  slack('Post Alert to Slack', [x(27) - 40, D + 260]);
  b.chain('Finalize', 'Case Rows', 'Save Cases');
  b.chain('Finalize', 'State Rows', 'Save State');
  b.chain('Finalize', 'Alert Messages', 'Post Alert to Slack');

  // ---------------------------------------------------------------- digest
  b.readTable('Read Cases', [x(4), G], TABLES.cases);
  b.code('Build Digest', [x(5), G], `${inline(S, 'src/core/build-digest.js')}

// ---- n8n entry ----
const cases = $input.all().map((i) => i.json).filter((c) => c && c.case_id);
return [{ json: buildDigest($('Config').first().json, cases) }];`);
  slack('Post Digest to Slack', [x(6), G]);
  b.connect('Which Job?', 'Read Cases', { output: 1 });
  b.chain('Read Cases', 'Build Digest', 'Post Digest to Slack');

  // ---------------------------------------------------------------- call now
  b.readTable('Read Moved Champions', [x(4), W], TABLES.state);
  b.code('Match Event', [x(5), W], `${inline(S, 'src/core/engagement.js')}

// ---- n8n entry ----
// Field names it understands are listed in normalizeEvent above. Any JSON with an email or a company domain works.
const event = normalizeEvent($('Engagement Webhook').first().json);
const state = $input.all().map((i) => i.json).filter((s) => s && s.contact_id);
const matches = matchEngagement($('Config').first().json, event, state);
console.log('Engagement event:', event.type, '| matches:', matches.length);
return matches.map((json) => ({ json }));`);
  b.code('Alert Times', [x(6), W - 100], 'return $input.all().map((i) => ({ json: i.json.state_update }));');
  b.upsertRows('Save Alert Times', [x(7), W - 100], TABLES.state);
  b.code('Call Now Messages', [x(6), W + 120], 'return $input.all().map((i) => ({ json: i.json.alert }));');
  slack('Post Call Now to Slack', [x(7), W + 120]);
  b.connect('Which Job?', 'Read Moved Champions', { output: 2 });
  b.chain('Read Moved Champions', 'Match Event');
  b.chain('Match Event', 'Alert Times', 'Save Alert Times');
  b.chain('Match Event', 'Call Now Messages', 'Post Call Now to Slack');

  const wf = b.workflow('Track champion job changes with Gmail bounces, Apollo, AI and Slack alerts');
  wf.settings = { executionOrder: 'v1' };
  return wf;
}

module.exports = { 'templates/valari-template.json': template };
