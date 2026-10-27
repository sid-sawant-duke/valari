// End-to-end test of the single-workflow n8n template inside a real n8n instance.
// Google Sheets, Gmail and Slack nodes run with pinned data; People Data Labs, Hunter and the AI model hit a local mock.
const fs = require('fs');
const http = require('http');
const path = require('path');
const assert = require('assert');
const { api, login, createWorkflow, runWorkflow, out } = require('./api');

const MOCK = 'http://127.0.0.1:9996';
const hits = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, MOCK);
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    hits.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (url.pathname === '/v5/person/enrich') {
      if ((url.searchParams.get('profile') || '').includes('jordan')) return json(200, { status: 200, likelihood: 9, data: { full_name: 'jordan avery', job_title: 'staff ux researcher', job_company_name: 'acme', job_company_website: 'acme.example', job_start_date: '2026-09', experience: [] } });
      return json(404, { status: 404, error: { type: 'not_found', message: 'No records were found' } });
    }
    if (url.pathname === '/v2/email-finder') return json(200, { data: url.searchParams.get('domain') === 'acme.example' ? { email: 'jordan.avery@acme.example', score: 94, verification: { status: 'valid' } } : { email: null } });
    if (url.pathname === '/v1/chat/completions') {
      const b = JSON.parse(body || '{}');
      const msgs = b.messages || [];
      const user = msgs.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const verdict = /"job_company_name": "acme"/.test(user)
        ? { outcome: 'confirmed', confidence: 'high', new_company: 'Acme', new_company_domain: 'acme.example', new_title: 'Staff UX Researcher', started_new_role: '2026-09', side_role: false, icp_fit: 'strong', evidence: '- People Data Labs: Staff UX Researcher at Acme since 2026-09', draft_opener: 'Congrats on joining Acme! Happy to help you get set up there.' }
        : { outcome: 'no_change', confidence: 'low', new_company: '', new_company_domain: '', new_title: '', started_new_role: '', side_role: false, icp_fit: 'unknown', evidence: '- People Data Labs has no matching profile', draft_opener: '' };
      const done = msgs.some((m) => m.role === 'tool');
      const call = done ? { name: 'format_final_json_response', args: { output: verdict } } : { name: 'thinking_tool', args: { thought: 'Checking.' } };
      return json(200, { id: 'x', object: 'chat.completion', created: 1, model: b.model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: `c${hits.length}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    json(404, { error: 'unmocked' });
  });
});

const J = (rows) => rows.map((json) => ({ json }));
let projectId;
async function tableRows(name) {
  const tables = await api('GET', `/rest/projects/${projectId}/data-tables?take=50`);
  const t = (tables.data || tables).find((x) => x.name === name);
  if (!t) return [];
  const rows = await api('GET', `/rest/projects/${projectId}/data-tables/${t.id}/rows?take=500`);
  return rows.data || rows;
}

(async () => {
  await new Promise((r) => server.listen(9996, r));
  await login();
  const projects = await api('GET', '/rest/projects/my-projects');
  projectId = (projects.find((p) => p.type === 'personal') || projects[0]).id;
  const tables = await api('GET', `/rest/projects/${projectId}/data-tables?take=50`);
  for (const t of (tables.data || tables)) if (t.name.startsWith('valari_')) await api('DELETE', `/rest/projects/${projectId}/data-tables/${t.id}`);
  const aiCred = await api('POST', '/rest/credentials', { name: 'Mock OpenAI (template)', type: 'openAiApi', data: { apiKey: 'sk-test', url: `${MOCK}/v1` } });
  const headerCred = await api('POST', '/rest/credentials', { name: 'Mock header (template)', type: 'httpHeaderAuth', data: { name: 'X-Api-Key', value: 'test' } });

  const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'valari-template.json'), 'utf8')
    .replace(/https:\/\/api\.peopledatalabs\.com/g, MOCK).replace(/https:\/\/api\.hunter\.io/g, MOCK);
  const wf = JSON.parse(raw);
  const cfg = wf.nodes.find((n) => n.name === 'Config').parameters.assignments.assignments;
  const set = (k, v) => { cfg.find((a) => a.name === k).value = v; };
  set('google_sheet_id', 'TEST');
  set('find_new_emails', 'true');
  set('personas', JSON.stringify([{ name: 'Researcher', keywords: ['research'], points: 25 }]));
  set('team_directory', JSON.stringify({ 'priya@us.example': { name: 'Priya Shah', slack_id: 'U1' } }));
  wf.nodes.find((n) => n.name === 'Test Contact').parameters.assignments.assignments.find((a) => a.name === 'contact_id').value = '003B';
  for (const n of wf.nodes) if (n.type === 'n8n-nodes-base.httpRequest') n.credentials = { httpHeaderAuth: { id: headerCred.id, name: headerCred.name } };
  const cm = wf.nodes.find((n) => n.name === 'Chat Model');
  Object.assign(cm, { type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.2, parameters: { model: { __rl: true, mode: 'id', value: 'gpt-mock' }, options: {} }, credentials: { openAiApi: { id: aiCred.id, name: aiCred.name } } });

  const pins = {
    'Read Champions': J([
      { row_number: 2, contact_id: '003A', full_name: 'Jordan Avery', work_email: 'jordan.avery@northwind.example', linkedin_url: 'https://www.linkedin.com/in/example-jordan', last_company: 'Northwind', last_company_domain: 'northwind.example', last_title: 'Senior UX Researcher', role_type: 'champion', owner_ae_email: 'priya@us.example', do_not_contact: 'FALSE', notes: 'Ran the research rollout.' },
      { row_number: 3, contact_id: '003B', full_name: 'Sam Okafor', work_email: 'sam@brightcart.example', last_company: 'Brightcart', role_type: 'buyer', owner_ae_email: 'priya@us.example', do_not_contact: 'FALSE' },
    ]),
    'Read Customers': J([{ row_number: 2, domain: 'acme.example', company_name: 'Acme', relationship: 'open_deal', owner_ae: 'Marcus Lee', owner_ae_slack_id: 'U2' }]),
    'Search Inbox': J([
      { id: 'm1', subject: 'Delivery Status Notification (Failure)', from: { value: [{ address: 'mailer-daemon@googlemail.com' }], text: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }, text: "Your message wasn't delivered to jordan.avery@northwind.example", date: '2026-10-20T14:00:00.000Z', headers: {} },
      { id: 'm2', subject: 'Automatic reply: hi', from: { value: [{ address: 'sam@brightcart.example' }], text: 'Sam Okafor <sam@brightcart.example>' }, text: 'Sam is no longer with Brightcart.', date: '2026-10-21T09:00:00.000Z', headers: {} },
    ]),
    'Post Alert to Slack': J([{ ok: true }]),
    'Post Digest to Slack': J([{ ok: true }]),
    'Post Call Now to Slack': J([{ ok: true }]),
  };
  const w = await createWorkflow(wf, pins);

  const daily = await runWorkflow(w, 'Every Morning', pins);
  console.log('DAILY:', daily.status, daily.error ? `${daily.error.message} @ ${daily.error.node && daily.error.node.name}` : '');
  for (const [n, runs] of Object.entries(daily.runData)) if (runs[0].error) console.log('  ERROR', n, runs[0].error.message);
  assert.strictEqual(daily.status, 'success');
  const alerts = out(daily.runData, 'Alert Messages');
  alerts.forEach((a) => console.log('  ---\n  ' + a.text_md.split('\n').join('\n  ')));
  assert.strictEqual(alerts.length, 2);
  assert.match(alerts[0].text_md, /<@U2> this one is yours \(cc <@U1>/);
  assert.match(alerts[0].text_md, /\*New email:\* jordan.avery@acme.example \(valid, 94%\)/);
  assert.match(alerts[0].text_md, /Researcher persona/);
  assert.ok(!/Sequence|CRM:|Salesforce/.test(alerts[0].text_md), 'only steps that are on');
  assert.match(alerts[1].text_md, /\[VERIFY\] Sam Okafor/);
  const cases = await tableRows('valari_cases');
  assert.deepStrictEqual(cases.map((c) => `${c.contact_id}:${c.outcome}`).sort(), ['003A:confirmed', '003B:verify']);

  const digest = await runWorkflow(w, 'Every Other Monday', pins);
  const d = out(digest.runData, 'Build Digest')[0];
  console.log('\nDIGEST:', digest.status, '|', d && d.subject);
  assert.strictEqual(digest.status, 'success');
  assert.match(d.text_md, /Jordan Avery/);

  const hookPins = { ...pins, 'Engagement Webhook': J([{ headers: {}, params: {}, query: {}, body: { event: 'page_view', company: { domain: 'acme.example', name: 'Acme' }, page_url: '/pricing' } }]) };
  const w2 = await createWorkflow({ ...wf, name: wf.name + ' (webhook test)' }, hookPins);
  const hook = await runWorkflow(w2, 'Engagement Webhook', hookPins);
  const call = out(hook.runData, 'Call Now Messages');
  console.log('\nCALL NOW:', hook.status, '|', call[0] && call[0].text_md.split('\n')[0]);
  assert.strictEqual(hook.status, 'success');
  assert.match(call[0].text_md, /Someone from Acme \(where Jordan Avery works now\) just visited your website/);

  const test = await runWorkflow(w, 'Test One Person', pins);
  const cands = out(test.runData, 'Find Candidates');
  console.log('\nTEST ONE PERSON:', test.status, '|', cands.map((c) => `${c.contact_id}:${c.trigger}`).join(', '));
  assert.deepStrictEqual(cands.map((c) => c.trigger), ['manual']);

  console.log('\nALL TEMPLATE CHECKS PASSED');
  server.close();
})().catch((e) => { console.error('TEMPLATE TEST FAILED:', e.message); server.close(); process.exit(1); });
