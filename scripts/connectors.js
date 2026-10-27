// Generates the connector workflows. Each connector is a small sub-workflow the core calls by ID.
// Contract: docs/connectors.md. Every connector receives items with an "action" field and returns standard items.
const { inline, makeBuilder } = require('./lib');

const CONTRACT = 'Contract: docs/connectors.md in the repo.';
const PUBLISH = '**Publish** this workflow once it is set up (top right). n8n only lets scheduled and webhook-started runs call published workflows.';
const note = (b, title, body, height = 520) => b.sticky('Note: Setup', [-560, -360], 600, height + 60, `## ${title}\n\n${body}\n\n${PUBLISH}\n\n${CONTRACT}`, 4);
const set = (b, name, pos, fields) =>
  b.add(name, 'n8n-nodes-base.set', 3.4, pos, {
    assignments: { assignments: Object.entries(fields).map(([k, v]) => ({ id: `${name}-${k}`, name: k, value: v, type: 'string' })) },
    options: {},
  });
const http = (b, name, pos, params, extra = {}) =>
  b.add(name, 'n8n-nodes-base.httpRequest', 4.2, pos, { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: {}, ...params }, { onError: 'continueRegularOutput', ...extra });

// ------------------------------------------------------------------ CRM: Salesforce
function crmSalesforce() {
  const b = makeBuilder('conn/crm-salesforce');
  note(b, 'Connector: Salesforce (CRM)', `Supplies the watchlist and accounts, and records confirmed moves.\n\n**Setup:**\n1. Add a Salesforce credential to every Salesforce node.\n2. In Salesforce, create a Campaign named **Valari** and add your champions as members. Use member statuses **Buyer**, **Champion** and **User** to set each person's role. (Or edit \`soql_champions\` in **Config** to select contacts any way you like, then fix **Map Champions**.)\n3. Optional: set \`instance_url\` (e.g. https://acme.my.salesforce.com) so alerts link to new records.\n4. Copy this workflow's ID into the core **Config** as \`crm_connector_id\`.\n\n**Actions:** list_champions, list_accounts, record_move (creates a Contact on the account if it exists, otherwise a Lead, plus a Task for the owner).`, 640);
  b.passthroughTrigger('When Called by Core', [-480, 400]);
  b.config('Config', [-240, 400], {
    soql_champions: "SELECT ContactId, Status, Contact.FirstName, Contact.LastName, Contact.Email, Contact.Title, Contact.Description, Contact.HasOptedOutOfEmail, Contact.Account.Name, Contact.Account.Website, Contact.OwnerId, Contact.Owner.Name, Contact.Owner.Email FROM CampaignMember WHERE Campaign.Name = 'Valari' AND ContactId != null",
    soql_customer_accounts: "SELECT Id, Name, Website, OwnerId, Owner.Name, Owner.Email FROM Account WHERE Type LIKE 'Customer%'",
    soql_opportunities: 'SELECT AccountId, Account.Name, Account.Website, OwnerId, Owner.Name, Owner.Email, IsClosed, IsWon FROM Opportunity WHERE IsClosed = false OR (IsWon = false AND CloseDate = LAST_N_DAYS:730)',
    task_status: 'Not Started',
    lead_source: 'Valari',
    instance_url: '',
  }, { includeOther: true });
  b.route('Route', [0, 400], ['list_champions', 'list_accounts', 'record_move']);
  b.chain('When Called by Core', 'Config', 'Route');

  // list_champions
  const sfQuery = (name, pos, key) => b.add(name, 'n8n-nodes-base.salesforce', 1, pos, { resource: 'search', operation: 'query', query: `={{ $('Config').first().json.${key} }}` }, { executeOnce: true, alwaysOutputData: true });
  sfQuery('Query Champions', [260, 160], 'soql_champions');
  set(b, 'Map Champions', [500, 160], {
    contact_id: '={{ $json.ContactId || $json.Id || "" }}',
    first_name: '={{ $json.Contact?.FirstName ?? $json.FirstName ?? "" }}',
    last_name: '={{ $json.Contact?.LastName ?? $json.LastName ?? "" }}',
    work_email: '={{ $json.Contact?.Email ?? $json.Email ?? "" }}',
    linkedin_url: '={{ "" }}',
    last_title: '={{ $json.Contact?.Title ?? $json.Title ?? "" }}',
    last_company: '={{ $json.Contact?.Account?.Name ?? $json.Account?.Name ?? "" }}',
    last_company_domain: '={{ $json.Contact?.Account?.Website ?? $json.Account?.Website ?? "" }}',
    role_type: '={{ ($json.Status || "user").toLowerCase() }}',
    owner_crm_id: '={{ $json.Contact?.OwnerId ?? $json.OwnerId ?? "" }}',
    owner_ae: '={{ $json.Contact?.Owner?.Name ?? $json.Owner?.Name ?? "" }}',
    owner_ae_email: '={{ $json.Contact?.Owner?.Email ?? $json.Owner?.Email ?? "" }}',
    do_not_contact: '={{ ($json.Contact?.HasOptedOutOfEmail ?? $json.HasOptedOutOfEmail) ? "TRUE" : "FALSE" }}',
    notes: '={{ ($json.Contact?.Description ?? $json.Description ?? "").slice(0, 500) }}',
  });
  b.connect('Route', 'Query Champions', { output: 0 });
  b.connect('Query Champions', 'Map Champions');

  // list_accounts
  sfQuery('Query Customer Accounts', [260, 400], 'soql_customer_accounts');
  sfQuery('Query Opportunities', [500, 400], 'soql_opportunities');
  b.code('Merge Accounts', [740, 400], `${inline('src/connectors/salesforce.js')}

// ---- n8n entry ----
const rows = (name) => $(name).all().map((i) => i.json).filter((j) => j && (j.Id || j.AccountId));
return mergeSalesforceAccounts(rows('Query Customer Accounts'), rows('Query Opportunities')).map((json) => ({ json }));`);
  b.connect('Route', 'Query Customer Accounts', { output: 1 });
  b.chain('Query Customer Accounts', 'Query Opportunities', 'Merge Accounts');

  // record_move
  b.ifTrue('Has Account?', [260, 680], '={{ !!$json.crm_account_id }}');
  const owner = { __rl: true, mode: 'id', value: '={{ $json.owner_crm_id }}' };
  b.add('Create Contact', 'n8n-nodes-base.salesforce', 1, [500, 600], {
    resource: 'contact', operation: 'create', lastname: '={{ $json.last_name || $json.full_name || "Unknown" }}',
    additionalFields: {
      firstName: '={{ $json.first_name }}', email: '={{ $json.new_email }}', title: '={{ $json.new_title }}',
      description: '={{ $json.task_body.slice(0, 3000) }}', leadSource: '={{ $json.lead_source }}',
      acconuntId: { __rl: true, mode: 'id', value: '={{ $json.crm_account_id }}' }, owner,
    },
  }, { onError: 'continueRegularOutput' });
  b.add('Create Lead', 'n8n-nodes-base.salesforce', 1, [500, 780], {
    resource: 'lead', operation: 'create', company: '={{ $json.new_company }}', lastname: '={{ $json.last_name || $json.full_name || "Unknown" }}',
    additionalFields: {
      firstname: '={{ $json.first_name }}', email: '={{ $json.new_email }}', title: '={{ $json.new_title }}', website: '={{ $json.new_company_domain }}',
      description: '={{ $json.task_body.slice(0, 3000) }}', leadSource: '={{ $json.lead_source }}', owner,
    },
  }, { onError: 'continueRegularOutput' });
  b.add('Merge Records', 'n8n-nodes-base.merge', 3.2, [740, 680], {});
  b.code('Record Id', [980, 680], `const req = $('Config').item.json;
return { json: { ...req, crm_record_id: $json.id || '', crm_record_type: req.crm_account_id ? 'contact' : 'lead', crm_error: $json.error ? String($json.error.message || $json.error) : '' } };`, {}, 'runOnceForEachItem');
  b.add('Create Task', 'n8n-nodes-base.salesforce', 1, [1220, 680], {
    resource: 'task', operation: 'create', status: '={{ $json.task_status }}',
    additionalFields: { subject: '={{ $json.task_subject.slice(0, 255) }}', description: '={{ $json.task_body }}', whoId: '={{ $json.crm_record_id }}', owner, activityDate: '={{ $now.toISODate() }}' },
  }, { onError: 'continueRegularOutput' });
  b.code('Move Result', [1460, 680], `const r = $('Record Id').item.json;
const base = String(r.instance_url || '').replace(/\\/$/, '');
return { json: {
  contact_id: r.contact_id,
  crm_record_id: r.crm_record_id,
  crm_record_type: r.crm_record_type,
  crm_record_url: base && r.crm_record_id ? base + '/' + r.crm_record_id : '',
  task_id: $json.id || '',
  error: r.crm_error || ($json.error ? 'Task: ' + String($json.error.message || $json.error) : ''),
} };`, {}, 'runOnceForEachItem');
  b.connect('Route', 'Has Account?', { output: 2 });
  b.connect('Has Account?', 'Create Contact', { output: 0 });
  b.connect('Has Account?', 'Create Lead', { output: 1 });
  b.connect('Create Contact', 'Merge Records', { input: 0 });
  b.connect('Create Lead', 'Merge Records', { input: 1 });
  b.chain('Merge Records', 'Record Id', 'Create Task', 'Move Result');
  return b.workflow('Connector: Salesforce (CRM)');
}

// ------------------------------------------------------------------ CRM: Google Sheets
function crmSheets() {
  const b = makeBuilder('conn/crm-sheets');
  note(b, 'Connector: Google Sheets (CRM or product-user list)', `The free, no-CRM option. Also works as a **product-user list**: import this connector a second time, point it at your product-user export, and paste that copy's ID into the core Config as \`product_users_connector_id\`.\n\n**Setup:**\n1. Import \`sheet/valari-template.xlsx\` into Google Sheets and fill in the Champions and Customers tabs.\n2. Paste the sheet ID into **Config** (from the URL: /spreadsheets/d/**ID**/edit). Add a Google Sheets credential to each Sheets node.\n3. If your columns are named differently, fix the expressions in **Map Champions** and **Map Accounts**.\n4. Copy this workflow's ID into the core **Config**.\n\n**Actions:** list_champions, list_accounts, record_move (appends a row to the Moves tab).`, 600);
  b.passthroughTrigger('When Called by Core', [-480, 400]);
  b.config('Config', [-240, 400], { sheet_id: 'PASTE_YOUR_GOOGLE_SHEET_ID', champions_tab: 'Champions', customers_tab: 'Customers', moves_tab: 'Moves' }, { includeOther: true });
  b.route('Route', [0, 400], ['list_champions', 'list_accounts', 'record_move']);
  b.chain('When Called by Core', 'Config', 'Route');
  const doc = { __rl: true, mode: 'id', value: "={{ $('Config').first().json.sheet_id }}" };
  const tab = (key) => ({ __rl: true, mode: 'name', value: `={{ $('Config').first().json.${key} }}` });
  b.add('Read Champions', 'n8n-nodes-base.googleSheets', 4.6, [260, 160], { documentId: doc, sheetName: tab('champions_tab'), options: {} }, { executeOnce: true, alwaysOutputData: true });
  const col = (k) => `={{ $json.${k} ?? "" }}`;
  set(b, 'Map Champions', [500, 160], Object.fromEntries(['contact_id', 'full_name', 'work_email', 'linkedin_url', 'last_company', 'last_company_domain', 'last_title', 'role_type', 'owner_ae', 'owner_ae_email', 'owner_ae_slack_id', 'do_not_contact', 'notes'].map((k) => [k, col(k)])));
  b.connect('Route', 'Read Champions', { output: 0 });
  b.connect('Read Champions', 'Map Champions');
  b.add('Read Customers', 'n8n-nodes-base.googleSheets', 4.6, [260, 400], { documentId: doc, sheetName: tab('customers_tab'), options: {} }, { executeOnce: true, alwaysOutputData: true });
  set(b, 'Map Accounts', [500, 400], Object.fromEntries(['domain', 'company_name', 'relationship', 'owner_ae', 'owner_ae_email', 'owner_ae_slack_id'].map((k) => [k, col(k)])));
  b.connect('Route', 'Read Customers', { output: 1 });
  b.connect('Read Customers', 'Map Accounts');
  b.code('Move Rows', [260, 640], `// Values starting with = + - @ would run as spreadsheet formulas, so they are stored as plain text.
const cell = (v) => { const s = String(v ?? ''); return /^[=+\\-@\\t\\r]/.test(s) ? "'" + s : s; };
return $input.all().map((i) => ({ json: {
  recorded_at: new Date().toISOString(),
  contact_id: cell(i.json.contact_id),
  full_name: cell(i.json.full_name),
  old_company: cell(i.json.old_company),
  new_company: cell(i.json.new_company),
  new_company_domain: cell(i.json.new_company_domain),
  new_title: cell(i.json.new_title),
  new_email: cell(i.json.new_email),
  summary: cell(i.json.task_body),
} }));`);
  b.add('Append Move', 'n8n-nodes-base.googleSheets', 4.6, [500, 640], { operation: 'append', documentId: doc, sheetName: tab('moves_tab'), columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} }, { onError: 'continueRegularOutput' });
  b.code('Move Result', [740, 640], `const rows = $('Move Rows').all();
return $input.all().map((i, n) => ({ json: { contact_id: rows[n] ? rows[n].json.contact_id : '', crm_record_id: i.json.error ? '' : 'Moves tab', crm_record_type: 'sheet row', crm_record_url: '', task_id: '', error: i.json.error ? String(i.json.error.message || i.json.error) : '' } }));`);
  b.connect('Route', 'Move Rows', { output: 2 });
  b.chain('Move Rows', 'Append Move', 'Move Result');
  return b.workflow('Connector: Google Sheets (CRM)');
}

// ------------------------------------------------------------------ Signals: Gmail
function signalsGmail() {
  const b = makeBuilder('conn/signals-gmail');
  note(b, 'Connector: Gmail (signals)', `Finds bounces and "no longer with the company" auto-replies.\n\n**Setup:**\n1. Add a Gmail credential for the inbox your reps send from. If each rep sends from their own inbox, have them forward bounce notices to one shared inbox, or duplicate this connector per inbox.\n2. Copy this workflow's ID into the core Config as \`signals_connector_id\`.\n\n**Action:** get_signals.`);
  b.passthroughTrigger('When Called by Core', [-480, 300]);
  b.config('Config', [-240, 300], {
    gmail_search_query: 'newer_than:3d (from:mailer-daemon OR from:postmaster OR subject:("delivery status notification" OR undeliverable OR "undelivered mail" OR "mail delivery failed" OR "returned mail" OR "delivery has failed") OR "no longer with" OR "has left the company" OR "no longer employed" OR "is no longer")',
  }, { includeOther: true });
  b.add('Search Inbox', 'n8n-nodes-base.gmail', 2.1, [0, 300], { resource: 'message', operation: 'getAll', returnAll: false, limit: 100, simple: false, filters: { q: "={{ $('Config').first().json.gmail_search_query }}" }, options: {} }, { executeOnce: true, alwaysOutputData: true });
  b.code('Normalize', [240, 300], `${inline('src/connectors/misc.js')}

// ---- n8n entry ----
return $input.all().map((i) => normalizeGmail(i.json)).filter(Boolean).map((json) => ({ json }));`);
  b.chain('When Called by Core', 'Config', 'Search Inbox', 'Normalize');
  return b.workflow('Connector: Gmail (signals)');
}

// ------------------------------------------------------------------ Lookup: People Data Labs
function lookupPdl() {
  const b = makeBuilder('conn/lookup-pdl');
  note(b, 'Connector: People Data Labs (lookup)', `Looks each person up and returns their current job and work history. The free plan includes 100 lookups a month. A credit is only counted when someone is found.\n\n**Setup:**\n1. On **PDL Request**, create a Header Auth credential: name \`X-Api-Key\`, value your People Data Labs API key.\n2. Copy this workflow's ID into the core Config as one of \`lookup_1_connector_id\` to \`lookup_3_connector_id\`, and name that slot \`people_data_labs\`.\n\n**Action:** lookup_person.`);
  b.passthroughTrigger('When Called by Core', [-480, 300]);
  b.config('Config', [-240, 300], { api_base_url: 'https://api.peopledatalabs.com', min_likelihood: '3' }, { includeOther: true });
  b.code('Keep Lookups', [0, 300], "return $input.all().filter((i) => i.json.action === 'lookup_person');");
  http(b, 'PDL Request', [240, 300], {
    url: "={{ $json.api_base_url + '/v5/person/enrich?pretty=false&min_likelihood=' + $json.min_likelihood + '&' + [['profile', $json.linkedin_url], ['email', $json.work_email], ['name', $json.full_name], ['company', $json.last_company]].filter(p => p[1]).map(p => p[0] + '=' + encodeURIComponent(p[1])).join('&') }}",
  });
  b.code('Summarize', [480, 300], `${inline('src/connectors/pdl.js')}

// ---- n8n entry ----
const summary = summarizeLookup($json);
return { json: { contact_id: $('Keep Lookups').item.json.contact_id, provider: 'people_data_labs', credits_used: summary.found ? 1 : 0, ...summary } };`, {}, 'runOnceForEachItem');
  b.chain('When Called by Core', 'Config', 'Keep Lookups', 'PDL Request', 'Summarize');
  return b.workflow('Connector: People Data Labs (lookup)');
}

// ------------------------------------------------------------------ Lookup: Apollo
function lookupApollo() {
  const b = makeBuilder('conn/lookup-apollo');
  note(b, 'Connector: Apollo (lookup)', `Looks each person up with Apollo's People Enrichment and returns their current job, work history and (when Apollo has it) their new work email, so the email finder can be skipped.\n\nApollo only charges a credit when it finds someone. **Phone numbers are never requested** (they cost extra credits).\n\n**Setup:**\n1. On **Apollo Request**, create a Header Auth credential: name \`x-api-key\`, value your Apollo API key (Settings > Integrations > API).\n2. Copy this workflow's ID into the core Config as \`lookup_1_connector_id\` (slot name \`apollo\`), with a monthly budget.\n\n**Action:** lookup_person.`, 600);
  b.passthroughTrigger('When Called by Core', [-480, 300]);
  b.config('Config', [-240, 300], { api_base_url: 'https://api.apollo.io' }, { includeOther: true });
  b.code('Build Requests', [0, 300], `${inline('src/connectors/apollo.js')}

// ---- n8n entry ----
return $input.all()
  .filter((i) => i.json.action === 'lookup_person')
  .map((i) => ({ json: { ...i.json, apollo_body: apolloMatchBody(i.json) } }));`);
  http(b, 'Apollo Request', [240, 300], {
    method: 'POST',
    url: "={{ $json.api_base_url + '/api/v1/people/match' }}",
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.apollo_body) }}',
  });
  b.code('Summarize', [480, 300], `${inline('src/connectors/apollo.js')}

// ---- n8n entry ----
return { json: { contact_id: $('Build Requests').item.json.contact_id, provider: 'apollo', ...summarizeApollo($json) } };`, {}, 'runOnceForEachItem');
  b.chain('When Called by Core', 'Config', 'Build Requests', 'Apollo Request', 'Summarize');
  return b.workflow('Connector: Apollo (lookup)');
}

// ------------------------------------------------------------------ Lookup: Clay (async)
function lookupClay() {
  const b = makeBuilder('conn/lookup-clay');
  note(b, 'Connector: Clay (lookup, answers later)', `Sends each person to a Clay table, where Clay's waterfall checks its data providers. Clay can't answer right away, so this connector returns **pending**; Clay posts the result to the **Lookup Callback** workflow, and the next Daily Run finishes the investigation.\n\nEach person sent counts as one credit against this slot's monthly budget. Valari only sends people the earlier lookup tools couldn't find, and never sends the same person twice within 30 days.\n\n**Setup:**\n1. In Clay, create a table with a **Webhook** source and copy its URL into \`clay_webhook_url\`. If the webhook has an auth token, create a Header Auth credential (name \`x-clay-webhook-auth\`) on **Send to Clay**; otherwise set its authentication to None.\n2. Add your enrichment columns (title, company, company domain, start date, work email).\n3. Add an **HTTP API** column that POSTs \`valari_contact_id\`, \`company_name\`, \`company_domain\`, \`job_title\`, \`job_start_date\`, \`linkedin_url\` and \`work_email\` to the \`callback_url\` sent with each row.\n4. Paste the Lookup Callback's Production URL into \`callback_url\` below.\n5. Copy this workflow's ID into the core Config as \`lookup_2_connector_id\` (slot name \`clay\`).\n\n**Action:** lookup_person.`, 820);
  b.passthroughTrigger('When Called by Core', [-480, 300]);
  b.config('Config', [-240, 300], { clay_webhook_url: 'PASTE_YOUR_CLAY_TABLE_WEBHOOK_URL', callback_url: 'PASTE_YOUR_VALARI_LOOKUP_CALLBACK_URL' }, { includeOther: true });
  b.code('Keep Lookups', [0, 300], "return $input.all().filter((i) => i.json.action === 'lookup_person');");
  http(b, 'Send to Clay', [240, 300], {
    method: 'POST',
    url: '={{ $json.clay_webhook_url }}',
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ valari_contact_id: $json.contact_id, full_name: $json.full_name, first_name: $json.first_name, last_name: $json.last_name, work_email: $json.work_email, linkedin_url: $json.linkedin_url, last_company: $json.last_company, last_company_domain: $json.last_company_domain, last_title: $json.last_title, callback_url: $json.callback_url }) }}',
  });
  b.code('Mark Pending', [480, 300], `const req = $('Keep Lookups').item.json;
const failed = !!$json.error;
return { json: {
  contact_id: req.contact_id,
  provider: 'clay',
  found: false,
  pending: !failed,
  credits_used: failed ? 0 : 1,
  note: failed ? 'Lookup failed: could not send to Clay (' + String($json.error.message || $json.error).slice(0, 160) + ')' : 'Sent to Clay. Waiting for the result.',
} };`, {}, 'runOnceForEachItem');
  b.chain('When Called by Core', 'Config', 'Keep Lookups', 'Send to Clay', 'Mark Pending');
  return b.workflow('Connector: Clay (lookup)');
}

// ------------------------------------------------------------------ Email finder: Hunter
function emailHunter() {
  const b = makeBuilder('conn/email-hunter');
  note(b, 'Connector: Hunter (new work email)', `Finds the switcher's work email at their new company. Hunter's free plan includes a small monthly allowance of credits, and no credit is charged when no email is found.\n\n**Setup:**\n1. On **Hunter Request**, create a Header Auth credential: name \`X-API-KEY\`, value your Hunter API key.\n2. Copy this workflow's ID into the core Config as \`email_finder_connector_id\`.\n\n**Action:** find_email.`);
  b.passthroughTrigger('When Called by Core', [-480, 300]);
  b.config('Config', [-240, 300], { api_base_url: 'https://api.hunter.io' }, { includeOther: true });
  b.code('Keep Requests', [0, 300], "return $input.all().filter((i) => i.json.action === 'find_email' && i.json.domain);");
  http(b, 'Hunter Request', [240, 300], {
    url: "={{ $json.api_base_url + '/v2/email-finder?domain=' + encodeURIComponent($json.domain) + ($json.first_name && $json.last_name ? '&first_name=' + encodeURIComponent($json.first_name) + '&last_name=' + encodeURIComponent($json.last_name) : '&full_name=' + encodeURIComponent($json.full_name || '')) }}",
  });
  b.code('Map Result', [480, 300], `${inline('src/connectors/misc.js')}

// ---- n8n entry ----
return { json: mapHunter($('Keep Requests').item.json, $json) };`, {}, 'runOnceForEachItem');
  b.chain('When Called by Core', 'Config', 'Keep Requests', 'Hunter Request', 'Map Result');
  return b.workflow('Connector: Hunter (email finder)');
}

// ------------------------------------------------------------------ Sequence: Salesloft
function sequenceSalesloft() {
  const b = makeBuilder('conn/sequence-salesloft');
  note(b, 'Connector: Salesloft (sequence)', `Adds each confirmed switcher to the right cadence, with the draft opener saved as a note on the person.\n\n**Setup:**\n1. Create a Header Auth credential: name \`Authorization\`, value \`Bearer YOUR_SALESLOFT_API_KEY\`, and select it on every HTTP node.\n2. In **Config**, map each account bucket to a cadence ID: \`net_new\`, \`lost_deal\`, \`open_deal\`, \`customer\` (and an optional \`default\`). Buckets without a cadence are skipped.\n3. **Make the first step of each cadence a manual email** so the rep reviews it before anything is sent.\n4. Optional: \`user_ids_by_email\` maps rep emails to Salesloft user IDs so people land in the right rep's cadence. Otherwise the API key's user is used (use team cadences).\n5. Copy this workflow's ID into the core Config as \`sequence_connector_id\`.\n\n**Action:** enroll.`, 720);
  b.passthroughTrigger('When Called by Core', [-480, 400]);
  b.config('Config', [-240, 400], {
    api_base_url: 'https://api.salesloft.com',
    cadence_ids: '{"net_new": {"id": 0, "name": "Job switchers: net new"}, "lost_deal": {"id": 0, "name": "Job switchers: lost deal"}, "open_deal": {"id": 0, "name": "Job switchers: open deal"}, "customer": {"id": 0, "name": "Job switchers: existing customer"}}',
    user_ids_by_email: '{}',
  }, { includeOther: true });
  b.code('Plan', [0, 400], `${inline('src/connectors/misc.js')}

// ---- n8n entry ----
const cfg = $input.first().json;
const parse = (s, d) => { try { return typeof s === 'object' ? s : JSON.parse(s || ''); } catch (e) { return d; } };
const cads = parse(cfg.cadence_ids, {});
for (const k of Object.keys(cads)) if (cads[k] && typeof cads[k] === 'object' && !Number(cads[k].id)) delete cads[k];
return planSalesloft($input.all().map((i) => i.json), cads, parse(cfg.user_ids_by_email, {})).map((json) => ({ json }));`);
  b.ifTrue('Can Enroll?', [240, 400], "={{ !$json.skip_reason }}");
  http(b, 'Find Person', [480, 260], { url: "={{ $json.api_base_url + '/v2/people?email_addresses[]=' + encodeURIComponent($json.email) }}" });
  b.ifTrue('Need to Create?', [720, 260], '={{ !($json.data && $json.data.length) }}');
  http(b, 'Create Person', [960, 160], {
    method: 'POST',
    url: "={{ $('Plan').item.json.api_base_url + '/v2/people' }}",
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify(Object.fromEntries(Object.entries({ email_address: $('Plan').item.json.email, first_name: $('Plan').item.json.first_name, last_name: $('Plan').item.json.last_name, title: $('Plan').item.json.title, owner_id: $('Plan').item.json.user_id ? Number($('Plan').item.json.user_id) : undefined }).filter(([k, v]) => v !== undefined && v !== ''))) }}",
  });
  b.add('Merge People', 'n8n-nodes-base.merge', 3.2, [1200, 260], {});
  b.code('Person Id', [1440, 260], `const req = $('Plan').item.json;
const d = $json.data;
const person = Array.isArray(d) ? d[0] : d;
return { json: { ...req, person_id: person && person.id ? String(person.id) : '', person_error: $json.error ? String($json.error.message || $json.error) : '' } };`, {}, 'runOnceForEachItem');
  http(b, 'Add to Cadence', [1680, 260], {
    method: 'POST',
    url: "={{ $json.api_base_url + '/v2/cadence_memberships?person_id=' + $json.person_id + '&cadence_id=' + $json.cadence_id + ($json.user_id ? '&user_id=' + $json.user_id : '') }}",
  });
  http(b, 'Add Note', [1920, 260], {
    method: 'POST',
    url: "={{ $('Person Id').item.json.api_base_url + '/v2/notes' }}",
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ content: 'Added by Valari (' + ($('Person Id').item.json.priority || 'move') + ').\\n\\n' + ($('Person Id').item.json.note || ''), associated_with_type: 'person', associated_with_id: Number($('Person Id').item.json.person_id) }) }}",
  });
  b.code('Enrolled', [2160, 260], `const p = $('Person Id').item.json;
const m = $('Add to Cadence').item.json;
const err = p.person_error || (!p.person_id ? 'could not find or create the person' : '') || (m.error ? String(m.error.message || m.error) : '');
return { json: { contact_id: p.contact_id, enrolled: !err, cadence_id: p.cadence_id, cadence_name: p.cadence_name, person_id: p.person_id, message: err ? err.slice(0, 200) : '' } };`, {}, 'runOnceForEachItem');
  b.code('Skipped', [480, 560], "return $input.all().map((i) => ({ json: { contact_id: i.json.contact_id, enrolled: false, cadence_id: '', cadence_name: '', person_id: '', message: i.json.skip_reason } }));");
  b.add('Results', 'n8n-nodes-base.merge', 3.2, [2400, 400], {});
  b.chain('When Called by Core', 'Config', 'Plan', 'Can Enroll?');
  b.connect('Can Enroll?', 'Find Person', { output: 0 });
  b.connect('Can Enroll?', 'Skipped', { output: 1 });
  b.connect('Find Person', 'Need to Create?');
  b.connect('Need to Create?', 'Create Person', { output: 0 });
  b.connect('Need to Create?', 'Merge People', { output: 1, input: 1 });
  b.connect('Create Person', 'Merge People', { input: 0 });
  b.chain('Merge People', 'Person Id', 'Add to Cadence', 'Add Note', 'Enrolled');
  b.connect('Enrolled', 'Results', { input: 0 });
  b.connect('Skipped', 'Results', { input: 1 });
  return b.workflow('Connector: Salesloft (sequence)');
}

// ------------------------------------------------------------------ Alerts: Slack
function alertSlack() {
  const b = makeBuilder('conn/alert-slack');
  note(b, 'Connector: Slack (alerts and digest)', `Posts move, [VERIFY] and "call now" alerts (with @mentions from the team directory) and the digest.\n\n**Setup:**\n1. Create a Slack incoming webhook for your alerts channel and paste it into **Config**. Optional: a second webhook for the digest.\n2. Copy this workflow's ID into the core Config (Daily Run, Digest and Call Now workflows) as \`alert_connector_id\`.\n\n**Actions:** alert, digest.`);
  b.passthroughTrigger('When Called by Core', [-480, 300]);
  b.config('Config', [-240, 300], { slack_webhook_url: 'PASTE_YOUR_SLACK_INCOMING_WEBHOOK_URL', digest_webhook_url: '' }, { includeOther: true });
  b.route('Route', [0, 300], ['alert', 'digest']);
  const post = (name, pos, urlExpr) => b.add(name, 'n8n-nodes-base.httpRequest', 4.2, pos, { method: 'POST', url: urlExpr, sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ text: $json.text_md }) }}', options: {} }, { onError: 'continueRegularOutput' });
  post('Post Alert', [260, 200], '={{ $json.slack_webhook_url }}');
  post('Post Digest', [260, 400], '={{ $json.digest_webhook_url || $json.slack_webhook_url }}');
  b.chain('When Called by Core', 'Config', 'Route');
  b.connect('Route', 'Post Alert', { output: 0 });
  b.connect('Route', 'Post Digest', { output: 1 });
  return b.workflow('Connector: Slack (alerts)');
}

// ------------------------------------------------------------------ Alerts: Gmail
function alertGmail() {
  const b = makeBuilder('conn/alert-gmail');
  note(b, 'Connector: Gmail (alerts and digest)', `Emails each alert to the owning rep (cc'ing the champion's AE when someone else owns the new account) and emails the digest.\n\n**Setup:**\n1. Add a Gmail credential to both Gmail nodes.\n2. In **Config**, set \`digest_recipients\` and a \`fallback_recipient\` for alerts with no owner email (add rep emails in the core team directory).\n3. Copy this workflow's ID into the core Config as \`alert_connector_id\`.\n\n**Actions:** alert, digest.`);
  b.passthroughTrigger('When Called by Core', [-480, 300]);
  b.config('Config', [-240, 300], { digest_recipients: 'gtm-team@yourcompany.example', fallback_recipient: 'gtm-team@yourcompany.example' }, { includeOther: true });
  b.route('Route', [0, 300], ['alert', 'digest']);
  b.add('Email Owner', 'n8n-nodes-base.gmail', 2.1, [260, 200], { resource: 'message', operation: 'send', sendTo: '={{ $json.to_email || $json.fallback_recipient }}', subject: '={{ $json.subject }}', emailType: 'html', message: '={{ $json.html }}', options: { ccList: '={{ $json.cc_email }}', appendAttribution: false } }, { onError: 'continueRegularOutput' });
  b.add('Email Digest', 'n8n-nodes-base.gmail', 2.1, [260, 400], { resource: 'message', operation: 'send', sendTo: '={{ $json.digest_recipients }}', subject: '={{ $json.subject }}', emailType: 'html', message: '={{ $json.html }}', options: { appendAttribution: false } }, { onError: 'continueRegularOutput' });
  b.chain('When Called by Core', 'Config', 'Route');
  b.connect('Route', 'Email Owner', { output: 0 });
  b.connect('Route', 'Email Digest', { output: 1 });
  return b.workflow('Connector: Gmail (alerts)');
}

module.exports = {
  'connectors/crm-salesforce.json': crmSalesforce,
  'connectors/crm-google-sheets.json': crmSheets,
  'connectors/signals-gmail.json': signalsGmail,
  'connectors/lookup-apollo.json': lookupApollo,
  'connectors/lookup-clay.json': lookupClay,
  'connectors/lookup-people-data-labs.json': lookupPdl,
  'connectors/email-hunter.json': emailHunter,
  'connectors/sequence-salesloft.json': sequenceSalesloft,
  'connectors/alert-slack.json': alertSlack,
  'connectors/alert-gmail.json': alertGmail,
};
