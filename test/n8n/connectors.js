// Runs the Salesforce, Google Sheets and Gmail connectors inside n8n with pinned vendor responses.
const fs = require('fs');
const assert = require('assert');
const { login, createWorkflow, runWorkflow, out } = require('./api');
const load = (f) => JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', '..', 'workflows', 'connectors', f), 'utf8'));
const J = (rows) => rows.map((json) => ({ json }));

async function run(file, label, pins, lastNode) {
  const wf = load(file);
  const w = await createWorkflow({ ...wf, name: `${wf.name} (${label})` }, pins);
  const r = await runWorkflow(w, 'When Called by Core', pins);
  const res = out(r.runData, lastNode);
  console.log(`\n${file} / ${label}: ${r.status}${r.error ? ' ' + r.error.message : ''}`);
  for (const [n, runs] of Object.entries(r.runData)) if (runs[0].error) console.log(`  ERROR in ${n}: ${runs[0].error.message}`);
  res.forEach((j) => console.log('  ' + JSON.stringify(j).slice(0, 300)));
  assert.strictEqual(r.status, 'success', `${file} ${label}`);
  return res;
}

(async () => {
  await login();
  // ---------------- Salesforce
  const champs = await run('crm-salesforce.json', 'list_champions', {
    'When Called by Core': J([{ action: 'list_champions' }]),
    'Query Champions': J([
      { attributes: { type: 'CampaignMember' }, ContactId: '003A', Status: 'Champion', Contact: { FirstName: 'Jordan', LastName: 'Avery', Email: 'jordan@northwind.example', Title: 'Data Analyst', Description: 'Rolled out to 3 teams', HasOptedOutOfEmail: false, Account: { Name: 'Northwind', Website: 'www.northwind.example' }, OwnerId: '005P', Owner: { Name: 'Priya Shah', Email: 'priya@us.example' } } },
      { attributes: { type: 'CampaignMember' }, ContactId: '003B', Status: 'Responded', Contact: { FirstName: 'Sam', LastName: 'Okafor', Email: 'sam@brightcart.example', HasOptedOutOfEmail: true, Account: null, OwnerId: '005P', Owner: { Name: 'Priya Shah', Email: 'priya@us.example' } } },
    ]),
  }, 'Map Champions');
  assert.deepStrictEqual([champs[0].contact_id, champs[0].role_type, champs[0].last_company_domain, champs[0].owner_ae_email, champs[0].do_not_contact], ['003A', 'champion', 'www.northwind.example', 'priya@us.example', 'FALSE']);
  assert.deepStrictEqual([champs[1].role_type, champs[1].do_not_contact, champs[1].last_company], ['responded', 'TRUE', '']);

  const accts = await run('crm-salesforce.json', 'list_accounts', {
    'When Called by Core': J([{ action: 'list_accounts' }]),
    'Query Customer Accounts': J([{ Id: '001A', Name: 'Acme', Website: 'https://acme.example', OwnerId: '005M', Owner: { Name: 'Marcus Lee', Email: 'marcus@us.example' } }]),
    'Query Opportunities': J([{ AccountId: '001Z', Account: { Name: 'Zeta', Website: 'zeta.example' }, OwnerId: '005P', Owner: { Name: 'Priya Shah' }, IsClosed: false, IsWon: false }]),
  }, 'Merge Accounts');
  assert.deepStrictEqual(accts.map((a) => `${a.domain}:${a.relationship}`).sort(), ['acme.example:customer', 'zeta.example:open_deal']);

  const moves = await run('crm-salesforce.json', 'record_move', {
    'When Called by Core': J([
      { action: 'record_move', contact_id: '003A', first_name: 'Jordan', last_name: 'Avery', new_email: 'jordan@acme.example', new_title: 'Staff Analyst', new_company: 'Acme', new_company_domain: 'acme.example', crm_account_id: '001A', owner_crm_id: '005M', task_subject: 'Champion moved: Jordan Avery is now at Acme', task_body: 'Former champion...' },
      { action: 'record_move', contact_id: 'product:lee@oldco.example', first_name: 'Lee', last_name: 'Park', new_email: '', new_title: 'Operations Manager', new_company: 'Zeta Labs', new_company_domain: 'zeta.example', crm_account_id: '', owner_crm_id: '', task_subject: 'Champion moved: Lee Park is now at Zeta Labs', task_body: 'Former user...' },
    ]),
    'Create Contact': J([{ id: '003NEW', success: true, errors: [] }]),
    'Create Lead': J([{ id: '00QNEW', success: true, errors: [] }]),
    'Create Task': J([{ id: '00T1', success: true }, { id: '00T2', success: true }]),
  }, 'Move Result');
  const mv = Object.fromEntries(moves.map((m) => [m.contact_id, m]));
  assert.deepStrictEqual([mv['003A'].crm_record_id, mv['003A'].crm_record_type], ['003NEW', 'contact']);
  assert.deepStrictEqual([mv['product:lee@oldco.example'].crm_record_id, mv['product:lee@oldco.example'].crm_record_type], ['00QNEW', 'lead']);

  // ---------------- Google Sheets
  const sc = await run('crm-google-sheets.json', 'list_champions', {
    'When Called by Core': J([{ action: 'list_champions' }]),
    'Read Champions': J([{ row_number: 2, contact_id: 'S-1', full_name: 'Jordan Avery', work_email: 'jordan@northwind.example', role_type: 'buyer', owner_ae: 'Priya', do_not_contact: 'FALSE', extra_column: 'ignored' }]),
  }, 'Map Champions');
  assert.strictEqual(sc[0].full_name, 'Jordan Avery');
  assert.ok(!('extra_column' in sc[0]) && !('row_number' in sc[0]));
  const sm = await run('crm-google-sheets.json', 'record_move', {
    'When Called by Core': J([{ action: 'record_move', contact_id: 'S-1', full_name: 'Jordan Avery', new_company: 'Acme', task_body: 'Moved' }]),
    'Append Move': J([{ recorded_at: 'x', contact_id: 'S-1' }]),
  }, 'Move Result');
  assert.deepStrictEqual([sm[0].contact_id, sm[0].crm_record_type], ['S-1', 'sheet row']);

  // ---------------- Gmail signals and alerts
  const sig = await run('signals-gmail.json', 'get_signals', {
    'When Called by Core': J([{ action: 'get_signals' }]),
    'Search Inbox': J([{ id: 'm1', threadId: 't', subject: 'Delivery Status Notification (Failure)', from: { value: [{ address: 'mailer-daemon@googlemail.com', name: 'Mail Delivery Subsystem' }], text: '"Mail Delivery Subsystem" <mailer-daemon@googlemail.com>' }, text: 'Address not found', date: '2026-10-20T14:00:00.000Z', headers: { 'x-failed-recipients': 'X-Failed-Recipients: a@b.example' } }, {}]),
  }, 'Normalize');
  assert.strictEqual(sig.length, 1);
  await run('alert-gmail.json', 'alert', {
    'When Called by Core': J([{ action: 'alert', subject: 'x', html: '<p>x</p>', to_email: 'marcus@us.example', cc_email: '' }]),
    'Email Owner': J([{ id: 'sent1', labelIds: ['SENT'] }]),
  }, 'Email Owner');
  await run('alert-gmail.json', 'digest', {
    'When Called by Core': J([{ action: 'digest', subject: 'Digest', html: '<p>d</p>' }]),
    'Email Digest': J([{ id: 'sent2' }]),
  }, 'Email Digest');
  console.log('\nALL CONNECTOR CHECKS PASSED');
})().catch((e) => { console.error('CONNECTOR TEST FAILED:', e.message); process.exit(1); });
