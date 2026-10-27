// Small mapping helpers for the Gmail, Hunter and Salesloft connectors. Inlined into their Code nodes.

// Gmail (raw format) → the standard signal message.
function normalizeGmail(m) {
  const clean = (v) => String(v ?? '').trim();
  if (!m || typeof m !== 'object' || !m.id) return null;
  return {
    id: clean(m.id),
    subject: clean(m.subject || m.Subject),
    from: clean((m.from && (m.from.text || (m.from.value && m.from.value[0] && m.from.value[0].address))) || m.From),
    text: clean(m.text || m.snippet).slice(0, 4000),
    date: clean(m.date),
    headers: m.headers && typeof m.headers === 'object' ? m.headers : {},
  };
}

// Hunter Email Finder response → the standard email result.
function mapHunter(req, res) {
  const clean = (v) => String(v ?? '').trim();
  const d = (res && res.data) || {};
  const email = clean(d.email);
  const v = clean(d.verification && d.verification.status).toLowerCase();
  const status = !email ? '' : v === 'valid' ? 'valid' : v === 'invalid' ? 'invalid' : v === 'accept_all' ? 'risky' : 'unknown';
  return {
    contact_id: clean(req.contact_id),
    email,
    confidence: email && d.score !== undefined && d.score !== null ? Number(d.score) : '',
    status,
    source: 'hunter',
    error: res && res.error ? clean(res.error.message || res.error) : '',
  };
}

// Salesloft: pick the cadence for each enroll request, or say why it's skipped.
// cadenceIds: { "net_new": 123, "lost_deal": 456, "open_deal": 789, "customer": 101, "default": 999 }
function planSalesloft(requests, cadenceIds, userIdsByEmail) {
  const clean = (v) => String(v ?? '').trim();
  const cads = cadenceIds && typeof cadenceIds === 'object' ? cadenceIds : {};
  const users = {};
  for (const [k, v] of Object.entries(userIdsByEmail || {})) users[k.toLowerCase()] = v;
  return (requests || [])
    .filter((r) => r && r.action === 'enroll')
    .map((r) => {
      const cadence = cads[r.cadence_key] ?? cads.default;
      const cadenceId = cadence && typeof cadence === 'object' ? clean(cadence.id) : clean(cadence);
      const cadenceName = cadence && typeof cadence === 'object' ? clean(cadence.name) : '';
      return {
        ...r,
        cadence_id: cadenceId,
        cadence_name: cadenceName || cadenceId,
        user_id: clean(r.owner_sequence_user_id) || clean(users[clean(r.owner_email).toLowerCase()]),
        skip_reason: !cadenceId ? `no cadence set for "${r.cadence_key}"` : !clean(r.email) ? 'no email' : '',
      };
    });
}

// @node-only-start
module.exports = { normalizeGmail, mapHunter, planSalesloft };
// @node-only-end
