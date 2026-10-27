// Merges the CRM watchlist, an optional product-user list and saved tracker state into one list of champions.
// Pure function: tested in test/, inlined into the "Build Watchlist" Code node.

// @node-only-start
const { clean, lower, truthy, normDomain, splitName, sweepGroupFor, loadDirectory, resolveOwner } = require('./shared');
// @node-only-end

function buildWatchlist(cfg, crmRows, productRows, stateRows) {
  const dir = loadDirectory(cfg);

  const state = new Map();
  for (const s of stateRows || []) if (clean(s.contact_id)) state.set(clean(s.contact_id), s);

  const normalize = (r, source) => {
    const email = lower(r.work_email);
    const id = clean(r.contact_id) || (email ? `${source}:${email}` : '');
    if (!id) return null;
    const names = splitName(r.full_name);
    const owner = resolveOwner(dir, { name: r.owner_ae, email: r.owner_ae_email, slack_id: r.owner_ae_slack_id, crm_id: r.owner_crm_id, sequence_user_id: r.owner_sequence_user_id });
    const full = clean(r.full_name) || [clean(r.first_name), clean(r.last_name)].filter(Boolean).join(' ');
    return {
      contact_id: id,
      full_name: full,
      first_name: clean(r.first_name) || names.first_name,
      last_name: clean(r.last_name) || names.last_name,
      work_email: email,
      linkedin_url: clean(r.linkedin_url),
      last_company: clean(r.last_company),
      last_company_domain: normDomain(r.last_company_domain) || (email.includes('@') ? normDomain(email) : ''),
      last_title: clean(r.last_title),
      role_type: ['buyer', 'champion', 'user'].includes(lower(r.role_type)) ? lower(r.role_type) : 'user',
      owner_ae: owner.name,
      owner_ae_email: owner.email,
      owner_ae_slack_id: owner.slack_id,
      owner_crm_id: owner.crm_id,
      owner_sequence_user_id: owner.sequence_user_id,
      do_not_contact: truthy(r.do_not_contact) ? 'TRUE' : 'FALSE',
      notes: clean(r.notes),
      sweep_group: ['1', '2', '3'].includes(clean(r.sweep_group)) ? clean(r.sweep_group) : sweepGroupFor(id),
      source,
    };
  };

  const byId = new Map();
  const byEmail = new Map();
  for (const r of crmRows || []) {
    if (!r || typeof r !== 'object') continue;
    const c = normalize(r, 'crm');
    if (!c || byId.has(c.contact_id)) continue;
    byId.set(c.contact_id, c);
    if (c.work_email) byEmail.set(c.work_email, c);
  }
  // Product users fill gaps on matching CRM contacts, or are added as new champions.
  for (const r of productRows || []) {
    if (!r || typeof r !== 'object') continue;
    const p = normalize(r, 'product');
    if (!p) continue;
    const existing = p.work_email && byEmail.get(p.work_email);
    if (existing) {
      for (const [k, v] of Object.entries(p)) if (!existing[k] && v) existing[k] = v;
      if (existing.source === 'crm') existing.source = 'crm+product';
      continue;
    }
    if (byId.has(p.contact_id)) continue;
    byId.set(p.contact_id, p);
    if (p.work_email) byEmail.set(p.work_email, p);
  }

  return [...byId.values()].map((c) => {
    const s = state.get(c.contact_id) || {};
    return {
      ...c,
      status: lower(s.status) || 'active',
      last_checked: clean(s.last_checked),
      next_check_on: clean(s.next_check_on),
    };
  });
}

// @node-only-start
module.exports = { buildWatchlist };
// @node-only-end
