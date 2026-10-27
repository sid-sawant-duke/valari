const test = require('node:test');
const assert = require('node:assert');
const { buildWatchlist } = require('../src/core/watchlist');
const { findCandidates } = require('../src/core/find-candidates');
const { scoreAndRoute, matchPersona } = require('../src/core/score-and-route');
const { emailRequests, crmRequests, sequenceRequests } = require('../src/core/actions');
const { finalize } = require('../src/core/finalize');
const { normalizeEvent, matchEngagement } = require('../src/core/engagement');
const { buildDigest } = require('../src/core/build-digest');

const NOW = '2026-10-22T12:00:00Z';
const PERSONAS = JSON.stringify([
  { name: 'Researcher', keywords: ['ux research', 'user research', 'research'], points: 25 },
  { name: 'Designer', keywords: ['ux design', 'product design', 'designer'], points: 20 },
  { name: 'Product', keywords: ['product manager', 'product'], points: 15 },
]);
const cfg = {
  max_lookups_per_run: 40, sweep_day_of_month: 1, recheck_after_days: 30, digest_lookback_days: 14,
  personas: PERSONAS, crm_write_back: 'true', enroll_min_score: 45, crm_name: 'Salesforce',
  team_directory: JSON.stringify({ 'priya@us.example': { name: 'Priya Shah', slack_id: 'U1', salesloft_user_id: '77' }, '005MARCUS': { name: 'Marcus Lee', email: 'marcus@us.example', slack_id: 'U2' } }),
};

const crmRows = [
  { contact_id: '003A', first_name: 'Jordan', last_name: 'Avery', work_email: 'Jordan.Avery@northwind.example', linkedin_url: 'https://linkedin.com/in/example-ja', last_company: 'Northwind', last_company_domain: 'https://www.northwind.example', last_title: 'Senior UX Researcher', role_type: 'champion', owner_ae_email: 'priya@us.example', notes: 'Ran the research repository rollout.' },
  { contact_id: '003B', full_name: 'Sam Okafor', work_email: 'sam@brightcart.example', last_company: 'Brightcart', role_type: 'Buyer', owner_crm_id: '005MARCUS' },
  { contact_id: '003C', full_name: 'Riley Chen', work_email: 'riley@harbor.example', last_company: 'Harbor', do_not_contact: true },
];
const productRows = [
  { work_email: 'sam@brightcart.example', linkedin_url: 'https://linkedin.com/in/example-sam', last_title: 'Product Designer' },
  { work_email: 'ana@lumen.example', full_name: 'Ana Ruiz', last_company: 'Lumen', role_type: 'user' },
];
const stateRows = [{ contact_id: 'product:ana@lumen.example', status: 'verify', next_check_on: '2026-10-01' }];

test('watchlist merges CRM, product users and state, and resolves owners from the team directory', () => {
  const w = buildWatchlist(cfg, crmRows, productRows, stateRows);
  assert.strictEqual(w.length, 4);
  const jordan = w.find((c) => c.contact_id === '003A');
  assert.strictEqual(jordan.full_name, 'Jordan Avery');
  assert.strictEqual(jordan.work_email, 'jordan.avery@northwind.example');
  assert.strictEqual(jordan.last_company_domain, 'northwind.example');
  assert.strictEqual(jordan.owner_ae, 'Priya Shah');
  assert.strictEqual(jordan.owner_ae_slack_id, 'U1');
  assert.strictEqual(jordan.owner_sequence_user_id, '77');
  assert.ok(['1', '2', '3'].includes(jordan.sweep_group));
  const sam = w.find((c) => c.contact_id === '003B');
  assert.strictEqual(sam.role_type, 'buyer');
  assert.strictEqual(sam.linkedin_url, 'https://linkedin.com/in/example-sam', 'product list fills gaps');
  assert.strictEqual(sam.source, 'crm+product');
  assert.strictEqual(sam.owner_ae, 'Marcus Lee');
  const ana = w.find((c) => c.work_email === 'ana@lumen.example');
  assert.strictEqual(ana.contact_id, 'product:ana@lumen.example');
  assert.strictEqual(ana.status, 'verify');
  assert.strictEqual(w.find((c) => c.contact_id === '003C').do_not_contact, 'TRUE');
});

const watch = buildWatchlist(cfg, crmRows, productRows, stateRows);
const bounce = { subject: 'Delivery Status Notification (Failure)', from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', headers: {}, text: "Your message wasn't delivered to jordan.avery@northwind.example", date: '2026-10-20T14:00:00.000Z' };
const autoReply = { subject: 'Automatic reply: hello', from: 'Sam Okafor <sam@brightcart.example>', headers: {}, text: 'Sam is no longer with Brightcart.', date: '2026-10-21T09:00:00.000Z' };
const thirdParty = { subject: 'Automatic reply', from: 'helpdesk@harbor.example', text: 'riley@harbor.example is no longer with us' };

test('candidates: signals, due rechecks, do_not_contact skipped, cap and manual requests', () => {
  const { candidates } = findCandidates(cfg, watch, [bounce, autoReply, thirdParty, {}], NOW);
  const ids = candidates.map((c) => `${c.contact_id}:${c.trigger}:${c.signal}`).sort();
  assert.deepStrictEqual(ids, ['003A:signal:bounce', '003B:signal:left_autoreply', 'product:ana@lumen.example:recheck:recheck']);
  const capped = findCandidates({ ...cfg, max_lookups_per_run: 1 }, watch, [bounce, autoReply], NOW);
  assert.strictEqual(capped.candidates.length, 1);
  assert.strictEqual(capped.skipped.length, 2);
  const manual = findCandidates({ ...cfg, requested_contact_id: 'sam@brightcart.example' }, watch, [], NOW);
  assert.deepStrictEqual(manual.candidates.map((c) => c.contact_id), ['003B']);
  assert.strictEqual(findCandidates({ ...cfg, requested_contact_id: '003C' }, watch, [], NOW).candidates.length, 0);
});

test('sweep picks one third of active people on sweep day', () => {
  const people = Array.from({ length: 30 }, (_, i) => ({ contact_id: `P${i}`, status: 'active', do_not_contact: 'FALSE', sweep_group: String((i % 3) + 1) }));
  const { candidates } = findCandidates(cfg, people, [], '2026-10-01T12:00:00Z'); // October -> group 1
  assert.strictEqual(candidates.length, 10);
  assert.ok(candidates.every((c) => c.sweep_group === '1' && c.trigger === 'sweep'));
});

test('persona matching handles plurals and avoids false hits', () => {
  assert.strictEqual(matchPersona(cfg, 'Lead UX Researcher').name, 'Researcher');
  assert.strictEqual(matchPersona(cfg, 'Senior Product Designer').name, 'Designer');
  assert.strictEqual(matchPersona(cfg, 'Production Supervisor').name, '');
  assert.strictEqual(matchPersona(cfg, 'Group Product Manager').name, 'Product');
  assert.strictEqual(matchPersona({}, 'Head of Research').name, '');
});

const accounts = [
  { domain: 'acme.example', relationship: 'open_deal', crm_account_id: '001ACME', owner_ae: 'Marcus Lee', owner_ae_email: 'marcus@us.example', owner_ae_slack_id: 'U2', owner_crm_id: '005MARCUS' },
];
const candidates = findCandidates(cfg, watch, [bounce, autoReply], NOW).candidates;
const jordanCand = candidates.find((c) => c.contact_id === '003A');
const samCand = candidates.find((c) => c.contact_id === '003B');

test('an individual researcher moving into an open deal scores Hot through persona points', () => {
  const d = scoreAndRoute(cfg, jordanCand, { output: { outcome: 'confirmed', confidence: 'high', new_company: 'Acme', new_company_domain: 'https://www.acme.example/about', new_title: 'Staff UX Researcher', started_new_role: '2026-09', side_role: false, icp_fit: 'strong', evidence: '- PDL: Staff UX Researcher at Acme since 2026-09', draft_opener: 'Congrats on Acme!' } }, accounts, NOW);
  assert.strictEqual(d.outcome, 'confirmed');
  assert.strictEqual(d.persona, 'Researcher');
  assert.strictEqual(d.bucket, 'open_deal');
  assert.strictEqual(d.crm_account_id, '001ACME');
  // champion 25 + persona 25 + manager-level 5 + open deal 20 + ICP 15 + recency 10 = 100
  assert.strictEqual(d.score, 100);
  assert.strictEqual(d.priority, 'Hot');
  assert.strictEqual(d.owner.name, 'Marcus Lee', 'account owner gets it');
  assert.strictEqual(d.cc.name, 'Priya Shah', 'champion AE is cc');
  assert.strictEqual(d.status, 'moved');
  assert.match(d.evidence, /Email bounced on 2026-10-20/);
});

test('custom scoring weights apply (e.g. seniority off)', () => {
  const d = scoreAndRoute({ ...cfg, scoring: JSON.stringify({ seniority: { executive: 0, director: 0, manager: 0 }, thresholds: { hot: 90 } }) }, jordanCand, { outcome: 'confirmed', confidence: 'high', new_company: 'Zeta', new_company_domain: 'zeta.example', new_title: 'VP Research', icp_fit: 'partial' }, accounts, NOW);
  // champion 25 + persona 25 + seniority 0 + net new 15 + partial 8 = 73
  assert.strictEqual(d.score, 73);
  assert.strictEqual(d.priority, 'Warm');
  assert.strictEqual(d.owner.name, 'Priya Shah');
  assert.strictEqual(d.cc, null);
});

test('guard rails: unconfirmed signals become verify, side roles and same company are downgraded, garbage fails safe', () => {
  assert.strictEqual(scoreAndRoute(cfg, jordanCand, { outcome: 'no_change' }, accounts, NOW).outcome, 'verify');
  assert.strictEqual(scoreAndRoute(cfg, { ...jordanCand, trigger: 'sweep' }, { outcome: 'no_change' }, accounts, NOW).outcome, 'no_change');
  assert.strictEqual(scoreAndRoute(cfg, jordanCand, { outcome: 'confirmed', new_company: 'Board Co', new_company_domain: 'board.example', side_role: true }, accounts, NOW).outcome, 'verify');
  assert.strictEqual(scoreAndRoute(cfg, jordanCand, { outcome: 'confirmed', new_company: 'Northwind', new_company_domain: 'northwind.example' }, accounts, NOW).outcome, 'verify');
  assert.strictEqual(scoreAndRoute(cfg, jordanCand, 'not json', accounts, NOW).outcome, 'verify');
  const recheck = scoreAndRoute(cfg, { ...jordanCand, trigger: 'recheck' }, { outcome: 'no_change' }, accounts, NOW);
  assert.strictEqual(recheck.notify, false, 'rechecks stay quiet');
  assert.strictEqual(recheck.next_check_on, '2026-11-21');
});

const moved = scoreAndRoute(cfg, jordanCand, { outcome: 'confirmed', confidence: 'high', new_company: 'Acme', new_company_domain: 'acme.example', new_title: 'Staff UX Researcher', started_new_role: '2026-09', icp_fit: 'strong', evidence: '- PDL: at Acme', draft_opener: 'Congrats on Acme! Loved the research rollout.' }, accounts, NOW);
const cool = scoreAndRoute(cfg, samCand, { outcome: 'confirmed', confidence: 'low', new_company: 'Tiny', new_company_domain: 'tiny.example', new_title: 'Associate', icp_fit: 'weak' }, accounts, NOW);
const verify = scoreAndRoute(cfg, samCand, { outcome: 'no_change' }, accounts, NOW);

test('action requests: email for confirmed moves, CRM write-back, enrollment gated by email and score', () => {
  const er = emailRequests(cfg, [moved, verify]);
  assert.deepStrictEqual(er.map((r) => [r.action, r.contact_id, r.domain, r.first_name, r.last_name]), [['find_email', '003A', 'acme.example', 'Jordan', 'Avery']]);
  assert.deepStrictEqual(emailRequests(cfg, [verify]), [{ action: 'noop' }]);
  const emails = [{ contact_id: '003A', email: 'jordan@acme.example', status: 'valid', confidence: 96 }, { contact_id: '003B', email: 'sam@tiny.example', status: 'valid' }];
  const cr = crmRequests(cfg, [moved, verify], emails);
  assert.strictEqual(cr.length, 1);
  assert.strictEqual(cr[0].crm_account_id, '001ACME');
  assert.strictEqual(cr[0].owner_crm_id, '005MARCUS');
  assert.strictEqual(cr[0].new_email, 'jordan@acme.example');
  assert.match(cr[0].task_body, /Researcher/);
  assert.deepStrictEqual(crmRequests({ ...cfg, crm_write_back: 'false' }, [moved], emails), [{ action: 'noop' }]);
  const sr = sequenceRequests(cfg, [moved, cool, verify], emails);
  assert.deepStrictEqual(sr.map((r) => r.contact_id), ['003A'], 'cool lead below min score is not enrolled');
  assert.strictEqual(sr[0].cadence_key, 'open_deal');
  assert.strictEqual(sequenceRequests(cfg, [moved], [])[0].action, 'noop', 'no email, no enrollment');
});

test('finalize builds rows and alerts that reflect what the connectors did', () => {
  const out = finalize(cfg, [moved, cool, verify],
    [{ contact_id: '003A', email: 'jordan@acme.example', status: 'valid', confidence: 96 }],
    [{ contact_id: '003A', crm_record_id: '003NEW', crm_record_type: 'contact', crm_record_url: 'https://x.my.salesforce.com/003NEW', task_id: '00T1' }],
    [{ contact_id: '003A', enrolled: true, cadence_id: '55', cadence_name: 'Switchers: open deal' }]);
  const [m, c, v] = out;
  assert.strictEqual(m.case_row.outcome, 'confirmed');
  assert.strictEqual(m.case_row.score, '100');
  assert.strictEqual(m.case_row.sequence_status, 'enrolled');
  assert.strictEqual(m.case_row.new_email, 'jordan@acme.example');
  assert.strictEqual(m.state_row.status, 'moved');
  assert.strictEqual(m.state_row.moved_at, '2026-10-22');
  assert.strictEqual(m.alert.kind, 'move');
  assert.match(m.alert.text_md, /<@U2> this one is yours \(cc <@U1>, who worked with them at Northwind\)/);
  assert.match(m.alert.text_md, /\*New email:\* jordan@acme.example \(valid, 96%\)/);
  assert.match(m.alert.text_md, /\*Salesforce:\* Created contact and a task/);
  assert.match(m.alert.text_md, /Added to cadence Switchers: open deal/);
  assert.match(m.alert.html, /<blockquote>Congrats on Acme!/);
  assert.ok(!/<b>|<p>/.test(m.alert.text_plain));
  assert.strictEqual(m.alert.to_email, 'marcus@us.example');
  assert.match(c.case_row.sequence_status, /skipped/);
  assert.strictEqual(v.alert.kind, 'verify');
  assert.match(v.alert.text_md, /\[VERIFY\] Sam Okafor/);
  assert.strictEqual(v.state_row.status, 'verify');
  for (const r of out) assert.ok(!JSON.stringify(r).includes('\u2014'), 'no em dashes');
});

test('engagement: person-level opens and account-level visits trigger "call now", with window and cooldown', () => {
  const state = [
    { contact_id: '003A', full_name: 'Jordan Avery', status: 'moved', moved_at: '2026-10-10', new_email: 'jordan@acme.example', new_company_domain: 'acme.example', current_company: 'Acme', current_title: 'Staff UX Researcher', owner_ae: 'Marcus Lee', owner_ae_slack_id: 'U2', owner_ae_email: 'marcus@us.example' },
    { contact_id: 'OLD', full_name: 'Old Move', status: 'moved', moved_at: '2025-01-01', new_company_domain: 'old.example' },
    { contact_id: 'COOL', full_name: 'Cooldown', status: 'moved', moved_at: '2026-10-20', new_company_domain: 'cool.example', last_engagement_alert_at: '2026-10-22T06:00:00Z' },
  ];
  const open = normalizeEvent({ body: { event_type: 'email_opened', person: { email_address: 'Jordan@Acme.example' }, subject: 'Congrats on the new role' } });
  assert.strictEqual(open.type, 'email_open');
  const r1 = matchEngagement(cfg, open, state, NOW);
  assert.strictEqual(r1.length, 1);
  assert.strictEqual(r1[0].match, 'person');
  assert.match(r1[0].alert.text_md, /Call now: Jordan Avery just opened your email/);
  assert.match(r1[0].alert.text_md, /<@U2>/);
  const visit = normalizeEvent({ company: { name: 'Acme', domain: 'www.acme.example' }, page_url: '/pricing' });
  assert.strictEqual(normalizeEvent({ event: 'page_view', domain: 'acme.example' }).type, 'web_visit');
  assert.strictEqual(normalizeEvent({ event: 'email_viewed', email: 'a@b.example' }).type, 'email_open');
  assert.strictEqual(normalizeEvent({ type: 'link_clicked', email: 'a@b.example' }).type, 'email_click');
  assert.strictEqual(normalizeEvent({ event: 'reply_received', email: 'a@b.example' }).type, 'reply');
  assert.strictEqual(visit.type, 'web_visit');
  const r2 = matchEngagement(cfg, visit, state, NOW);
  assert.strictEqual(r2[0].match, 'account');
  assert.match(r2[0].alert.text_md, /Someone from Acme \(where Jordan Avery works now\) just visited your website/);
  assert.strictEqual(matchEngagement(cfg, normalizeEvent({ domain: 'old.example' }), state, NOW).length, 0, 'outside window');
  assert.strictEqual(matchEngagement(cfg, normalizeEvent({ domain: 'cool.example' }), state, NOW).length, 0, 'cooldown');
  assert.strictEqual(matchEngagement(cfg, normalizeEvent({ event: 'email_open', domain: 'acme.example' }), state, NOW).length, 0, 'domain-only email events ignored');
  assert.strictEqual(r1[0].state_update.last_engagement_alert_at, '2026-10-22T12:00:00.000Z');
});

test('digest keeps the latest case per person, sorts by score and shows the funnel', () => {
  const cases = [
    { case_id: '1', contact_id: 'A', full_name: 'Jordan', created_at: '2026-10-20T10:00:00Z', outcome: 'verify' },
    { case_id: '2', contact_id: 'A', full_name: 'Jordan', created_at: '2026-10-21T10:00:00Z', outcome: 'confirmed', score: '60', priority: 'Warm', sequence_status: 'enrolled', ae_feedback: 'meeting_booked' },
    { case_id: '3', contact_id: 'B', full_name: 'Sam <script>', created_at: '2026-10-21T10:00:00Z', outcome: 'confirmed', score: '90', priority: 'Hot' },
    { case_id: '4', contact_id: 'C', full_name: 'Ana', created_at: '2026-10-15T10:00:00Z', outcome: 'verify' },
    { case_id: '5', contact_id: 'D', full_name: 'Old', created_at: '2026-09-01T10:00:00Z', outcome: 'confirmed', score: '99' },
    {},
  ];
  const d = buildDigest(cfg, cases, NOW);
  assert.strictEqual(d.action, 'digest');
  assert.strictEqual(d.confirmed, 2);
  assert.strictEqual(d.verify, 1);
  assert.strictEqual(d.enrolled, 1);
  assert.strictEqual(d.meetings, 1);
  assert.ok(d.html.indexOf('Sam') < d.html.indexOf('Jordan'));
  assert.ok(!d.html.includes('<script>'));
  assert.match(d.text_md, /\*Confirmed moves \(2\)\*/);
});

test('owners: account owners and unowned people are filled from the team directory', () => {
  const dirCfg = { ...cfg, team_directory: JSON.stringify({ '005marcus': { name: 'Marcus Lee', email: 'marcus@us.example', slack_id: 'U2', salesloft_user_id: '42' }, default: { name: 'SDR Queue', slack_id: 'S0' } }) };
  const w = buildWatchlist(dirCfg, [], [{ work_email: 'lee@oldco.example', full_name: 'Lee Park' }], []);
  assert.strictEqual(w[0].owner_ae, 'SDR Queue');
  assert.strictEqual(w[0].owner_ae_slack_id, 'S0');
  const cand = { ...w[0], trigger: 'signal', signal: 'bounce', signal_evidence: '' };
  const d = scoreAndRoute(dirCfg, cand, { outcome: 'confirmed', confidence: 'high', new_company: 'Acme', new_company_domain: 'acme.example', new_title: 'Designer' }, [{ domain: 'acme.example', relationship: 'customer', owner_crm_id: '005MARCUS' }], NOW);
  assert.strictEqual(d.owner.name, 'Marcus Lee');
  assert.strictEqual(d.owner.slack_id, 'U2');
  assert.strictEqual(d.owner.sequence_user_id, '42');
  assert.strictEqual(d.cc.name, 'SDR Queue');
});

test('finalize only mentions steps that are switched on', () => {
  const [m] = finalize({ ...cfg, crm_write_back: 'false' }, [moved], [], [], []);
  assert.ok(!/New email|Sequence|Salesforce/.test(m.alert.text_md), m.alert.text_md);
  const [m2] = finalize({ ...cfg, crm_write_back: 'false', find_new_emails: 'true' }, [moved], [], [], []);
  assert.match(m2.alert.text_md, /\*New email:\* Not found/);
});
