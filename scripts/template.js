// Generates the single-workflow n8n template (for the n8n template library).
// Same logic as the core, with a fixed stack instead of connectors:
// Google Sheets (watchlist), Gmail (signals), People Data Labs (lookup), optional Hunter (new email), Slack (alerts).
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
  b.sticky('Main note', [x(-5), -420], 640, 1240, `## Valari: track champion job changes and alert the right rep

**Who it's for:** B2B sales, customer success and GTM teams who want to know when people who used their product move to a new company, without paying for a job-change tool.

### How it works
1. **Every morning** it reads your champions from Google Sheets and scans Gmail for bounces and "no longer with the company" auto-replies. A monthly sweep also checks a third of the list.
2. Each person with a signal is looked up in **People Data Labs**.
3. An **AI agent** decides: confirmed move, **[VERIFY]** or no change, with evidence and a draft opener.
4. Moves are **scored** (role, persona, seniority, account status, ICP fit, recency) and posted to **Slack** with an @mention for the owner. Optional: **Hunter** finds their new work email.
5. **Every other Monday** a digest goes to Slack.
6. A **webhook** sends "call now" alerts when a moved champion opens your email or their new company visits your site.

Nothing is ever sent to a champion automatically. State is kept in two n8n Data Tables, created on the first run.

### Set up (about 15 minutes)
1. Make a Google Sheet with a **Champions** tab and a **Customers** tab ([template](${REPO}/raw/main/sheet/valari-template.xlsx)).
2. Add credentials: Google Sheets, Gmail, Slack, your AI model, and a Header Auth credential for People Data Labs (name \`X-Api-Key\`).
3. Fill in **Config**: sheet ID, Slack channel, product, ICP, personas, team directory.
4. Put a contact ID in **Test Contact**, run **Test One Person**, then activate the workflow.

### Customize
- **Personas and scoring:** reward the roles you care about (for example UX researchers) instead of only seniority.
- **Any AI model:** swap **Chat Model** for OpenAI, Gemini, Mistral, Ollama and others.
- **Full version** with Salesforce, Salesloft and plug-in connectors for any CRM: [GitHub](${REPO}).`, 1);
  b.sticky('Section: Start', [x(-1) - 60, -420], x(3) + 60, W + 400 + 420, '## 1. Triggers and settings\nFour ways in: the daily run, a one-person test, the biweekly digest and the "call now" webhook. They all share **Config**.', 7);
  b.sticky('Section: Detect', [x(3) + 20, -420], x(8) - 40, 1080, '## 2. Detect\nReads the watchlist, accounts and saved state, scans the inbox for bounces and "I\'ve left" auto-replies, and picks who to investigate.', 7);
  b.sticky('Section: Investigate', [x(11) - 40, -420], x(5) + 40, 1080, '## 3. Investigate\nLooks each person up, then the AI agent weighs the evidence and writes a draft opener.', 7);
  b.sticky('Section: Act', [x(16) + 20, -420], x(7) - 60, 1080, '## 4. Score, save and alert\nScores each move, optionally finds the new work email, saves the case and posts to Slack.', 7);
  b.sticky('Section: Digest', [x(3) + 20, G - 160], x(5), 340, '## Digest\nEvery other Monday: confirmed moves, open [VERIFY] cases and the funnel.', 7);
  b.sticky('Section: Call now', [x(3) + 20, W - 160], x(7), 520, '## "Call now" alerts\nPoint your sequencing tool (email opened, clicked, replied) and website visitor tool (RB2B, Warmly, Snitcher, Leadfeeder and others) at the webhook. Any JSON with an email or a company domain works.', 7);
  b.sticky('Note: Config', [x(1) - 120, 430], 300, 300, '### Fill in Config first\nSheet ID, Slack channel, product and ICP descriptions, personas and team directory (Slack member IDs for @mentions).\n\nSet `find_new_emails` to `true` after adding a Hunter credential.', 3);
  b.sticky('Note: PDL', [x(11) - 20, 420], 260, 220, '### People Data Labs\nHeader Auth credential: name `X-Api-Key`, value your API key. The free plan includes 100 lookups a month.', 3);
  b.sticky('Note: Hunter', [x(18) + 40, 420], 260, 220, '### Hunter (optional)\nHeader Auth credential: name `X-API-KEY`, value your API key. Then set `find_new_emails` to `true` in Config.', 3);

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
    product_description: 'REPLACE: describe your product in one or two sentences.',
    icp_description: 'REPLACE: describe your ideal customer (company type, size, team).',
    personas: '[]',
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
  b.ensureTable('Ensure State Table', [x(2), D + 60], TABLES.state);
  b.ensureTable('Ensure Cases Table', [x(2), D + 260], TABLES.cases);
  b.route('Which Job?', [x(2), G - 200], ['daily', 'digest', 'call_now'], 'job');
  b.chain('Every Morning', 'Daily Run', 'Config');
  b.chain('Test One Person', 'Test Contact', 'Config');
  b.chain('Every Other Monday', 'Digest Run', 'Config');
  b.chain('Engagement Webhook', 'Call Now Run', 'Config');
  b.chain('Config', 'Ensure State Table', 'Ensure Cases Table');
  b.code('Pass Job', [x(2), D + 460], "// Hands the trigger's job to the router after the tables exist.\nreturn [{ json: { job: $('Config').first().json.job } }];", { executeOnce: true });
  b.chain('Ensure Cases Table', 'Pass Job', 'Which Job?');

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
  b.chain('Read Champions', 'Map Champions', 'Read Customers', 'Map Accounts', 'Read State', 'Search Inbox', 'Find Candidates');

  // ---------------------------------------------------------------- daily: investigate
  b.code('Suspect Rows', [x(11), D - 200], `// People with an inbox signal are marked "suspect" first, so a failed run is retried instead of lost.
const today = new Date().toISOString().slice(0, 10);
return $input.all()
  .filter((i) => i.json.trigger === 'signal')
  .map((i) => ({ json: { contact_id: i.json.contact_id, full_name: i.json.full_name, status: 'suspect', last_checked: today } }));`);
  b.upsertRows('Save Suspects', [x(12), D - 200], TABLES.state);
  b.add('Look Up Person', 'n8n-nodes-base.httpRequest', 4.2, [x(11), D + 60], {
    url: "={{ 'https://api.peopledatalabs.com/v5/person/enrich?pretty=false&min_likelihood=3&' + [['profile', $json.linkedin_url], ['email', $json.work_email], ['name', $json.full_name], ['company', $json.last_company]].filter(p => p[1]).map(p => p[0] + '=' + encodeURIComponent(p[1])).join('&') }}",
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: {},
  }, { onError: 'continueRegularOutput' });
  b.code('Prepare Brief', [x(12), D + 60], `${inline('src/connectors/pdl.js')}

// ---- n8n entry ----
const candidates = $('Find Candidates').all();
return $input.all().map((item, i) => {
  const idx = item.pairedItem && typeof item.pairedItem.item === 'number' ? item.pairedItem.item : i;
  return { json: { ...candidates[idx].json, lookup_json: JSON.stringify(summarizeLookup(item.json), null, 1) } };
});`);
  b.chain('Find Candidates', 'Suspect Rows', 'Save Suspects');
  b.connect('Find Candidates', 'Look Up Person');
  b.connect('Look Up Person', 'Prepare Brief');
  addInvestigator(b, 'Prepare Brief', x(14) - 40, D + 60);

  // ---------------------------------------------------------------- daily: act
  b.code('Score and Route', [x(17), D + 60], `${inline(S, 'src/core/score-and-route.js')}

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
  b.code('Email Requests', [x(18), D + 60], `${inline(S, 'src/core/actions.js')}\n\n// ---- n8n entry ----\nreturn emailRequests($('Config').first().json, $('Score and Route').all().map((i) => i.json)).map((json) => ({ json }));`);
  b.ifTrue('Find New Emails?', [x(19), D + 60], "={{ $json.action !== 'noop' && String($('Config').first().json.find_new_emails).toLowerCase() === 'true' }}");
  b.add('Hunter Request', 'n8n-nodes-base.httpRequest', 4.2, [x(20), D - 80], {
    url: "={{ 'https://api.hunter.io/v2/email-finder?domain=' + encodeURIComponent($json.domain) + ($json.first_name && $json.last_name ? '&first_name=' + encodeURIComponent($json.first_name) + '&last_name=' + encodeURIComponent($json.last_name) : '&full_name=' + encodeURIComponent($json.full_name || '')) }}",
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: {},
  }, { onError: 'continueRegularOutput' });
  b.code('Map Emails', [x(21), D - 80], `${inline('src/connectors/misc.js')}\n\n// ---- n8n entry ----\nreturn { json: mapHunter($('Email Requests').item.json, $json) };`, {}, 'runOnceForEachItem');
  b.code('Finalize', [x(21), D + 160], `${inline(S, 'src/core/actions.js', 'src/core/finalize.js')}

// ---- n8n entry ----
const emails = $('Map Emails').isExecuted ? $('Map Emails').all().map((i) => i.json).filter((j) => j && j.contact_id) : [];
return finalize($('Config').first().json, $('Score and Route').all().map((i) => i.json), emails, [], []).map((json) => ({ json }));`);
  b.chain('Investigator', 'Score and Route', 'Email Requests', 'Find New Emails?');
  b.connect('Find New Emails?', 'Hunter Request', { output: 0 });
  b.connect('Find New Emails?', 'Finalize', { output: 1 });
  b.chain('Hunter Request', 'Map Emails', 'Finalize');

  const slack = (name, pos) => b.add(name, 'n8n-nodes-base.slack', 2.3, pos, {
    resource: 'message', operation: 'post', select: 'channel',
    channelId: { __rl: true, mode: 'name', value: "={{ $('Config').first().json.slack_channel }}" },
    messageType: 'text', text: '={{ $json.text_md }}', otherOptions: { includeLinkToWorkflow: false },
  }, { onError: 'continueRegularOutput' });
  b.code('Case Rows', [x(22), D - 140], 'return $input.all().map((i) => ({ json: i.json.case_row }));');
  b.insertRows('Save Cases', [x(23) - 40, D - 140], TABLES.cases);
  b.code('State Rows', [x(22), D + 60], 'return $input.all().map((i) => ({ json: i.json.state_row }));');
  b.upsertRows('Save State', [x(23) - 40, D + 60], TABLES.state);
  b.code('Alert Messages', [x(22), D + 260], 'return $input.all().filter((i) => i.json.alert).map((i) => ({ json: i.json.alert }));');
  slack('Post Alert to Slack', [x(23) - 40, D + 260]);
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
console.log('Engagement event', event, 'matches', matches.length);
return matches.map((json) => ({ json }));`);
  b.code('Alert Times', [x(6), W - 100], 'return $input.all().map((i) => ({ json: i.json.state_update }));');
  b.upsertRows('Save Alert Times', [x(7), W - 100], TABLES.state);
  b.code('Call Now Messages', [x(6), W + 120], 'return $input.all().map((i) => ({ json: i.json.alert }));');
  slack('Post Call Now to Slack', [x(7), W + 120]);
  b.connect('Which Job?', 'Read Moved Champions', { output: 2 });
  b.chain('Read Moved Champions', 'Match Event');
  b.chain('Match Event', 'Alert Times', 'Save Alert Times');
  b.chain('Match Event', 'Call Now Messages', 'Post Call Now to Slack');

  const wf = b.workflow('Track champion job changes with Gmail bounces, AI and Slack alerts');
  wf.settings = { executionOrder: 'v1' };
  return wf;
}

module.exports = { 'templates/valari-template.json': template };
