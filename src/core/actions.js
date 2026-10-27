// Builds the requests the core sends to optional connectors after a move is confirmed:
// find the new work email, write the move to the CRM, and enroll in a sequence.
// Pure functions: tested in test/, inlined into the matching Code nodes.

// @node-only-start
const { clean, lower, truthy, splitName } = require('./shared');
// @node-only-end

const NOOP = [{ action: 'noop' }];

function byContact(rows) {
  const m = new Map();
  for (const r of rows || []) if (r && clean(r.contact_id)) m.set(clean(r.contact_id), r);
  return m;
}

function personName(d) {
  const c = d.candidate;
  const split = splitName(c.full_name);
  return { first_name: clean(c.first_name) || split.first_name, last_name: clean(c.last_name) || split.last_name, full_name: clean(c.full_name) };
}

// Emails the lookup already found at the new company (Apollo returns these), so the email finder can skip them.
function lookupEmailResults(decisions) {
  return (decisions || [])
    .filter((d) => d.outcome === 'confirmed' && clean(d.candidate.lookup_email) && d.new_company_domain && clean(d.candidate.lookup_email).toLowerCase().endsWith(`@${d.new_company_domain}`))
    .map((d) => ({
      contact_id: d.candidate.contact_id,
      email: clean(d.candidate.lookup_email),
      status: lower(d.candidate.lookup_email_status) === 'verified' ? 'valid' : 'unknown',
      confidence: '',
      source: clean(d.candidate.lookup_source) || 'lookup',
    }));
}

function emailRequests(cfg, decisions) {
  const known = new Set(lookupEmailResults(decisions).map((r) => r.contact_id));
  const reqs = decisions
    .filter((d) => d.outcome === 'confirmed' && d.new_company_domain && !known.has(d.candidate.contact_id))
    .map((d) => ({ action: 'find_email', contact_id: d.candidate.contact_id, ...personName(d), domain: d.new_company_domain, company: d.new_company }));
  return reqs.length ? reqs : NOOP;
}

function crmRequests(cfg, decisions, emailResults) {
  if (!truthy(cfg.crm_write_back)) return NOOP;
  const emails = byContact(emailResults);
  const reqs = decisions
    .filter((d) => d.outcome === 'confirmed')
    .map((d) => {
      const c = d.candidate;
      const e = emails.get(c.contact_id) || {};
      const lines = [
        `Former ${c.role_type} at ${c.last_company || 'a previous company'} who used our product. Now ${d.new_title || 'at'} ${d.new_company}.`,
        d.priority ? `Priority: ${d.priority} (${d.score}/100)${d.persona ? `, persona: ${d.persona}` : ''}.` : '',
        d.evidence ? `Evidence:\n${d.evidence}` : '',
        c.notes ? `History with us: ${c.notes}` : '',
        d.draft_opener ? `Draft opener:\n${d.draft_opener}` : '',
      ].filter(Boolean);
      return {
        action: 'record_move',
        contact_id: c.contact_id,
        ...personName(d),
        new_email: clean(e.email),
        new_title: d.new_title,
        new_company: d.new_company,
        new_company_domain: d.new_company_domain,
        crm_account_id: d.crm_account_id,
        owner_crm_id: clean(d.owner.crm_id),
        old_company: c.last_company,
        old_crm_contact_id: c.source === 'product' ? '' : c.contact_id,
        task_subject: `Champion moved: ${c.full_name} is now at ${d.new_company}`,
        task_body: lines.join('\n\n'),
      };
    });
  return reqs.length ? reqs : NOOP;
}

function sequenceRequests(cfg, decisions, emailResults) {
  const minScore = Number(cfg.enroll_min_score ?? 45);
  const emails = byContact(emailResults);
  const reqs = [];
  for (const d of decisions) {
    if (d.outcome !== 'confirmed') continue;
    const e = emails.get(d.candidate.contact_id) || {};
    if (!clean(e.email) || lower(e.status) === 'invalid') continue;
    if ((Number(d.score) || 0) < minScore) continue;
    reqs.push({
      action: 'enroll',
      contact_id: d.candidate.contact_id,
      ...personName(d),
      email: clean(e.email),
      title: d.new_title,
      company: d.new_company,
      company_domain: d.new_company_domain,
      cadence_key: d.bucket,
      persona: d.persona,
      priority: d.priority,
      owner_email: clean(d.owner.email),
      owner_sequence_user_id: clean(d.owner.sequence_user_id),
      note: [d.draft_opener ? `Draft opener:\n${d.draft_opener}` : '', d.evidence ? `Why:\n${d.evidence}` : ''].filter(Boolean).join('\n\n'),
    });
  }
  return reqs.length ? reqs : NOOP;
}

// @node-only-start
module.exports = { emailRequests, crmRequests, sequenceRequests, lookupEmailResults, byContact, NOOP };
// @node-only-end
