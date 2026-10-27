// Lookup waterfall: try up to three lookup tools in order, stop as soon as one gives a good answer,
// and never spend more than each tool's monthly budget.
// Pure functions: tested in test/, inlined into the core's lookup Code nodes.

// @node-only-start
const { clean, lower, parseJson, normDomain } = require('./shared');
// @node-only-end

// Slot i (1, 2 or 3) as configured in Config: lookup_<i>_name, lookup_<i>_connector_id, lookup_<i>_monthly_budget.
// A blank budget means no limit. 0 switches the tool off.
function lookupSlot(cfg, i) {
  const id = clean(cfg[`lookup_${i}_connector_id`]);
  if (!id) return null;
  const b = clean(cfg[`lookup_${i}_monthly_budget`]);
  return { index: i, name: lower(cfg[`lookup_${i}_name`]) || `lookup_${i}`, connector_id: id, budget: b === '' ? null : Number(b) };
}

const monthKey = (now) => now.toISOString().slice(0, 7);
const daysAgo = (iso, now) => {
  const d = new Date(clean(iso));
  return isNaN(d.getTime()) ? Infinity : (now - d) / 86400000;
};

function usageFor(usageRows, provider, now) {
  const key = `${monthKey(now)}:${provider}`;
  const row = (usageRows || []).find((u) => clean(u.usage_key) === key);
  return { key, used: row ? Number(row.credits_used) || 0 : 0, warned: row ? lower(row.warned) === 'true' : false };
}

function sameCompany(c, s) {
  const d1 = normDomain(c.last_company_domain);
  const d2 = normDomain(s.job_company_website);
  if (d1 && d2) return d1 === d2;
  return !!lower(s.job_company_name) && lower(s.job_company_name) === lower(c.last_company);
}

// A result answers the question if it shows a current job, and, when we have a "they left" signal,
// it isn't just the old job from data collected before that signal.
function isResolved(c, s) {
  if (!s || !s.found) return false;
  if (!clean(s.job_company_name) && !(Array.isArray(s.experience) && s.experience.length)) return false;
  if (['signal', 'retry', 'recheck'].includes(c.trigger) && sameCompany(c, s)) {
    const verified = new Date(clean(s.job_last_verified) || clean(s.job_last_changed));
    const signal = new Date(clean(c.signal_date));
    if (isNaN(verified.getTime()) || isNaN(signal.getTime()) || verified < signal) return false;
  }
  return true;
}

function cacheIndex(cacheRows) {
  const m = new Map();
  for (const r of cacheRows || []) {
    if (!r || !clean(r.contact_id)) continue;
    m.set(clean(r.contact_id), { ...r, summary: parseJson(r.summary_json, null), tried: parseJson(r.tried_json, {}) || {} });
  }
  return m;
}

function freshCached(cfg, c, row, now) {
  const days = Number(cfg.lookup_cache_days ?? 14);
  if (!row || !row.summary || daysAgo(row.looked_up_at, now) > days) return null;
  return isResolved(c, row.summary) ? row.summary : null;
}

// Who should slot i look up, within its budget?
function planSlot(cfg, i, candidates, cacheRows, usageRows, priorResults, nowInput) {
  const now = nowInput ? new Date(nowInput) : new Date();
  const slot = lookupSlot(cfg, i);
  const noop = { requests: [{ action: 'noop' }], budget_skipped: [], slot };
  if (!slot || slot.budget === 0) return noop;
  const repeatDays = Number(cfg.lookup_repeat_days ?? 30);
  const cache = cacheIndex(cacheRows);
  const prior = new Map();
  for (const r of priorResults || []) if (r && clean(r.contact_id)) (prior.get(clean(r.contact_id)) || prior.set(clean(r.contact_id), []).get(clean(r.contact_id))).push(r);

  const wanted = [];
  for (const c of candidates || []) {
    const row = cache.get(c.contact_id);
    if (freshCached(cfg, c, row, now)) continue;
    const earlier = prior.get(c.contact_id) || [];
    if (earlier.some((r) => r.pending === true || lower(r.pending) === 'true' || isResolved(c, r))) continue;
    // Applies to manual runs too: the Lookup Callback re-runs people manually, and asking the same tool
    // again right away would loop (and spend a credit each time).
    const triedAt = row && row.tried ? row.tried[slot.name] : '';
    if (daysAgo(triedAt, now) < repeatDays) continue;
    wanted.push({
      action: 'lookup_person',
      contact_id: c.contact_id,
      full_name: c.full_name, first_name: c.first_name, last_name: c.last_name,
      work_email: c.work_email, linkedin_url: c.linkedin_url,
      last_company: c.last_company, last_company_domain: c.last_company_domain, last_title: c.last_title,
    });
  }
  const used = usageFor(usageRows, slot.name, now).used;
  const remaining = slot.budget === null ? Infinity : Math.max(0, slot.budget - used);
  const requests = wanted.slice(0, remaining);
  const skipped = wanted.slice(requests.length).map((r) => r.contact_id);
  return { requests: requests.length ? requests : noop.requests, budget_skipped: skipped, slot };
}

// After all slots ran: pick each person's answer, and work out cache, usage and budget warnings.
function collectLookups(cfg, candidates, cacheRows, usageRows, slotResults, nowInput) {
  const now = nowInput ? new Date(nowInput) : new Date();
  const nowIso = now.toISOString();
  const warnAt = (Number(cfg.budget_warning_percent ?? 80) || 80) / 100;
  const cache = cacheIndex(cacheRows);
  const slots = [1, 2, 3].map((i) => lookupSlot(cfg, i));

  // Results per person, in slot order, each tagged with its provider.
  const byPerson = new Map();
  const credits = {};
  (slotResults || []).forEach((rows, idx) => {
    const slot = slots[idx];
    for (const r of rows || []) {
      if (!r || !clean(r.contact_id)) continue;
      const provider = lower(r.provider) || (slot && slot.name) || `lookup_${idx + 1}`;
      const res = { ...r, provider };
      (byPerson.get(res.contact_id) || byPerson.set(res.contact_id, []).get(res.contact_id)).push(res);
      credits[provider] = (credits[provider] || 0) + (Number(r.credits_used) || 0);
    }
  });

  const briefs = [];
  const pending = [];
  const cacheOut = [];
  for (const c of candidates || []) {
    const row = cache.get(c.contact_id);
    const results = byPerson.get(c.contact_id) || [];
    const isPending = (r) => r.pending === true || lower(r.pending) === 'true';
    const resolved = results.find((r) => isResolved(c, r));
    const cached = resolved ? null : freshCached(cfg, c, row, now);
    let chosen = resolved || cached;
    const waiting = !chosen && results.some(isPending);

    if (results.length) {
      // A failed call (bad key, outage) doesn't count as "tried", so it is retried next run.
      const tried = { ...(row ? row.tried : {}) };
      for (const r of results) if (!/^Lookup failed/i.test(clean(r.note))) tried[r.provider] = nowIso;
      const keep = resolved || results.find((r) => !isPending(r) && r.found) || results.find((r) => !isPending(r)) || results[0];
      const { contact_id, credits_used, pending: p, action, ...summary } = keep;
      cacheOut.push({
        contact_id: c.contact_id,
        provider: keep.provider,
        found: keep.found ? 'TRUE' : 'FALSE',
        pending: waiting ? 'TRUE' : 'FALSE',
        summary_json: JSON.stringify(summary),
        looked_up_at: nowIso,
        tried_json: JSON.stringify(tried),
        // Remember what started this investigation, so a later re-run (after Clay answers) keeps it.
        signal_json: ['signal', 'retry', 'recheck'].includes(c.trigger)
          ? JSON.stringify({ trigger: c.trigger, signal: c.signal, signal_evidence: c.signal_evidence, signal_date: c.signal_date, saved_at: nowIso })
          : clean(row && row.signal_json),
      });
    }

    if (waiting) { pending.push(c.contact_id); continue; }
    if (!chosen) {
      // Nothing resolved it: give the agent the best we have, so it can say [VERIFY] with evidence.
      chosen = results.find((r) => !isPending(r) && r.found)
        || results.find((r) => !isPending(r))
        || (row && row.summary)
        || { found: false, note: 'No lookup tool returned a result (none configured, all over budget, or tried recently).' };
    }
    const { contact_id, credits_used, pending: p, action, email, email_status, ...forAgent } = chosen;
    const emailOk = clean(email) && !/not_unlocked|@domain\.com$/i.test(email) && normDomain(email) === normDomain(chosen.job_company_website);
    briefs.push({
      ...c,
      lookup_source: clean(chosen.provider) || (cached ? clean(row.provider) : ''),
      lookup_email: emailOk ? lower(email) : '',
      lookup_email_status: emailOk ? lower(email_status) : '',
      lookup_json: JSON.stringify(forAgent, null, 1),
    });
  }

  // Usage and budget warnings.
  const usageOut = [];
  const alerts = [];
  for (const [provider, spent] of Object.entries(credits)) {
    if (!spent) continue;
    const slot = slots.find((s) => s && s.name === provider);
    const budget = slot ? slot.budget : null;
    const u = usageFor(usageRows, provider, now);
    const total = u.used + spent;
    let warned = u.warned;
    if (budget && !warned && total >= budget * warnAt) {
      warned = true;
      const pct = Math.round((total / budget) * 100);
      const text = `${provider} has used ${total} of its ${budget} lookup credits this month (${pct}%).${total >= budget ? ' It is now paused until next month; Valari will use the next tool in line.' : ' Valari will pause it at the limit and use the next tool in line.'}`;
      alerts.push({
        action: 'alert', kind: 'budget', contact_id: '',
        subject: `Valari: ${provider} lookup budget at ${pct}%`,
        text_md: `:warning: *Lookup budget:* ${text}`,
        html: `<p><b>Lookup budget:</b> ${text}</p>`,
        text_plain: `Lookup budget: ${text}`,
        to_name: '', to_email: '', to_slack_id: '', cc_name: '', cc_email: '', cc_slack_id: '', priority: '',
      });
    }
    usageOut.push({ usage_key: u.key, month: monthKey(now), provider, credits_used: String(total), budget: budget === null ? '' : String(budget), warned: warned ? 'TRUE' : 'FALSE' });
  }

  return { briefs, pending, cache_rows: cacheOut, usage_rows: usageOut, alerts };
}

// @node-only-start
module.exports = { lookupSlot, planSlot, collectLookups, isResolved };
// @node-only-end
