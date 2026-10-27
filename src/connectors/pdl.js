// Trims a People Data Labs person/enrich response down to the fields the Investigator needs.
// Keeps the agent prompt small (cheaper, faster) and makes "not found" explicit.
// Pure function: tested in test/, inlined into the People Data Labs connector.

function summarizeLookup(response) {
  const r = response || {};
  if (r.error || (r.status && Number(r.status) !== 200) || !r.data) {
    const raw = r.error ? (r.error.message || r.error.description || JSON.stringify(r.error)) : 'No data returned';
    // Only a real "no match" counts as not found. Auth or credential errors must surface as failures.
    const notFound = /\b404\b|no records|not_found/i.test(String(raw)) || Number(r.status) === 404;
    return {
      found: false,
      note: notFound
        ? 'People Data Labs has no matching profile. This is not evidence that the person moved.'
        : `Lookup failed: ${String(raw).slice(0, 200)}`,
    };
  }
  const d = r.data;
  const name = (v) => (v && typeof v === 'object' ? v.name : v) || '';
  const experience = (Array.isArray(d.experience) ? d.experience : [])
    .slice()
    .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))
    .slice(0, 6)
    .map((e) => ({
      company: name(e.company),
      company_website: (e.company && e.company.website) || '',
      title: name(e.title),
      start_date: e.start_date || '',
      end_date: e.end_date || null,
      is_primary: Boolean(e.is_primary),
    }));
  return {
    found: true,
    likelihood: r.likelihood ?? null,
    full_name: d.full_name || '',
    linkedin_url: d.linkedin_url || '',
    location: d.location_name || '',
    job_title: d.job_title || '',
    job_company_name: d.job_company_name || '',
    job_company_website: d.job_company_website || '',
    job_start_date: d.job_start_date || '',
    job_last_changed: d.job_last_changed || '',
    job_last_verified: d.job_last_verified || '',
    experience,
  };
}

// @node-only-start
module.exports = { summarizeLookup };
// @node-only-end
