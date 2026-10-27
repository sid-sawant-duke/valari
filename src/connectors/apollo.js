// Apollo connector logic: builds the People Enrichment request and trims the response
// to the standard lookup shape. Inlined into the Apollo connector and the n8n template.

// Request body for POST /api/v1/people/match. Phone numbers are never requested (they cost extra credits).
function apolloMatchBody(req) {
  const clean = (v) => String(v ?? '').trim();
  const body = { reveal_personal_emails: false, reveal_phone_number: false };
  if (clean(req.linkedin_url)) body.linkedin_url = clean(req.linkedin_url);
  if (clean(req.work_email)) body.email = clean(req.work_email);
  if (clean(req.first_name)) body.first_name = clean(req.first_name);
  if (clean(req.last_name)) body.last_name = clean(req.last_name);
  if (!clean(req.first_name) && clean(req.full_name)) body.name = clean(req.full_name);
  if (clean(req.last_company)) body.organization_name = clean(req.last_company);
  if (clean(req.last_company_domain)) body.domain = clean(req.last_company_domain);
  return body;
}

function summarizeApollo(res) {
  const clean = (v) => String(v ?? '').trim();
  const r = res || {};
  const p = r.person;
  if (r.error || !p || clean(r.match_confidence).toLowerCase() === 'none') {
    const raw = r.error ? (r.error.message || r.error.description || JSON.stringify(r.error)) : 'No match';
    const noMatch = !r.error || /\b404\b|not found|no match/i.test(String(raw));
    return {
      found: false,
      credits_used: 0,
      note: noMatch && !/credential|unauthor|401|403|key/i.test(String(raw))
        ? 'Apollo has no matching person. This is not evidence that they moved.'
        : `Lookup failed: ${String(raw).slice(0, 200)}`,
    };
  }
  const org = p.organization || {};
  const history = Array.isArray(p.employment_history) ? p.employment_history : [];
  const current = history.find((e) => e && e.current) || {};
  const domain = (s) => clean(s).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split('/')[0];
  const experience = history
    .slice()
    .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))
    .slice(0, 6)
    .map((e) => ({
      company: clean(e.organization_name),
      company_website: '',
      title: clean(e.title),
      start_date: clean(e.start_date),
      end_date: e.end_date || null,
      is_primary: Boolean(e.current),
    }));
  return {
    found: true,
    credits_used: 1,
    full_name: clean(p.name),
    linkedin_url: clean(p.linkedin_url),
    location: [p.city, p.state, p.country].map(clean).filter(Boolean).join(', '),
    job_title: clean(p.title) || clean(current.title),
    job_company_name: clean(org.name) || clean(current.organization_name),
    job_company_website: domain(org.primary_domain || org.website_url),
    job_start_date: clean(current.start_date),
    job_last_changed: '',
    job_last_verified: '',
    experience,
    email: clean(p.email),
    email_status: clean(p.email_status),
  };
}

// @node-only-start
module.exports = { apolloMatchBody, summarizeApollo };
// @node-only-end
