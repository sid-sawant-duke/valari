// End-to-end test inside a real n8n instance.
// Real: core workflows, data tables, Apollo / Clay / PDL / Hunter / Salesloft / Slack connectors (pointed at a local mock API),
// the Lookup Callback, and the waterfall with credit budgets.
// the AI agent node (OpenAI node pointed at a mock model). Stubbed: CRM and signals (they need real Google/Salesforce accounts).
const fs = require('fs');
const http = require('http');
const assert = require('assert');
const { api, login, createWorkflow, runWorkflow, out, publish } = require('./api');
const REPO = require('path').join(__dirname, '..', '..');
const MOCK = 'http://127.0.0.1:9997';
const load = (f) => JSON.parse(fs.readFileSync(`${REPO}/workflows/${f}`, 'utf8'));

// ---------------------------------------------------------------- mock API server
const hits = [];
const people = {};
let nextPerson = 500;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, MOCK);
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    hits.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: req.headers });
    if (url.pathname === '/slack') return res.end('ok');
    if (url.pathname === '/clay') return json(200, { ok: true });
    if (url.pathname === '/api/v1/people/match') {
      const b = JSON.parse(body || '{}');
      if (b.reveal_phone_number !== false) return json(400, { error: 'phone reveal must be off' });
      if ((b.linkedin_url || '').includes('jordan')) return json(200, { person: { name: 'Jordan Avery', title: 'Staff Data Analyst', email: 'jordan.avery@acme.example', email_status: 'verified', organization: { name: 'Acme', primary_domain: 'acme.example' }, employment_history: [{ organization_name: 'Acme', title: 'Staff Data Analyst', start_date: '2026-09-01', current: true }, { organization_name: 'Northwind', title: 'Senior Data Analyst', start_date: '2021-02-01', end_date: '2026-08-01', current: false }] } });
      return json(200, { person: null });
    }
    if (url.pathname === '/v5/person/enrich') {
      const profile = url.searchParams.get('profile') || '';
      if (profile.includes('jordan')) return json(200, { status: 200, likelihood: 9, data: { full_name: 'jordan avery', job_title: 'staff data analyst', job_company_name: 'acme', job_company_website: 'acme.example', job_start_date: '2026-09', job_last_verified: '2026-10-15', experience: [{ company: { name: 'acme', website: 'acme.example' }, title: { name: 'staff data analyst' }, start_date: '2026-09', end_date: null, is_primary: true }, { company: { name: 'northwind' }, title: { name: 'senior data analyst' }, start_date: '2021-02', end_date: '2026-08' }] } });
      if (profile.includes('lee')) return json(200, { status: 200, likelihood: 8, data: { full_name: 'lee park', job_title: 'operations manager', job_company_name: 'zeta labs', job_company_website: 'zeta.example', job_start_date: '2026-08', experience: [] } });
      return json(404, { status: 404, error: { type: 'not_found', message: 'No records were found matching your request' } });
    }
    if (url.pathname === '/v2/email-finder') {
      const domain = url.searchParams.get('domain');
      if (domain === 'acme.example') return json(200, { data: { email: 'jordan.avery@acme.example', score: 96, verification: { status: 'valid' } } });
      if (domain === 'zeta.example') return json(200, { data: { email: 'lee@zeta.example', score: 71, verification: { status: 'accept_all' } } });
      return json(200, { data: { email: null } });
    }
    if (url.pathname === '/v2/people' && req.method === 'GET') {
      const email = url.searchParams.get('email_addresses[]');
      return json(200, { data: people[email] ? [people[email]] : [] });
    }
    if (url.pathname === '/v2/people' && req.method === 'POST') {
      const b = JSON.parse(body || '{}');
      const p = { id: nextPerson++, email_address: b.email_address };
      people[b.email_address] = p;
      return json(200, { data: p });
    }
    if (url.pathname === '/v2/cadence_memberships') return json(200, { data: { id: 9001, person: { id: Number(url.searchParams.get('person_id')) }, cadence: { id: Number(url.searchParams.get('cadence_id')) } } });
    if (url.pathname === '/v2/notes') return json(200, { data: { id: 7001 } });
    if (url.pathname === '/v1/chat/completions') {
      const b = JSON.parse(body || '{}');
      const msgs = b.messages || [];
      const user = msgs.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const usedTool = msgs.some((m) => m.role === 'tool');
      let verdict;
      if (/"job_company_name": "acme"/i.test(user)) verdict = { outcome: 'confirmed', confidence: 'high', new_company: 'Acme', new_company_domain: 'acme.example', new_title: 'Staff Data Analyst', started_new_role: '2026-09', side_role: false, icp_fit: 'strong', evidence: '- Apollo: Staff Data Analyst at Acme since 2026-09', draft_opener: 'Congrats on joining Acme! You built a great analytics practice at Northwind. Happy to help you get set up there.' };
      else if (/"job_company_name": "zeta labs"/i.test(user)) verdict = { outcome: 'confirmed', confidence: 'medium', new_company: 'Zeta Labs', new_company_domain: 'zeta.example', new_title: 'Operations Manager', started_new_role: '2026-08', side_role: false, icp_fit: 'partial', evidence: '- Clay: Operations Manager at Zeta Labs since 2026-08', draft_opener: 'Congrats on the move to Zeta Labs!' };
      else verdict = { outcome: 'no_change', confidence: 'low', new_company: '', new_company_domain: '', new_title: '', started_new_role: '', side_role: false, icp_fit: 'unknown', evidence: '- No lookup tool found a current role', draft_opener: '' };
      const call = usedTool ? { name: 'format_final_json_response', args: { output: verdict } } : { name: 'thinking_tool', args: { thought: 'Checking the lookup against the signal.' } };
      return json(200, { id: 'x', object: 'chat.completion', created: 1, model: b.model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: `c${hits.length}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    json(404, { error: 'unmocked ' + url.pathname });
  });
});

// ---------------------------------------------------------------- helpers
function setConfig(wf, nodeName, values) {
  const n = wf.nodes.find((x) => x.name === nodeName);
  for (const [k, v] of Object.entries(values)) {
    const a = n.parameters.assignments.assignments.find((x) => x.name === k);
    if (!a) throw new Error(`no config ${k} on ${wf.name}/${nodeName}`);
    a.value = v;
  }
}
const withCred = (wf, cred) => {
  for (const n of wf.nodes) if (n.type === 'n8n-nodes-base.httpRequest' && n.parameters.genericAuthType === 'httpHeaderAuth') n.credentials = { httpHeaderAuth: { id: cred.id, name: cred.name } };
  return wf;
};
const stub = (name, js) => ({
  name, settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner' },
  nodes: [
    { id: 't', name: 'When Called by Core', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 0], parameters: { inputSource: 'passthrough' } },
    { id: 'c', name: 'Stub', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0], parameters: { jsCode: js } },
  ],
  connections: { 'When Called by Core': { main: [[{ node: 'Stub', type: 'main', index: 0 }]] } },
});
async function tableRows(name) {
  const tables = await api('GET', `/rest/projects/${projectId}/data-tables?take=50`);
  const t = (tables.data || tables).find((x) => x.name === name);
  if (!t) return [];
  const rows = await api('GET', `/rest/projects/${projectId}/data-tables/${t.id}/rows?take=500`);
  return rows.data || rows;
}
let projectId;

(async () => {
  await new Promise((r) => server.listen(9997, r));
  await login();
  const projects = await api('GET', '/rest/projects/my-projects');
  projectId = (projects.find((p) => p.type === 'personal') || projects[0]).id;
  // clean old test tables so results are deterministic
  try {
    const tables = await api('GET', `/rest/projects/${projectId}/data-tables?take=50`);
    for (const t of (tables.data || tables)) if (t.name.startsWith('valari_')) await api('DELETE', `/rest/projects/${projectId}/data-tables/${t.id}`);
  } catch (e) { console.log('table cleanup skipped:', e.message.slice(0, 120)); }

  const headerCred = await api('POST', '/rest/credentials', { name: 'Mock header', type: 'httpHeaderAuth', data: { name: 'X-Api-Key', value: 'test' } });
  const aiCred = await api('POST', '/rest/credentials', { name: 'Mock OpenAI', type: 'openAiApi', data: { apiKey: 'sk-test', url: `${MOCK}/v1` } });

  // ---- connectors (real ones point at the mock API)
  const pdl = load('connectors/lookup-people-data-labs.json'); setConfig(pdl, 'Config', { api_base_url: MOCK });
  const apollo = load('connectors/lookup-apollo.json'); setConfig(apollo, 'Config', { api_base_url: MOCK });
  const clay = load('connectors/lookup-clay.json'); setConfig(clay, 'Config', { clay_webhook_url: `${MOCK}/clay`, callback_url: 'https://n8n.example/webhook/valari-lookup-callback' });
  const hunter = load('connectors/email-hunter.json'); setConfig(hunter, 'Config', { api_base_url: MOCK });
  const sl = load('connectors/sequence-salesloft.json'); setConfig(sl, 'Config', { api_base_url: MOCK, cadence_ids: '{"net_new": {"id": 11, "name": "Switchers: net new"}, "open_deal": {"id": 22, "name": "Switchers: open deal"}}', user_ids_by_email: '{"marcus@us.example": 42}' });
  const slack = load('connectors/alert-slack.json'); setConfig(slack, 'Config', { slack_webhook_url: `${MOCK}/slack`, digest_webhook_url: '' });
  const ids = {};
  const created = [];
  for (const [k, wf] of Object.entries({ pdl, apollo, clay, hunter, sl, slack })) { const w = await createWorkflow(withCred(wf, headerCred)); ids[k] = w.id; created.push(w); }
  const crmW = await createWorkflow(stub('Stub CRM', `
const action = $input.first().json.action;
if (action === 'list_champions') return [
  { contact_id: '003A', first_name: 'Jordan', last_name: 'Avery', work_email: 'jordan.avery@northwind.example', linkedin_url: 'https://www.linkedin.com/in/example-jordan', last_company: 'Northwind', last_company_domain: 'northwind.example', last_title: 'Senior Data Analyst', role_type: 'champion', owner_ae_email: 'priya@us.example', notes: 'Ran the analytics rollout.' },
  { contact_id: '003B', full_name: 'Sam Okafor', work_email: 'sam@brightcart.example', last_company: 'Brightcart', role_type: 'buyer', owner_ae_email: 'priya@us.example' },
  { contact_id: '003C', full_name: 'Riley Chen', work_email: 'riley@harbor.example', last_company: 'Harbor', do_not_contact: 'TRUE' },
].map((json) => ({ json }));
if (action === 'list_accounts') return [{ json: { domain: 'acme.example', company_name: 'Acme', relationship: 'open_deal', crm_account_id: '001ACME', owner_ae: 'Marcus Lee', owner_ae_email: 'marcus@us.example', owner_crm_id: '005M' } }];
if (action === 'record_move') return $input.all().map((i) => ({ json: { contact_id: i.json.contact_id, crm_record_id: i.json.crm_account_id ? '003NEW' : '00QNEW', crm_record_type: i.json.crm_account_id ? 'contact' : 'lead', crm_record_url: 'https://acme.my.salesforce.com/' + (i.json.crm_account_id ? '003NEW' : '00QNEW'), task_id: '00T1', got_email: i.json.new_email } }));
return [];`));
  ids.crm = crmW.id; created.push(crmW);
  const productW = await createWorkflow(stub('Stub Product Users', `return [{ json: { work_email: 'lee@oldco.example', full_name: 'Lee Park', linkedin_url: 'https://www.linkedin.com/in/example-lee', last_company: 'OldCo', role_type: 'user' } }];`));
  ids.product = productW.id; created.push(productW);
  const signalsW = await createWorkflow(stub('Stub Gmail', `return [
  { json: { id: 'm1', subject: 'Delivery Status Notification (Failure)', from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', headers: {}, text: "Your message wasn't delivered to jordan.avery@northwind.example", date: '2026-10-20T14:00:00.000Z' } },
  { json: { id: 'm2', subject: 'Automatic reply: hello', from: 'Sam Okafor <sam@brightcart.example>', headers: {}, text: 'Sam is no longer with Brightcart.', date: '2026-10-21T09:00:00.000Z' } },
  { json: { id: 'm3', subject: 'Undeliverable: quick question', from: 'postmaster@oldco.example', headers: {}, text: 'lee@oldco.example could not be delivered', date: '2026-10-21T10:00:00.000Z' } },
];`));
  ids.signals = signalsW.id; created.push(signalsW);
  // Connectors must be published so scheduled and callback-triggered runs can call them (as in production).
  for (const w of created) await publish(w);

  // ---- Daily Run
  const daily = load('core/1-daily-run.json');
  setConfig(daily, 'Config', {
    crm_connector_id: ids.crm, product_users_connector_id: ids.product, signals_connector_id: ids.signals,
    // Apollo first with a budget of 1 (so the budget pause and the 80% warning fire), then Clay, then PDL.
    lookup_1_name: 'apollo', lookup_1_connector_id: ids.apollo, lookup_1_monthly_budget: 1,
    lookup_2_name: 'clay', lookup_2_connector_id: ids.clay, lookup_2_monthly_budget: 50,
    lookup_3_name: 'people_data_labs', lookup_3_connector_id: ids.pdl, lookup_3_monthly_budget: 100,
    email_finder_connector_id: ids.hunter, sequence_connector_id: ids.sl, alert_connector_id: ids.slack,
    product_description: 'An analytics platform that data teams use to build dashboards.',
    icp_description: 'Mid-market software companies with in-house data teams.',
    personas: JSON.stringify([{ name: 'Analyst', keywords: ['data analyst', 'analytics', 'analyst'], points: 25 }, { name: 'Ops', keywords: ['revops', 'operations', 'ops'], points: 20 }]),
    team_directory: JSON.stringify({ 'priya@us.example': { name: 'Priya Shah', slack_id: 'U1' }, 'marcus@us.example': { name: 'Marcus Lee', slack_id: 'U2', salesloft_user_id: '42' }, default: { name: 'SDR queue', slack_id: 'S0', email: 'sdr@us.example' } }),
  });
  const cm = daily.nodes.find((n) => n.name === 'Chat Model');
  Object.assign(cm, { type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.2, parameters: { model: { __rl: true, mode: 'id', value: 'gpt-mock' }, options: {} }, credentials: { openAiApi: { id: aiCred.id, name: aiCred.name } } });
  const dw = await createWorkflow(daily);
  await publish(dw);
  const r = await runWorkflow(dw, 'Every Morning');
  console.log('DAILY RUN:', r.status, r.error ? `${r.error.message} @ ${r.error.node && r.error.node.name}` : '');
  for (const [name, runs] of Object.entries(r.runData)) {
    const items = runs[0].data?.main?.[0]?.length ?? 0;
    const err = runs[0].error ? ` ERROR ${runs[0].error.message}` : '';
    console.log(`  ${name}: ${items} items${runs.length > 1 ? ` (${runs.length} runs)` : ''}${err}`);
  }
  assert.strictEqual(r.status, 'success');
  const decisions = out(r.runData, 'Score and Route');
  console.log('\n  decisions:', decisions.map((d) => `${d.candidate.contact_id}=${d.outcome}/${d.score}/${d.persona}/${d.bucket}`).join(', '));
  const cases = await tableRows('valari_cases');
  const state = await tableRows('valari_state');
  console.log('  cases table:', cases.map((c) => `${c.contact_id}:${c.outcome}:${c.score}:${c.sequence_status}:${c.new_email}`).join(' | '));
  console.log('  state table:', state.map((s) => `${s.contact_id}:${s.status}`).join(' | '));
  const slackPosts = hits.filter((h) => h.path === '/slack').map((h) => JSON.parse(h.body).text);
  console.log(`\n  Slack posts: ${slackPosts.length}`);
  slackPosts.forEach((t) => console.log('  ---\n  ' + t.split('\n').join('\n  ')));
  const slCalls = hits.filter((h) => h.path.startsWith('/v2/') && h.path !== '/v2/email-finder').map((h) => `${h.method} ${h.path} ${JSON.stringify(h.query)}`);
  const apolloCalls = hits.filter((h) => h.path === '/api/v1/people/match').map((h) => JSON.parse(h.body));
  const clayCalls = hits.filter((h) => h.path === '/clay').map((h) => JSON.parse(h.body));
  const pdlCalls = hits.filter((h) => h.path === '/v5/person/enrich');
  const hunterCalls = hits.filter((h) => h.path === '/v2/email-finder').map((h) => h.query.domain);
  console.log('\n  Apollo calls:', apolloCalls.map((b) => b.linkedin_url || b.email), '| Clay rows:', clayCalls.map((b) => b.valari_contact_id), '| PDL calls:', pdlCalls.length, '| Hunter:', hunterCalls);
  console.log('  Salesloft calls:', slCalls);

  const by = Object.fromEntries(cases.map((c) => [c.contact_id, c]));
  const usage = await tableRows('valari_usage');
  const lookups = await tableRows('valari_lookups');
  console.log('  usage table:', usage.map((u) => `${u.provider}:${u.credits_used}/${u.budget}:${u.warned}`).join(' | '));
  console.log('  lookups table:', lookups.map((l) => `${l.contact_id}:${l.provider}:${l.found}:pending=${l.pending}`).join(' | '));

  // Waterfall and guardrails
  assert.strictEqual(apolloCalls.length, 1, 'Apollo budget of 1: only one lookup');
  assert.ok(apolloCalls.every((b) => b.reveal_phone_number === false), 'never asks Apollo for phone numbers');
  assert.deepStrictEqual(clayCalls.map((b) => b.valari_contact_id).sort(), ['003B', 'product:lee@oldco.example'], 'Clay only gets who Apollo could not cover');
  assert.ok(clayCalls.every((b) => b.callback_url), 'Clay rows carry the callback URL');
  assert.strictEqual(pdlCalls.length, 0, 'PDL not called while Clay is working on them');
  assert.ok(slackPosts.some((t) => /apollo has used 1 of its 1 lookup credits this month \(100%\)/.test(t)), 'budget warning posted');
  assert.deepStrictEqual([usage.find((u) => u.provider === 'apollo').credits_used, usage.find((u) => u.provider === 'apollo').warned], ['1', 'TRUE']);
  assert.strictEqual(usage.find((u) => u.provider === 'clay').credits_used, '2');
  assert.deepStrictEqual(lookups.filter((l) => l.pending === 'TRUE').map((l) => l.contact_id).sort(), ['003B', 'product:lee@oldco.example']);

  // Jordan: found by Apollo, email from Apollo (Hunter skipped), routed to the account owner, enrolled
  assert.strictEqual(by['003A'].outcome, 'confirmed');
  assert.strictEqual(by['003A'].lookup_source, 'apollo');
  assert.strictEqual(by['003A'].new_email, 'jordan.avery@acme.example');
  assert.ok(!hunterCalls.includes('acme.example'), 'Hunter skipped when Apollo has the email');
  assert.strictEqual(by['003A'].sequence_status, 'enrolled');
  assert.ok(slackPosts.some((t) => t.includes('<@U2> this one is yours') && t.includes('_Source: apollo_')), 'owner mentioned, source shown');
  assert.ok(slCalls.some((c) => c.includes('/v2/cadence_memberships') && c.includes('"cadence_id":"22"') && c.includes('"user_id":"42"')));
  assert.strictEqual(state.find((s) => s.contact_id === '003A').status, 'moved');
  // Sam and Lee wait for Clay
  assert.ok(!by['003B'] && !by['product:lee@oldco.example'], 'no case yet while Clay is working');
  assert.strictEqual(state.find((s) => s.contact_id === '003B').status, 'suspect');
  assert.ok(!by['003C'], 'do_not_contact skipped');

  // ---- Lookup Callback: Clay answers for Lee (moved) and Sam (nothing found)
  const cb = load('core/5-lookup-callback.json'); setConfig(cb, 'Config', { daily_run_workflow_id: dw.id });
  const waitForCase = async (id) => {
    for (let i = 0; i < 60; i++) {
      const c = (await tableRows('valari_cases')).find((x) => x.contact_id === id);
      if (c) return c;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('no case for ' + id + ' after the callback');
  };
  hits.length = 0;
  const leePin = { Webhook: [{ json: { headers: {}, params: {}, query: {}, body: { valari_contact_id: 'product:lee@oldco.example', company_name: 'Zeta Labs', company_domain: 'zeta.example', job_title: 'Operations Manager', job_start_date: '2026-08', work_email: 'lee@zeta.example' } } }] };
  const cbw = await createWorkflow({ ...cb, name: 'callback lee' }, leePin);
  const cbr = await runWorkflow(cbw, 'Webhook', leePin);
  console.log('\nCALLBACK (Lee):', cbr.status, cbr.error ? cbr.error.message : '');
  assert.strictEqual(cbr.status, 'success');
  const lee = await waitForCase('product:lee@oldco.example');
  console.log('  case:', lee.outcome, lee.lookup_source, lee.new_email, lee.score, lee.priority);
  assert.deepStrictEqual([lee.outcome, lee.lookup_source, lee.new_email], ['confirmed', 'clay', 'lee@zeta.example']);
  assert.strictEqual(hits.filter((h) => h.path === '/clay').length, 0, 'Clay not asked again');
  assert.strictEqual(hits.filter((h) => h.path === '/v2/email-finder').length, 0, 'Hunter skipped: Clay found the email');

  hits.length = 0;
  const samPin = { Webhook: [{ json: { headers: {}, params: {}, query: {}, body: { valari_contact_id: '003B' } } }] };
  const cbw2 = await createWorkflow({ ...cb, name: 'callback sam' }, samPin);
  await runWorkflow(cbw2, 'Webhook', samPin);
  const sam = await waitForCase('003B');
  console.log('\nCALLBACK (Sam, nothing found):', sam.outcome, '| PDL calls:', hits.filter((h) => h.path === '/v5/person/enrich').length, '| Clay calls:', hits.filter((h) => h.path === '/clay').length, '| Apollo calls:', hits.filter((h) => h.path === '/api/v1/people/match').length);
  assert.strictEqual(sam.outcome, 'verify');
  assert.strictEqual(hits.filter((h) => h.path === '/v5/person/enrich').length, 1, 'falls through to PDL (slot 3)');
  assert.strictEqual(hits.filter((h) => h.path === '/clay').length, 0, 'no loop back to Clay');
  assert.strictEqual(hits.filter((h) => h.path === '/api/v1/people/match').length, 0, 'Apollo stays paused at its budget');

  // ---- Digest
  hits.length = 0;
  const dg = load('core/2-digest.json'); setConfig(dg, 'Config', { alert_connector_id: ids.slack });
  const dr = await runWorkflow(await createWorkflow(dg), 'Every Other Monday');
  console.log('\nDIGEST:', dr.status, dr.error ? dr.error.message : '');
  const digestPost = hits.find((h) => h.path === '/slack');
  console.log('  ' + (digestPost ? JSON.parse(digestPost.body).text.split('\n').join('\n  ') : 'NO POST'));
  assert.ok(digestPost);

  // ---- Call now webhook (manual run with a pinned webhook payload)
  hits.length = 0;
  const en = load('core/3-call-now-webhook.json'); setConfig(en, 'Config', { alert_connector_id: ids.slack });
  const pin = { Webhook: [{ json: { headers: {}, params: {}, query: {}, body: { event_type: 'email_opened', person: { email_address: 'jordan.avery@acme.example' }, subject: 'Congrats on joining Acme!' } } }] };
  const ew = await createWorkflow(en, pin);
  const er = await runWorkflow(ew, 'Webhook', pin);
  console.log('\nCALL NOW:', er.status, er.error ? er.error.message : '');
  const callPost = hits.find((h) => h.path === '/slack');
  console.log('  ' + (callPost ? JSON.parse(callPost.body).text.split('\n').join('\n  ') : 'NO POST'));
  assert.ok(callPost && /Call now/.test(JSON.parse(callPost.body).text));
  const st2 = await tableRows('valari_state');
  assert.ok(st2.find((s) => s.contact_id === '003A').last_engagement_alert_at, 'cooldown timestamp saved');
  // second event inside the cooldown: no alert
  hits.length = 0;
  await runWorkflow(ew, 'Webhook', pin);
  assert.strictEqual(hits.filter((h) => h.path === '/slack').length, 0, 'cooldown respected');
  console.log('  cooldown respected on repeat event');

  // ---- Manual investigation (what the MCP tool does) of an already-moved person: re-checks, no crash
  hits.length = 0;
  const mpin = { 'When Called': [{ json: { contact_id: '003B' } }] };
  const mw = await createWorkflow({ ...daily, name: 'manual copy' }, mpin);
  const mr = await runWorkflow(mw, 'When Called', mpin);
  const mc0 = out(mr.runData, 'Find Candidates');
  console.log('\nMANUAL RUN for 003B:', mr.status, mr.error ? mr.error.message : '', '| candidates:', mc0.map((c) => c.contact_id + ':' + c.trigger).join(','));
  // Sam's auto-reply from this month still counts, so a teammate's request keeps it.
  assert.deepStrictEqual(mc0.map((c) => [c.trigger, c.requested]), [['signal', true]]);

  // ---- MCP import
  const mc = load('core/4-mcp-server.json');
  console.log('\nMCP workflow imported:', (await createWorkflow(mc)).id);
  console.log('\nALL E2E CHECKS PASSED');
  server.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); server.close(); process.exit(1); });
