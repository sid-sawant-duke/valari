// Builds the digest (email HTML plus Slack markdown) from the cases table.
// Pure function: tested in test/, inlined into the "Build Digest" Code node.

// @node-only-start
const { clean, lower } = require('./shared');
// @node-only-end

function buildDigest(cfg, cases, nowInput) {
  const now = nowInput ? new Date(nowInput) : new Date();
  const days = Number(cfg.digest_lookback_days) || 14;
  const since = new Date(now.getTime() - days * 86400000);
  const esc = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  const recent = (cases || []).filter((c) => {
    const d = new Date(clean(c.created_at));
    return clean(c.case_id) && !isNaN(d.getTime()) && d >= since && d <= now;
  });
  const latest = new Map();
  for (const c of recent) {
    const prev = latest.get(c.contact_id);
    if (!prev || new Date(c.created_at) > new Date(prev.created_at)) latest.set(c.contact_id, c);
  }
  const rows = [...latest.values()];
  const confirmed = rows.filter((c) => c.outcome === 'confirmed').sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const verify = rows.filter((c) => c.outcome === 'verify');
  const enrolled = confirmed.filter((c) => lower(c.sequence_status) === 'enrolled').length;
  const meetings = rows.filter((c) => ['meeting_booked', 'opportunity'].includes(lower(c.ae_feedback))).length;

  const bucketLabel = { customer: 'Existing customer', open_deal: 'Open deal', lost_deal: 'Lost deal', net_new: 'Net new' };
  const th = 'style="text-align:left;padding:8px;border-bottom:2px solid #1f2937;font-size:13px"';
  const td = 'style="padding:8px;border-bottom:1px solid #e5e7eb;font-size:13px;vertical-align:top"';
  const link = (url, label) => (clean(url) ? `<a href="${esc(url)}">${esc(label)}</a>` : '');
  const title = clean(cfg.digest_title) || 'Champion moves';
  const range = `${fmt(since)} to ${fmt(now)}`;
  const subject = `${title}: ${confirmed.length} confirmed, ${verify.length} to verify (${range})`;
  const funnel = `${rows.length} investigated · ${confirmed.length} confirmed · ${enrolled} enrolled in a sequence · ${meetings} meetings or opportunities logged`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:780px">
<h2 style="margin:0 0 4px">${esc(title)}</h2>
<p style="margin:0 0 16px;color:#6b7280;font-size:13px">${range} · ${esc(funnel)}</p>
<h3 style="margin:16px 0 8px">Confirmed moves (${confirmed.length})</h3>
${confirmed.length ? `<table style="border-collapse:collapse;width:100%">
<tr><th ${th}>Person</th><th ${th}>Move</th><th ${th}>New title</th><th ${th}>Persona</th><th ${th}>Account</th><th ${th}>Priority</th><th ${th}>Sequence</th><th ${th}>Owner</th></tr>
${confirmed.map((c) => `<tr><td ${td}>${esc(c.full_name)}<br>${link(c.linkedin_url, 'LinkedIn')}</td><td ${td}>${esc(c.old_company)} → <b>${esc(c.new_company)}</b></td><td ${td}>${esc(c.new_title)}</td><td ${td}>${esc(c.persona)}</td><td ${td}>${esc(bucketLabel[c.bucket] || c.bucket)}</td><td ${td}>${esc(c.priority)} (${esc(c.score)})</td><td ${td}>${esc(c.sequence_status)}</td><td ${td}>${esc(c.owner_ae)}</td></tr>`).join('\n')}
</table>` : '<p style="font-size:13px;color:#6b7280">No confirmed moves in this period.</p>'}
<h3 style="margin:24px 0 8px">Needs a manual check [VERIFY] (${verify.length})</h3>
${verify.length ? `<ul style="font-size:13px;padding-left:18px">${verify.map((c) => `<li><b>${esc(c.full_name)}</b> (${esc(c.old_company)}), owner ${esc(c.owner_ae) || 'unassigned'}. ${link(c.linkedin_url, 'Check LinkedIn')}</li>`).join('')}</ul>` : '<p style="font-size:13px;color:#6b7280">Nothing waiting on a manual check.</p>'}
<p style="margin-top:24px;font-size:12px;color:#6b7280">Full history is in the valari_cases data table. Set ae_feedback there (useful, not_useful, wrong_person, contacted, meeting_booked, opportunity) so scoring can be tuned.</p>
</div>`;

  const md = [
    `*${title}* (${range})`,
    funnel,
    '',
    `*Confirmed moves (${confirmed.length})*`,
    ...(confirmed.length ? confirmed.map((c) => `• ${c.priority} ${c.score}: *${clean(c.full_name)}* ${clean(c.old_company)} → *${clean(c.new_company)}*${c.new_title ? `, ${clean(c.new_title)}` : ''}${c.persona ? ` (${clean(c.persona)})` : ''} · ${clean(c.owner_ae) || 'unassigned'}`) : ['No confirmed moves.']),
    '',
    `*Needs a manual check [VERIFY] (${verify.length})*`,
    ...(verify.length ? verify.map((c) => `• ${clean(c.full_name)} (${clean(c.old_company)}) · ${clean(c.owner_ae) || 'unassigned'}${c.linkedin_url ? ` · <${clean(c.linkedin_url)}|LinkedIn>` : ''}`) : ['Nothing waiting.']),
  ].join('\n');

  return { action: 'digest', subject, html, text_md: md, confirmed: confirmed.length, verify: verify.length, checked: rows.length, enrolled, meetings };
}

// @node-only-start
module.exports = { buildDigest };
// @node-only-end
