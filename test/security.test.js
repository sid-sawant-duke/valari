// Guard rails against untrusted input: each test plays the attacker.
const test = require('node:test');
const assert = require('node:assert');
const { mdEsc, safeUrl } = require('../src/core/shared');
const { findCandidates, optOutRows } = require('../src/core/find-candidates');
const { scoreAndRoute } = require('../src/core/score-and-route');
const { finalize } = require('../src/core/finalize');
const { buildDigest } = require('../src/core/build-digest');
const { matchEngagement } = require('../src/core/engagement');

const NOW = '2026-10-22T12:00:00Z';
const cand = {
  contact_id: 'c1', full_name: 'Pat Doe', work_email: 'pat@old.example', last_company: 'OldCo', last_company_domain: 'old.example',
  role_type: 'champion', trigger: 'signal', signal: 'bounce', signal_evidence: 'Email bounced', signal_date: '2026-10-20',
  owner_ae: 'Rep', owner_ae_slack_id: 'U1',
  lookup_json: JSON.stringify({ found: true, job_company_name: 'Acme', job_company_website: 'acme.example', experience: [{ company: 'OldCo' }] }),
};
const confirmed = (extra = {}) => ({ outcome: 'confirmed', confidence: 'high', new_company: 'Acme', new_company_domain: 'acme.example', new_title: 'Analyst', icp_fit: 'strong', evidence: '- Apollo: at Acme', ...extra });

test('Slack escaping and link checks', () => {
  assert.strictEqual(mdEsc('<!channel> & <https://evil.example|click>'), '&lt;!channel&gt; &amp; &lt;https://evil.example|click&gt;');
  assert.strictEqual(safeUrl('https://www.linkedin.com/in/pat'), 'https://www.linkedin.com/in/pat');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'https://a|x> <!channel>', 'https://a"onmouseover=x', 'ftp://x.example']) assert.strictEqual(safeUrl(bad), '', bad);
});

test('injected names, titles and links cannot ping the channel or add links', () => {
  const d = scoreAndRoute({}, { ...cand, full_name: 'Pat <!channel>', linkedin_url: 'https://a|x> <!channel> <https://evil.example|Open LinkedIn' }, confirmed({ new_title: '<!here> CEO', draft_opener: 'Hi! See https://evil.example/login now' }), [], NOW);
  assert.ok(!/https?:\/\/evil/.test(d.draft_opener), 'links removed from the draft');
  const [r] = finalize({}, [d], [], [], []);
  const md = r.alert.text_md;
  assert.ok(!md.includes('<!channel>') && !md.includes('<!here>'), md);
  assert.ok(!md.includes('evil.example'), 'bad LinkedIn URL dropped');
  const dg = buildDigest({}, [{ outcome: 'verify', checked_at: '2026-10-21', full_name: '<!channel>', old_company: 'X', linkedin_url: 'javascript:alert(1)' }], NOW);
  assert.ok(!dg.text_md.includes('<!channel>') && !dg.html.includes('javascript:'));
});

test('the AI cannot confirm a company the lookup never returned', () => {
  const ok = scoreAndRoute({}, cand, confirmed(), [], NOW);
  assert.strictEqual(ok.outcome, 'confirmed');
  const forged = scoreAndRoute({}, cand, confirmed({ new_company: 'Evil Inc', new_company_domain: 'evil.example' }), [], NOW);
  assert.strictEqual(forged.outcome, 'verify');
  assert.match(forged.evidence, /no lookup result shows that company/);
  assert.strictEqual(scoreAndRoute({ require_lookup_match: false }, cand, confirmed({ new_company: 'Evil Inc', new_company_domain: 'evil.example' }), [], NOW).outcome, 'confirmed', 'switch for web search users');
  assert.ok(scoreAndRoute({}, cand, confirmed({ evidence: 'x'.repeat(5000) }), [], NOW).evidence.length <= 1500);
});

test('a forged "Undeliverable" email from anyone is not a bounce', () => {
  const champs = [{ contact_id: 'c1', work_email: 'pat@old.example', status: 'active' }];
  const forged = { subject: 'Undeliverable: hello', from: 'Random <someone@evil.example>', text: 'pat@old.example', date: '2026-10-20' };
  assert.strictEqual(findCandidates({}, champs, [forged], NOW).candidates.length, 0);
  const real = { ...forged, from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' };
  assert.strictEqual(findCandidates({}, champs, [real], NOW).candidates[0].signal, 'bounce');
});

test('do_not_contact stops "call now" alerts for people who already moved', () => {
  const rows = optOutRows([
    { contact_id: 'a', status: 'moved', do_not_contact: 'TRUE' },
    { contact_id: 'b', status: 'moved', do_not_contact: 'FALSE' },
    { contact_id: 'c', status: 'active', do_not_contact: 'TRUE' },
  ]);
  assert.deepStrictEqual(rows.map((r) => [r.contact_id, r.status]), [['a', 'opted_out']]);
  const state = [{ contact_id: 'a', status: 'opted_out', new_email: 'pat@acme.example', moved_at: '2026-10-20' }];
  assert.strictEqual(matchEngagement({}, { type: 'email_open', email: 'pat@acme.example' }, state, NOW).length, 0);
});
