// Praxis Phase 1 demo console. Vanilla JS — the Angular 21 app lands in Phase 3 (ADR-0011).
const API = '/api/v1';
let token = localStorage.getItem('praxis_token') || '';
let fleetSse = null;
let runSse = null;
let watchingRunId = null;

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.title || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

// ---------- auth ----------
$('#login-btn').onclick = async () => {
  $('#login-err').textContent = '';
  try {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
    token = r.accessToken; localStorage.setItem('praxis_token', token);
    boot();
  } catch (e) { $('#login-err').textContent = e.message; }
};
$('#register-link').onclick = async (ev) => {
  ev.preventDefault();
  $('#login-err').textContent = '';
  try {
    const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({
      email: $('#email').value, password: $('#password').value, name: 'Admin', tenantName: 'Acme ' + Math.random().toString(36).slice(2, 6),
    }) });
    token = r.accessToken; localStorage.setItem('praxis_token', token); boot();
  } catch (e) { $('#login-err').textContent = e.message; }
};

// ---------- boot ----------
async function boot() {
  try { await api('/auth/me'); } catch { token = ''; localStorage.removeItem('praxis_token'); return; }
  $('#login-panel').hidden = true;
  $('#app').hidden = false;
  await loadProjects();
  await loadWorkItems();
  await loadRuns();
  openFleetStream();
}

async function loadProjects() {
  const projects = await api('/projects');
  const sel = $('#project-select');
  sel.innerHTML = '';
  projects.forEach((p) => { const o = el('option', null, p.name); o.value = p.id; sel.appendChild(o); });
}

$('#refresh-wi').onclick = loadWorkItems;
async function loadWorkItems() {
  const pid = $('#project-select').value;
  const items = await api('/work-items' + (pid ? `?projectId=${pid}` : ''));
  const tb = $('#wi-table tbody'); tb.innerHTML = '';
  items.forEach((w) => {
    const tr = el('tr');
    tr.appendChild(el('td', null, w.title));
    tr.appendChild(el('td')).appendChild(el('span', 'pill', w.state));
    tr.appendChild(el('td', 'muted', (w.labels || []).join(', ')));
    const td = el('td');
    const btn = el('button', null, 'Start run');
    btn.onclick = () => startRun(w.id);
    td.appendChild(btn); tr.appendChild(td);
    tb.appendChild(tr);
  });
}

$('#wi-create').onclick = async () => {
  const ac = $('#wi-ac').value.split('\n').map((s) => s.trim()).filter(Boolean);
  await api('/work-items', { method: 'POST', body: JSON.stringify({
    projectId: $('#project-select').value, title: $('#wi-title').value, bodyMd: $('#wi-body').value, acceptanceCriteria: ac,
  }) });
  $('#wi-title').value = $('#wi-body').value = $('#wi-ac').value = '';
  loadWorkItems();
};

async function startRun(workItemId) {
  const run = await api('/runs', { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ workItemId }) });
  await loadRuns();
  watchRun(run.id);
}

async function loadRuns() {
  const { data } = await api('/runs?limit=25');
  const tb = $('#runs-table tbody'); tb.innerHTML = '';
  data.forEach((r) => {
    const tr = el('tr', 'clickable');
    tr.onclick = () => watchRun(r.id);
    tr.appendChild(el('td', 'muted', r.id.slice(0, 8)));
    tr.appendChild(el('td')).appendChild(el('span', 'pill', r.state));
    tr.appendChild(el('td', null, '$' + (r.totals?.costUsd ?? 0).toFixed(3)));
    tr.appendChild(el('td', null, String(r.totals?.tokens ?? 0)));
    tr.appendChild(el('td', null, String(r.totals?.filesChanged ?? 0)));
    tr.appendChild(el('td', 'muted', r.prRef ? `#${r.prRef.number}` : '—'));
    tb.appendChild(tr);
  });
}

// ---------- streams ----------
function openFleetStream() {
  if (fleetSse) fleetSse.close();
  fleetSse = new EventSource(`${API}/streams/fleet?token=${encodeURIComponent(token)}`);
  fleetSse.onopen = () => setConn(true);
  fleetSse.onerror = () => setConn(false);
  fleetSse.onmessage = () => {};
  ['run.state_changed', 'run.completed', 'run.totals_updated', 'run.created'].forEach((t) =>
    fleetSse.addEventListener(t, () => loadRuns()));
}

function setConn(live) {
  const c = $('#conn');
  c.textContent = live ? '● live' : '○ reconnecting…';
  c.className = 'conn' + (live ? ' live' : '');
}

function watchRun(runId) {
  watchingRunId = runId;
  $('#watching').textContent = '· ' + runId.slice(0, 8);
  $('#activity').innerHTML = '';
  ['pause', 'resume', 'cancel', 'comment'].forEach((k) => $(`#${k}-btn`).disabled = false);
  if (runSse) runSse.close();
  runSse = new EventSource(`${API}/streams/runs/${runId}?token=${encodeURIComponent(token)}`);
  runSse.onopen = () => setConn(true);
  runSse.onerror = () => setConn(false);
  const handle = (e) => {
    let data; try { data = JSON.parse(e.data); } catch { return; }
    if (e.type === 'heartbeat') return;
    appendEvent(data);
    if (['run.state_changed', 'run.totals_updated', 'run.completed', 'vcs.pr.opened'].includes(data.type)) loadRuns();
  };
  // catch-all: listen to every catalog type we care about + generic 'message'
  ['message', 'run.created', 'run.state_changed', 'run.totals_updated', 'run.completed', 'run.failed',
   'plan.created', 'plan.step_defined', 'run_step.started', 'run_step.finished',
   'message.delta', 'tool_call.started', 'tool_call.finished',
   'verify.started', 'verify.check_finished', 'verify.finished', 'review.finished',
   'git.branch.created', 'git.commit.created', 'git.pushed', 'vcs.pr.opened',
   'approval.requested', 'operator.message', 'run.paused', 'run.resumed'
  ].forEach((t) => runSse.addEventListener(t, handle));
}

function appendEvent(ev) {
  const box = $('#activity');
  const line = el('div', 'ev');
  const kind = ev.type || '';
  if (kind.startsWith('run.state') || kind === 'run.paused' || kind === 'run.resumed') line.classList.add('state');
  if (kind.startsWith('tool_call')) line.classList.add('tool');
  if (kind === 'run.failed') line.classList.add('err');
  const ts = (ev.ts || '').slice(11, 19);
  const p = ev.payload || {};
  let detail = '';
  if (kind === 'message.delta') detail = p.deltaText || '';
  else if (kind === 'tool_call.started') detail = `${p.tool} ${p.argsPreview || ''}`;
  else if (kind === 'tool_call.finished') detail = `${p.status} · ${p.outputPreview || ''}`;
  else if (kind === 'run.state_changed') detail = `${p.from ?? ''} → ${p.to}`;
  else if (kind === 'plan.step_defined') detail = `#${p.index} ${p.title}`;
  else if (kind === 'run_step.started') detail = `#${p.index} ${p.title}`;
  else if (kind === 'run.totals_updated') detail = `$${(p.costUsd ?? 0).toFixed(3)} · ${p.tokens} tok · ${p.filesChanged} files`;
  else if (kind === 'vcs.pr.opened') detail = p.url || '';
  else detail = JSON.stringify(p).slice(0, 160);
  line.innerHTML = `<span class="t">${ts}</span> <span class="k">${kind}</span> ${escapeHtml(detail)}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

$('#pause-btn').onclick = () => watchingRunId && api(`/runs/${watchingRunId}/pause`, { method: 'POST', body: '{}' });
$('#resume-btn').onclick = () => watchingRunId && api(`/runs/${watchingRunId}/resume`, { method: 'POST', body: '{}' });
$('#cancel-btn').onclick = () => watchingRunId && api(`/runs/${watchingRunId}/cancel`, { method: 'POST', body: '{}' });
$('#comment-btn').onclick = () => {
  if (!watchingRunId) return;
  api(`/runs/${watchingRunId}/comment`, { method: 'POST', body: JSON.stringify({ text: $('#comment-input').value }) });
  $('#comment-input').value = '';
};

if (token) boot();
