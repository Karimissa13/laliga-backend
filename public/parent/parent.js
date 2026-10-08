// Parent account: sign in, choose a password (required after a temporary one),
// then see children and invoices. Talks only to /api/v1/parent/*.
const API = '/api/v1/parent';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'AED ' + Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB') : '—');
let TOKEN = null, MUST = false;
try { TOKEN = sessionStorage.getItem('ll-parent'); MUST = sessionStorage.getItem('ll-parent-mcp') === '1'; } catch {}

function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2400); }
function save(tok, must) {
  TOKEN = tok; MUST = !!must;
  try { if (tok) { sessionStorage.setItem('ll-parent', tok); sessionStorage.setItem('ll-parent-mcp', must ? '1' : '0'); } else { sessionStorage.removeItem('ll-parent'); sessionStorage.removeItem('ll-parent-mcp'); } } catch {}
}
async function api(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) } });
  const txt = await res.text(); let body; try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  if (!res.ok) { const e = new Error((body && body.message) || res.statusText); e.status = res.status; e.body = body; throw e; }
  return body;
}

function loginView(msg) {
  $('p-out').hidden = true;
  $('p-view').innerHTML = `<div class="pcard narrow"><h1>Parent sign-in</h1><p>Use the email and password from your welcome email.</p>
    <div class="fld"><label for="l-email">Email</label><input id="l-email" type="email" autocomplete="username"></div>
    <div class="fld"><label for="l-pass">Password</label><input id="l-pass" type="password" autocomplete="current-password"></div>
    <button class="btn" id="l-go" style="width:100%">Sign in</button><div class="err" id="l-err">${esc(msg || '')}</div>
    <p style="margin:14px 0 0;font-size:12px">Forgot your password? Ask the academy to send you new sign-in details.</p></div>`;
  const go = async () => {
    $('l-err').textContent = ''; $('l-go').disabled = true;
    try { const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: $('l-email').value.trim(), password: $('l-pass').value }) }); save(r.accessToken, r.mustChangePassword); route(); }
    catch (e) { $('l-err').textContent = e.message; } finally { if ($('l-go')) $('l-go').disabled = false; }
  };
  $('l-go').onclick = go; $('l-pass').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('l-email').focus();
}

function changeView(first) {
  $('p-out').hidden = false;
  $('p-view').innerHTML = `<div class="pcard narrow"><h1>${first ? 'Choose your password' : 'Change password'}</h1>
    <p>${first ? 'You signed in with a temporary password. Choose your own to continue.' : ''} At least 8 characters, with letters and a number.</p>
    <div class="fld"><label for="c-cur">${first ? 'Temporary password' : 'Current password'}</label><input id="c-cur" type="password" autocomplete="current-password"></div>
    <div class="fld"><label for="c-new">New password</label><input id="c-new" type="password" autocomplete="new-password"></div>
    <div class="fld"><label for="c-new2">New password again</label><input id="c-new2" type="password" autocomplete="new-password"></div>
    <button class="btn" id="c-go" style="width:100%">Save password</button><div class="err" id="c-err"></div>
    ${first ? '' : '<p style="margin:12px 0 0"><a href="#" id="c-back">Back</a></p>'}</div>`;
  $('c-go').onclick = async () => {
    const n1 = $('c-new').value, n2 = $('c-new2').value;
    if (n1 !== n2) { $('c-err').textContent = 'The two new passwords are different.'; return; }
    try { const r = await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: $('c-cur').value, newPassword: n1 }) }); save(r.accessToken, false); toast('Password saved'); route(); }
    catch (e) { $('c-err').textContent = Array.isArray(e.body?.message) ? e.body.message.join(' ') : e.message; }
  };
  const back = $('c-back'); if (back) back.onclick = (e) => { e.preventDefault(); route(); };
}

async function homeView() {
  $('p-out').hidden = false;
  const [d, reports] = await Promise.all([api('/me'), api('/reports').catch(() => [])]);
  const due = d.invoices.filter((i) => i.balance > 0.05);
  $('p-view').innerHTML = `<div class="pcard"><h1>Hello, ${esc(d.parent.name.split(' ')[0])}</h1>
    <p>Parent no. ${esc(d.parent.reference)} · ${esc(d.parent.email)} · <a href="#" id="h-pw">Change password</a></p>
    <div class="ph2">Your children</div>
    <div class="kids">${d.children.map((k) => `<div class="kid"><b>${esc(k.name)}</b><div class="mini">${esc(k.reference)} · ${esc(k.category || '')}</div>
      <div style="margin-top:6px;font-size:13px">${esc(k.team || 'Team to be confirmed')}</div><div class="mini">${esc(k.terms.join(', ') || 'Not enrolled in a term')}</div></div>`).join('') || '<div class="mini">No children on file.</div>'}</div>
    <div class="ph2">Invoices ${due.length ? `<span class="pill p-warn">${due.length} to pay</span>` : ''}</div>
    <div class="tblwrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th class="num">Total</th><th class="num">To pay</th><th></th></tr></thead>
      <tbody>${d.invoices.map((i) => `<tr><td class="ref">${esc(i.number)}</td><td>${dmy(i.date)}</td><td>${dmy(i.dueDate)}</td><td class="num">${money(i.total)}</td>
        <td class="num">${i.balance > 0.05 ? `<b style="color:var(--coral)">${money(i.balance)}</b>` : '<span class="pill p-good">Paid</span>'}</td>
        <td><button class="btn sm ghost" data-pdf="${i.id}" data-no="${esc(i.number)}">Download PDF</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No invoices yet.</td></tr>'}</tbody></table></div>
    <div class="ph2">Term reports</div>
    <div class="tblwrap"><table><thead><tr><th>Child</th><th>Term</th><th>Report</th><th>Coach</th><th></th></tr></thead>
      <tbody>${reports.map((r) => `<tr><td>${esc(r.child)}</td><td>${esc(r.term || '')} <span class="mini">${esc(r.season || '')}</span></td>
        <td>${r.reportType === 'ADVANCED' ? 'Advanced report' : 'Development report'}</td><td>${esc(r.coach || '—')}</td>
        <td><button class="btn sm ghost" data-rep="${r.id}" data-no="${esc((r.child || 'Report').replace(/\s+/g, '-'))}-${esc((r.term || '').replace(/\s+/g, ''))}">Download PDF</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No reports yet — they appear here at the end of each term.</td></tr>'}</tbody></table></div></div>`;
  $('h-pw').onclick = (e) => { e.preventDefault(); changeView(false); };
  document.querySelectorAll('[data-rep]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API}/reports/${b.dataset.rep}/pdf`, { headers: { Authorization: 'Bearer ' + TOKEN } });
      if (!res.ok) throw new Error('Could not download the report');
      const url = URL.createObjectURL(await res.blob()), a = document.createElement('a');
      a.href = url; a.download = `${b.dataset.no}-report.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { toast(e.message); }
  }));
  document.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API}/invoices/${b.dataset.pdf}/pdf`, { headers: { Authorization: 'Bearer ' + TOKEN } });
      if (!res.ok) throw new Error('Could not download the invoice');
      const url = URL.createObjectURL(await res.blob()), a = document.createElement('a');
      a.href = url; a.download = `Invoice-${b.dataset.no}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { toast(e.message); }
  }));
}

async function route() {
  if (!TOKEN) return loginView();
  if (MUST) return changeView(true);
  try { await homeView(); }
  catch (e) {
    if (e.status === 401) { save(null); return loginView('Please sign in again.'); }
    if (e.status === 403 && e.body?.error === 'PasswordChangeRequired') { MUST = true; return changeView(true); }
    $('p-view').innerHTML = `<div class="pcard"><b>Something went wrong.</b><p>${esc(e.message)}</p></div>`;
  }
}
$('p-out').onclick = () => { save(null); loginView(); };
route();
