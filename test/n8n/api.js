// Tiny helper for driving a throwaway n8n instance over its REST API.
// Env: N8N_URL (default http://127.0.0.1:5678), N8N_EMAIL, N8N_PASSWORD.
const BASE = process.env.N8N_URL || 'http://127.0.0.1:5678';
const EMAIL = process.env.N8N_EMAIL || 'owner@test.example';
const PASSWORD = process.env.N8N_PASSWORD || 'Passw0rd!Passw0rd';
let cookie = '';
async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', cookie, 'browser-id': 'test-browser' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${t.slice(0, 600)}`);
  return j && j.data !== undefined ? j.data : j;
}
async function login() {
  try { await api('POST', '/rest/login', { emailOrLdapLoginId: EMAIL, password: PASSWORD }); }
  catch (e) { await api('POST', '/rest/owner/setup', { email: EMAIL, firstName: 'Test', lastName: 'Owner', password: PASSWORD }); }
}
async function createWorkflow(wf, pinData) {
  return api('POST', '/rest/workflows', { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || { executionOrder: 'v1' }, pinData: pinData || {}, active: false });
}
async function runWorkflow(w, trigger, pinData) {
  const run = await api('POST', `/rest/workflows/${w.id}/run`, { workflowData: { ...w, pinData: pinData || w.pinData || {} }, triggerToStartFrom: { name: trigger } });
  let ex;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    ex = await api('GET', `/rest/executions/${run.executionId}`);
    if (['success', 'error', 'crashed', 'canceled'].includes(ex.status)) break;
  }
  const { parse } = require('flatted');
  const data = typeof ex.data === 'string' ? parse(ex.data) : ex.data;
  return { status: ex.status, data, runData: data.resultData.runData, error: data.resultData.error };
}
const out = (runData, name, run = 0, output = 0) => (runData[name]?.[run]?.data?.main?.[output] || []).map((i) => i.json);
module.exports = { api, login, createWorkflow, runWorkflow, out };
