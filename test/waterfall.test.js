const test = require('node:test');
const assert = require('node:assert');
const { planSlot, collectLookups, isResolved } = require('../src/core/waterfall');
const { normalizeCallback } = require('../src/core/callback');
const { apolloMatchBody, summarizeApollo } = require('../src/connectors/apollo');
const { emailRequests, lookupEmailResults } = require('../src/core/actions');
const { restoreSignals, readyCandidates } = require('../src/core/find-candidates');

const NOW = '2026-10-22T12:00:00Z';
const cfg = {
  lookup_1_name: 'apollo', lookup_1_connector_id: 'A', lookup_1_monthly_budget: 2,
  lookup_2_name: 'clay', lookup_2_connector_id: 'C', lookup_2_monthly_budget: 10,
  lookup_3_name: 'people_data_labs', lookup_3_connector_id: '', lookup_3_monthly_budget: 100,
  lookup_cache_days: 14, lookup_repeat_days: 30, budget_warning_percent: 80,
};
const person = (id, extra = {}) => ({ contact_id: id, full_name: `Person ${id}`, first_name: 'P', last_name: id, work_email: `${id}@old.example`, last_company: 'OldCo', last_company_domain: 'old.example', trigger: 'signal', signal_date: '2026-10-20', ...extra });
const moved = (id, provider = 'apollo') => ({ contact_id: id, provider, found: true, credits_used: 1, job_title: 'Designer', job_company_name: 'Acme', job_company_website: 'acme.example', job_start_date: '2026-09', experience: [] });

test('isResolved: a new company resolves; the old company after a bounce only resolves if verified after it', () => {
  const c = person('a');
  assert.strictEqual(isResolved(c, moved('a')), true);
  const old = { found: true, job_company_name: 'OldCo', job_company_website: 'old.example' };
  assert.strictEqual(isResolved(c, old), false);
  assert.strictEqual(isResolved(c, { ...old, job_last_verified: '2026-10-21' }), true);
  assert.strictEqual(isResolved({ ...c, trigger: 'sweep' }, old), true, 'sweeps accept "still there"');
  assert.strictEqual(isResolved(c, { found: false }), false);
});

test('planSlot: respects the monthly budget, the cache and the no-repeat window', () => {
  const cands = [person('a'), person('b'), person('c'), person('d')];
  const cache = [
    { contact_id: 'c', provider: 'apollo', found: 'TRUE', summary_json: JSON.stringify(moved('c')), looked_up_at: '2026-10-15T00:00:00Z', tried_json: '{}' },
    { contact_id: 'd', provider: 'apollo', found: 'FALSE', summary_json: '{"found":false}', looked_up_at: '2026-10-10T00:00:00Z', tried_json: JSON.stringify({ apollo: '2026-10-10T00:00:00Z' }) },
  ];
  const usage = [{ usage_key: '2026-10:apollo', credits_used: '1' }];
  const r = planSlot(cfg, 1, cands, cache, usage, [], NOW);
  // c is cached, d was tried 12 days ago, a and b want a lookup but only 1 credit is left this month.
  assert.deepStrictEqual(r.requests.map((x) => x.contact_id), ['a']);
  assert.deepStrictEqual(r.budget_skipped, ['b']);
  // manual runs respect the no-repeat window too, so a callback-triggered re-run can't loop back to the same tool
  const m = planSlot({ ...cfg, lookup_1_monthly_budget: '' }, 1, [person('d', { trigger: 'manual' })], cache, usage, [], NOW);
  assert.deepStrictEqual(m.requests, [{ action: 'noop' }]);
});

test('planSlot: later slots only get people the earlier ones could not resolve, and unset or zero-budget slots are skipped', () => {
  const cands = [person('a'), person('b')];
  const prior = [moved('a'), { contact_id: 'b', provider: 'apollo', found: false, credits_used: 0 }];
  assert.deepStrictEqual(planSlot(cfg, 2, cands, [], [], prior, NOW).requests.map((x) => x.contact_id), ['b']);
  assert.deepStrictEqual(planSlot(cfg, 3, cands, [], [], prior, NOW).requests, [{ action: 'noop' }], 'slot 3 not configured');
  assert.deepStrictEqual(planSlot({ ...cfg, lookup_2_monthly_budget: 0 }, 2, cands, [], [], prior, NOW).requests, [{ action: 'noop' }]);
});

test('collectLookups: picks the first good answer, waits on Clay, tracks credits and warns at 80%', () => {
  const cands = [person('a'), person('b'), person('c')];
  const r1 = [
    { ...moved('a'), email: 'p.a@acme.example', email_status: 'verified' },
    { contact_id: 'b', provider: 'apollo', found: false, credits_used: 0, note: 'Apollo has no matching person.' },
    { contact_id: 'c', provider: 'apollo', found: false, credits_used: 0, note: 'Lookup failed: 401' },
  ];
  const r2 = [{ contact_id: 'b', provider: 'clay', pending: true, found: false, credits_used: 1 }];
  const usage = [{ usage_key: '2026-10:apollo', credits_used: '1', warned: 'FALSE' }];
  const out = collectLookups(cfg, cands, [], usage, [r1, r2, []], NOW);
  assert.deepStrictEqual(out.pending, ['b']);
  assert.deepStrictEqual(out.briefs.map((x) => x.contact_id), ['a', 'c']);
  const a = out.briefs[0];
  assert.strictEqual(a.lookup_source, 'apollo');
  assert.strictEqual(a.lookup_email, 'p.a@acme.example');
  assert.ok(!JSON.parse(a.lookup_json).email, 'emails stay out of the prompt');
  // usage: apollo 1 + 1 = 2 of 2 (warn), clay 1 of 10 (no warn)
  const ap = out.usage_rows.find((u) => u.provider === 'apollo');
  assert.deepStrictEqual([ap.credits_used, ap.warned], ['2', 'TRUE']);
  assert.strictEqual(out.alerts.length, 1);
  assert.match(out.alerts[0].text_md, /apollo has used 2 of its 2 lookup credits this month \(100%\)\. It is now paused/);
  // cache: the failed call for c is not marked as tried, so it is retried next run
  const cRow = out.cache_rows.find((x) => x.contact_id === 'c');
  assert.deepStrictEqual(JSON.parse(cRow.tried_json), {});
  const bRow = out.cache_rows.find((x) => x.contact_id === 'b');
  assert.strictEqual(bRow.pending, 'TRUE');
  assert.ok(JSON.parse(bRow.tried_json).clay);
  for (const x of [...out.briefs, ...out.alerts]) assert.ok(!JSON.stringify(x).includes('\u2014'), 'no em dashes');
});

test('collectLookups: a fresh cached answer is reused without spending credits', () => {
  const cache = [{ contact_id: 'a', provider: 'apollo', found: 'TRUE', summary_json: JSON.stringify(moved('a')), looked_up_at: '2026-10-20T00:00:00Z', tried_json: '{}' }];
  const out = collectLookups(cfg, [person('a')], cache, [], [[], [], []], NOW);
  assert.strictEqual(out.briefs[0].lookup_source, 'apollo');
  assert.strictEqual(out.usage_rows.length, 0);
  assert.strictEqual(out.cache_rows.length, 0);
});

test('Clay callback is accepted once, only while waiting, and the next run picks it up', () => {
  const waiting = [{ contact_id: 'b', pending: 'TRUE', tried_json: JSON.stringify({ apollo: '2026-10-21T00:00:00Z' }) }];
  const body = { body: { valari_contact_id: 'b', company_name: 'Zeta Labs', company_domain: 'https://www.zeta.example', job_title: 'Product Designer', work_email: 'B@zeta.example' } };
  const row = normalizeCallback(body, waiting, NOW);
  assert.strictEqual(row.contact_id, 'b');
  assert.strictEqual(row.pending, 'READY');
  const s = JSON.parse(row.summary_json);
  assert.deepStrictEqual([s.found, s.provider, s.job_company_website, s.email], [true, 'clay', 'zeta.example', 'b@zeta.example']);
  assert.deepStrictEqual(Object.keys(JSON.parse(row.tried_json)).sort(), ['apollo', 'clay']);
  // replays and unexpected callbacks are ignored
  assert.strictEqual(normalizeCallback(body, [row], NOW), null, 'replay after the answer arrived');
  assert.strictEqual(normalizeCallback(body, [], NOW), null, 'nobody was waiting');
  assert.strictEqual(normalizeCallback({ company_name: 'X' }, waiting, NOW), null, 'no contact id');
  // the next scheduled run adds READY people on top of its own candidates
  const watch = [person('b', { status: 'suspect' }), person('z', { status: 'moved' })];
  const cands = readyCandidates([], watch, [row, { contact_id: 'z', pending: 'READY' }]);
  assert.deepStrictEqual(cands.map((c) => [c.contact_id, c.trigger]), [['b', 'retry']], 'moved people are not picked up again');
  const out = collectLookups(cfg, cands, [row], [], [[], [], []], NOW);
  assert.strictEqual(out.briefs[0].lookup_source, 'clay');
  assert.deepStrictEqual(out.cache_rows.map((r) => [r.contact_id, r.pending]), [['b', 'FALSE']], 'used once, then done');
});

test('Apollo request never asks for phone numbers, and the response maps to the standard shape', () => {
  const body = apolloMatchBody(person('a', { linkedin_url: 'https://linkedin.com/in/example-a' }));
  assert.strictEqual(body.reveal_phone_number, false);
  assert.strictEqual(body.linkedin_url, 'https://linkedin.com/in/example-a');
  const s = summarizeApollo({ person: { name: 'Pat A', title: 'Product Designer', email: 'pat@acme.example', email_status: 'verified', organization: { name: 'Acme', primary_domain: 'acme.example' }, employment_history: [{ organization_name: 'OldCo', title: 'Designer', start_date: '2021-01-01', end_date: '2026-08-01', current: false }, { organization_name: 'Acme', title: 'Product Designer', start_date: '2026-09-01', current: true }] } });
  assert.deepStrictEqual([s.found, s.credits_used, s.job_company_name, s.job_company_website, s.job_start_date, s.experience[0].company], [true, 1, 'Acme', 'acme.example', '2026-09-01', 'Acme']);
  assert.strictEqual(summarizeApollo({ person: null }).found, false);
  assert.strictEqual(summarizeApollo({ person: null }).credits_used, 0);
  assert.match(summarizeApollo({ error: { message: '401 - Invalid API key' } }).note, /Lookup failed/);
});

test('emails found by the lookup skip the email finder', () => {
  const d = (id, email) => ({ outcome: 'confirmed', new_company: 'Acme', new_company_domain: 'acme.example', candidate: { contact_id: id, full_name: 'P Q', lookup_email: email, lookup_email_status: 'verified', lookup_source: 'apollo' } });
  const decisions = [d('a', 'p@acme.example'), d('b', ''), d('c', 'p@other.example')];
  assert.deepStrictEqual(lookupEmailResults(decisions).map((r) => [r.contact_id, r.status]), [['a', 'valid']]);
  assert.deepStrictEqual(emailRequests({}, decisions).map((r) => r.contact_id), ['b', 'c']);
});

test('a re-run after Clay answers keeps the bounce that started it', () => {
  const out = collectLookups(cfg, [person('b')], [], [], [[], [{ contact_id: 'b', provider: 'clay', pending: true, found: false, credits_used: 1 }], []], NOW);
  const saved = JSON.parse(out.cache_rows[0].signal_json);
  assert.deepStrictEqual([saved.trigger, saved.signal_date], ['signal', '2026-10-20']);
  const row = normalizeCallback({ valari_contact_id: 'b' }, out.cache_rows, NOW);
  assert.strictEqual(row.signal_json, out.cache_rows[0].signal_json, 'the callback keeps it');
  const manual = person('b', { trigger: 'manual', signal: 'manual', signal_evidence: 'Requested by a teammate', signal_date: '' });
  const [c] = restoreSignals(cfg, [manual], [row], NOW);
  assert.deepStrictEqual([c.trigger, c.requested], ['signal', true]);
  // old signals and people without one stay manual
  assert.strictEqual(restoreSignals(cfg, [manual], [row], '2027-01-30T00:00:00Z')[0].trigger, 'manual');
  assert.strictEqual(restoreSignals(cfg, [manual], [], NOW)[0].trigger, 'manual');
});
