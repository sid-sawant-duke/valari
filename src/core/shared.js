// Small helpers shared by the core logic. Inlined into each Code node by scripts/build-workflows.js.

const clean = (v) => String(v ?? '').trim();
const lower = (v) => clean(v).toLowerCase();
const truthy = (v) => ['true', 'yes', '1', 'y'].includes(lower(v));

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  const s = clean(value);
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function normDomain(s) {
  let d = lower(s);
  if (!d) return '';
  d = d.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  if (d.includes('@')) d = d.split('@').pop();
  return d;
}

function splitName(full) {
  const parts = clean(full).split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

// Stable 1, 2 or 3 from a contact_id, so a third of the list is swept each month without anyone assigning groups.
function sweepGroupFor(id) {
  let h = 0;
  const s = clean(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return String((h % 3) + 1);
}

const isoDay = (d) => d.toISOString().slice(0, 10);

// Team directory (Config): { "<email, CRM owner id or name>": { name, email, slack_id, crm_id, salesloft_user_id }, "default": {...} }
function loadDirectory(cfg) {
  const raw = parseJson(cfg.team_directory, {}) || {};
  const dir = {};
  for (const [k, v] of Object.entries(raw)) dir[lower(k)] = v && typeof v === 'object' ? v : {};
  return dir;
}

// Fills an owner's missing name / email / Slack ID / CRM ID / sequence user ID from the directory.
function resolveOwner(dir, owner, useDefault = true) {
  const o = owner || {};
  let entry = dir[lower(o.email)] || dir[lower(o.crm_id)] || dir[lower(o.name)];
  const hasOwner = clean(o.name) || clean(o.email) || clean(o.crm_id);
  if (!entry && !hasOwner && useDefault) entry = dir.default;
  entry = entry || {};
  return {
    name: clean(o.name) || clean(entry.name),
    email: lower(o.email) || lower(entry.email),
    slack_id: clean(o.slack_id) || clean(entry.slack_id),
    crm_id: clean(o.crm_id) || clean(entry.crm_id),
    sequence_user_id: clean(o.sequence_user_id) || clean(entry.salesloft_user_id || entry.sequence_user_id),
  };
}

// @node-only-start
module.exports = { clean, lower, truthy, parseJson, normDomain, splitName, sweepGroupFor, isoDay, loadDirectory, resolveOwner };
// @node-only-end
