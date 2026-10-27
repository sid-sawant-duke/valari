// Lookup callback: turns a result sent back later by an async lookup tool (Clay) into a cache row.
// The next Daily Run picks up every READY row and finishes those investigations without spending another credit.
// Pure function: tested in test/, inlined into the Lookup Callback workflow.

// @node-only-start
const { clean, lower, parseJson, normDomain } = require('./shared');
// @node-only-end

function normalizeCallback(body, existingRows, nowInput) {
  const now = nowInput ? new Date(nowInput) : new Date();
  const b = body && typeof body === 'object' ? (body.body && typeof body.body === 'object' ? body.body : body) : {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, part) => (o && typeof o === 'object' ? o[part] : undefined), b);
      if (v !== undefined && v !== null && typeof v !== 'object' && clean(v) !== '') return clean(v);
    }
    return '';
  };
  const contactId = pick('valari_contact_id', 'contact_id', 'contactId');
  if (!contactId) return null;
  const provider = lower(pick('provider', 'source')) || 'clay';
  const company = pick('company_name', 'job_company_name', 'company', 'organization_name', 'current_company');
  const title = pick('job_title', 'title', 'current_title');
  const summary = {
    found: !!(company || title),
    provider,
    full_name: pick('full_name', 'name'),
    linkedin_url: pick('linkedin_url', 'linkedin'),
    location: pick('location'),
    job_title: title,
    job_company_name: company,
    job_company_website: normDomain(pick('company_domain', 'job_company_website', 'domain', 'company_website', 'website')),
    job_start_date: pick('job_start_date', 'start_date', 'started_at'),
    job_last_changed: '',
    job_last_verified: pick('job_last_verified', 'verified_at'),
    experience: [],
    email: lower(pick('work_email', 'email', 'new_email')),
    email_status: lower(pick('email_status')),
  };
  if (!summary.found) summary.note = `${provider} found no current job for this person. This is not evidence that they moved.`;
  const existing = (existingRows || []).find((r) => clean(r.contact_id) === contactId) || {};
  // Only accept an answer Valari is waiting for, and only once: a replayed or unexpected callback is ignored,
  // so it can't overwrite a result, trigger duplicate alerts or point an enrollment at another address.
  if (lower(existing.pending) !== 'true') return null;
  const tried = parseJson(existing.tried_json, {}) || {};
  tried[provider] = now.toISOString();
  return {
    contact_id: contactId,
    provider,
    found: summary.found ? 'TRUE' : 'FALSE',
    // READY: the answer is in; the next Daily Run investigates everyone READY in one batch.
    pending: 'READY',
    summary_json: JSON.stringify(summary),
    looked_up_at: now.toISOString(),
    tried_json: JSON.stringify(tried),
    signal_json: clean(existing.signal_json),
  };
}

// @node-only-start
module.exports = { normalizeCallback };
// @node-only-end
