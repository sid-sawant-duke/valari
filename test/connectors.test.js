const test = require('node:test');
const assert = require('node:assert');
const { summarizeLookup } = require('../src/connectors/pdl');
const { mergeSalesforceAccounts } = require('../src/connectors/salesforce');
const { normalizeGmail, mapHunter, planSalesloft } = require('../src/connectors/misc');

test('PDL summary trims the response and sorts experience newest first', () => {
  const s = summarizeLookup({ status: 200, likelihood: 8, data: { full_name: 'jordan avery', job_title: 'staff data analyst', job_company_name: 'acme', job_company_website: 'acme.example', job_start_date: '2026-09', emails: true, experience: [
    { company: { name: 'northwind' }, title: { name: 'senior data analyst' }, start_date: '2021-03', end_date: '2026-08' },
    { company: { name: 'acme', website: 'acme.example' }, title: { name: 'staff data analyst' }, start_date: '2026-09', end_date: null, is_primary: true },
  ] } });
  assert.strictEqual(s.found, true);
  assert.strictEqual(s.experience[0].company, 'acme');
  assert.ok(!('emails' in s));
  assert.match(summarizeLookup({ error: { message: '404 - not found' } }).note, /not evidence/);
  assert.match(summarizeLookup({ error: '401 - invalid key' }).note, /Lookup failed/);
  assert.match(summarizeLookup({ error: { message: 'Credentials not found' } }).note, /Lookup failed/, 'missing credential is a failure, not a no-match');
});

test('Salesforce accounts merge to the strongest relationship per domain', () => {
  const a = mergeSalesforceAccounts(
    [{ Id: '001A', Name: 'Acme', Website: 'https://www.acme.example/', OwnerId: '005A', Owner: { Name: 'Marcus', Email: 'Marcus@us.example' } }],
    [
      { AccountId: '001A', Account: { Name: 'Acme', Website: 'acme.example' }, IsClosed: false, OwnerId: '005B', Owner: { Name: 'Other' } },
      { AccountId: '001Z', Account: { Name: 'Zeta', Website: 'zeta.example' }, IsClosed: true, IsWon: false, OwnerId: '005C', Owner: { Name: 'Priya', Email: 'priya@us.example' } },
      { AccountId: '001Q', Account: { Name: 'Quill', Website: 'quill.example' }, IsClosed: false, OwnerId: '005D', Owner: { Name: 'Dee' } },
      { AccountId: '001N', Account: { Name: 'No site' }, IsClosed: false },
    ],
  );
  const by = Object.fromEntries(a.map((x) => [x.domain, x]));
  assert.strictEqual(by['acme.example'].relationship, 'customer');
  assert.strictEqual(by['acme.example'].owner_ae_email, 'marcus@us.example');
  assert.strictEqual(by['zeta.example'].relationship, 'lost_deal');
  assert.strictEqual(by['quill.example'].relationship, 'open_deal');
  assert.strictEqual(a.length, 3);
});

test('Gmail, Hunter and Salesloft mapping', () => {
  const g = normalizeGmail({ id: 'm1', subject: 'Undeliverable', from: { text: 'postmaster@x.example', value: [{ address: 'postmaster@x.example' }] }, text: 'failed', date: '2026-10-20T00:00:00.000Z', headers: { a: 'b' } });
  assert.strictEqual(g.from, 'postmaster@x.example');
  assert.strictEqual(normalizeGmail({}), null);

  const h = mapHunter({ contact_id: '003A' }, { data: { email: 'jordan@acme.example', score: 96, verification: { status: 'valid' } } });
  assert.deepStrictEqual([h.email, h.status, h.confidence], ['jordan@acme.example', 'valid', 96]);
  assert.strictEqual(mapHunter({ contact_id: '003A' }, { data: { email: null } }).email, '');
  assert.strictEqual(mapHunter({ contact_id: '003A' }, { data: { email: 'x@y.example', verification: { status: 'accept_all' } } }).status, 'risky');

  const plan = planSalesloft(
    [{ action: 'enroll', contact_id: 'A', email: 'a@x.example', cadence_key: 'net_new', owner_email: 'Priya@us.example' }, { action: 'enroll', contact_id: 'B', email: 'b@x.example', cadence_key: 'customer' }, { action: 'noop' }],
    { net_new: { id: 123, name: 'Job switchers: net new' } },
    { 'priya@us.example': 77 },
  );
  assert.strictEqual(plan.length, 2);
  assert.deepStrictEqual([plan[0].cadence_id, plan[0].cadence_name, plan[0].user_id, plan[0].skip_reason], ['123', 'Job switchers: net new', '77', '']);
  assert.match(plan[1].skip_reason, /no cadence set for "customer"/);
});
