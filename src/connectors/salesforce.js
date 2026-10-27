// Salesforce connector logic. Inlined into the Salesforce connector's Code nodes.

// Combines customer accounts and open / recently lost opportunities into the standard account list.
// A domain gets the strongest relationship it has: customer > open_deal > lost_deal.
function mergeSalesforceAccounts(accountRows, oppRows) {
  const clean = (v) => String(v ?? '').trim();
  const domainOf = (site) => {
    let d = clean(site).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split('/')[0];
    return d.includes('.') ? d : '';
  };
  const rank = { customer: 3, open_deal: 2, lost_deal: 1 };
  const out = new Map();
  const put = (row) => {
    if (!row.domain) return;
    const prev = out.get(row.domain);
    if (!prev || rank[row.relationship] > rank[prev.relationship]) out.set(row.domain, row);
  };
  for (const a of accountRows || []) {
    if (!a || !a.Id) continue;
    put({
      domain: domainOf(a.Website),
      company_name: clean(a.Name),
      relationship: 'customer',
      crm_account_id: clean(a.Id),
      owner_crm_id: clean(a.OwnerId),
      owner_ae: clean(a.Owner && a.Owner.Name),
      owner_ae_email: clean(a.Owner && a.Owner.Email).toLowerCase(),
    });
  }
  for (const o of oppRows || []) {
    if (!o || !o.Account) continue;
    put({
      domain: domainOf(o.Account.Website),
      company_name: clean(o.Account.Name),
      relationship: o.IsClosed === false || String(o.IsClosed) === 'false' ? 'open_deal' : 'lost_deal',
      crm_account_id: clean(o.AccountId),
      owner_crm_id: clean(o.OwnerId),
      owner_ae: clean(o.Owner && o.Owner.Name),
      owner_ae_email: clean(o.Owner && o.Owner.Email).toLowerCase(),
    });
  }
  return [...out.values()];
}

// @node-only-start
module.exports = { mergeSalesforceAccounts };
// @node-only-end
