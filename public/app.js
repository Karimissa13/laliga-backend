const API = '/api/v1';
let TOKEN = null, REFRESH = null, ME = null;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (n) => 'AED ' + Number(n || 0).toLocaleString('en-AE', {minimumFractionDigits:2, maximumFractionDigits:2});
const dt = (d) => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const dtm = (d) => d ? new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';

function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('on'); setTimeout(()=>t.classList.remove('on'),2200); }

async function api(path, opts={}, retried=false){
  const res = await fetch(API+path, {
    ...opts,
    headers: { 'Content-Type':'application/json', ...(TOKEN?{Authorization:'Bearer '+TOKEN}:{}) , ...(opts.headers||{})}
  });
  // The access token lives 15 minutes: renew it once with the refresh token and retry.
  if(res.status===401 && !retried && REFRESH && !/^\/auth\/(login|refresh|logout)\b/.test(path)){
    if(await renewSession()) return api(path, opts, true);
    endSession('Your session has ended. Please sign in again.');
  }
  const txt = await res.text();
  let body; try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  if(!res.ok){ const e = new Error((body && (body.message||body.error)) || res.statusText); e.status=res.status; e.body=body; throw e; }
  return body;
}

// ---------- session ----------
function keepSession(r){
  TOKEN = r.accessToken; REFRESH = r.refreshToken || null;
  try{ sessionStorage.setItem('ll-token', TOKEN); REFRESH ? sessionStorage.setItem('ll-refresh', REFRESH) : sessionStorage.removeItem('ll-refresh'); }catch{}
}
let renewing = null;
/** One renewal at a time: calls that expire together wait for the same new token. */
function renewSession(){
  if(!renewing){
    renewing = fetch(API+'/auth/refresh', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ refreshToken: REFRESH }) })
      .then(async (r) => { if(!r.ok) return false; keepSession(await r.json()); return true; })
      .catch(() => false)
      .finally(() => { renewing = null; });
  }
  return renewing;
}
function endSession(message){
  TOKEN = null; REFRESH = null; ME = null;
  try{ sessionStorage.removeItem('ll-token'); sessionStorage.removeItem('ll-refresh'); }catch{}
  $('app').classList.remove('on'); $('login').style.display='grid';
  $('li-err').textContent = message || '';
}
function can(p){ return ME && (ME.permissions.includes('*') || ME.permissions.includes(p)); }

// ---------- pills ----------
function statusPill(s){
  const map = {ACTIVE:'p-good',REGISTERED:'p-good',PAID:'p-good',TRIAL:'p-info',ISSUED:'p-info',
    WAITLISTED:'p-warn',PART_PAID:'p-warn',TRIAL_BOOKED:'p-info',TRIAL_ATTENDED:'p-info',OFFER_MADE:'p-warn',
    WITHDRAWN:'p-mute',LOST:'p-mute',CANCELLED:'p-mute',NEW:'p-mute',CONTACTED:'p-mute',DRAFT:'p-mute',
    ABSENT:'p-bad',PRESENT:'p-good',LATE:'p-warn',EXCUSED:'p-info',
    WRITTEN_OFF:'p-mute',REFUNDED:'p-mute',SPONSORED:'p-info',PENDING:'p-warn',TRANSFERRED:'p-mute'};
  return `<span class="pill ${map[s]||'p-mute'}">${esc(String(s||'').replace(/_/g,' '))}</span>`;
}

// ---------- nav ----------
const PAGES = [
  {g:'Overview'},
  {k:'dashboard', t:'Dashboard', perm:'dashboard.view', icon:'◎'},
  {k:'analytics', t:'Analytics', perm:'report.view', icon:'◔'},
  {g:'People'},
  {k:'players', t:'Players', perm:'player.view', icon:'●'},
  {k:'register', t:'Register a child', perm:'player.create', icon:'+'},
  {k:'guardians', t:'Guardians', perm:'guardian.view', icon:'◐'},
  {k:'leads', t:'Trials & Leads', perm:'lead.view', icon:'◇'},
  {k:'trials', t:'Trials sheet', perm:'lead.view', icon:'◆'},
  {g:'Operations'},
  {k:'teams', t:'Teams', perm:'team.view', icon:'▣'},
  {k:'sessions', t:'Schedule', perm:'session.view', icon:'▤'},
  {k:'inventory', t:'Inventory', perm:'inventory.view', icon:'▥'},
  {k:'attendance', t:'Attendance', perm:'attendance.view', icon:'✓'},
  {k:'teamAttendance', t:'Team registers', perm:'attendance.view', icon:'▦'},
  {g:'Finance'},
  {k:'invoices', t:'Invoices', perm:'invoice.view', icon:'▦'},
  {k:'paymentReport', t:'Payment Report', perm:'payment.view', icon:'≣'},
  {k:'prices', t:'Price list & products', perm:'invoice.view', icon:'¤'},
  {k:'discounts', t:'Discount rules', perm:'discount.view', icon:'%'},
  {g:'Engagement'},
  {k:'comms', t:'Communications', perm:'communication.view', icon:'✉'},
  {k:'emails', t:'Email log', perm:'communication.view', icon:'@'},
  {k:'development', t:'Player development', perm:'evaluation.view', icon:'★'},
  {g:'System'},
  {k:'audit', t:'Activity log', perm:'audit.view', icon:'≡'},
  {k:'settings', t:'Settings', perm:'settings.manage', icon:'⚙'},
];

function renderNav(){
  let h='';
  for(const p of PAGES){
    if(p.g){ h += `<div class="grp">${p.g}</div>`; continue; }
    if(p.perm && !can(p.perm)) continue;
    h += `<a class="nav" data-k="${p.k}"><span style="width:14px;display:inline-block;opacity:.7">${p.icon}</span>${p.t}</a>`;
  }
  $('nav').innerHTML = h;
  $('nav').querySelectorAll('a.nav').forEach(a => a.onclick = () => go(a.dataset.k));
}

let CURRENT = 'dashboard';
async function go(k){
  CURRENT = k;
  $('nav').querySelectorAll('a.nav').forEach(a=>a.classList.toggle('on', a.dataset.k===k));
  const page = PAGES.find(p=>p.k===k);
  $('page-title').textContent = page ? page.t : k;
  $('page-acts').innerHTML='';
  $('view').innerHTML = '<div class="loading">Loading…</div>';
  try { await VIEWS[k](); }
  catch(e){ $('view').innerHTML = `<div class="card empty"><b>Couldn't load this page.</b><br><span class="mini">${esc(e.message)}${e.status===403?' — your role does not have permission for this data.':''}</span></div>`; }
}

// ---------- drawer ----------
function openDrawer(title, html, wide){ $('dw-title').textContent=title; $('dw-body').innerHTML=html; $('drawer').querySelector('.panel').classList.toggle('wide', !!wide); $('drawer').classList.add('on'); }
function closeDrawer(){ $('drawer').classList.remove('on'); }
$('drawer').onclick = (e) => { if(e.target.id==='drawer') closeDrawer(); };

// ================= VIEWS =================
const VIEWS = {};

// ================= shared lookups =================
// Reference lists the filters and forms need. Loaded once per sign-in and
// refreshed after anything that changes them (e.g. a coach assignment).
const LK = { loaded: false };
const ACT = {};   // actions dispatched by data-act; merged into ACTIONS below
const band = (c) => Number(String(c || '').replace(/\D/g, '')) || 0;
const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const shortLoc = (l) => String(l || '—').replace(/^Abu Dhabi\s*-\s*/i, '');
const LEVEL_WORD = { HPC: 'HPC', ADVANCED: 'Advanced', DEVELOPMENT: 'Development' };
/** "+971502223344" → "+971 50 222 3344"; anything else is shown as stored. */
const fmtPhone = (m) => { const s = String(m || ''); const x = s.match(/^\+971(5\d)(\d{3})(\d{4})$/); return x ? `+971 ${x[1]} ${x[2]} ${x[3]}` : s; };
/** "EMIRATES_ID_FRONT" → "Emirates ID front" */
const humanDoc = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()).replace(/emirates id/i, 'Emirates ID');
const lvlBadge = (l) => l ? `<span class="lvl ${esc(l)}">${esc(LEVEL_WORD[l] || l)}</span>` : '';

async function loadLookups(force) {
  if (LK.loaded && !force) return LK;
  const safe = (p) => api(p).catch(() => []);
  const [loc, ag, sea, ter, board, co] = await Promise.all([
    safe('/locations'), safe('/age-groups'), safe('/seasons'), safe('/terms'), safe('/team-board'), safe('/coaches'),
  ]);
  LK.locations = (loc || []).filter((l) => l.isActive);
  LK.ageGroups = (ag || []).filter((a) => a.isActive).sort((a, b) => band(a.code) - band(b.code));
  LK.seasons = sea || [];
  LK.activeSeason = LK.seasons.find((s) => s.isActive) || LK.seasons[0] || null;
  LK.terms = (ter || []).slice().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  LK.teams = board || [];
  LK.coaches = (co || []).map((c) => ({ id: c.id, name: c.user?.fullName || 'Coach', canLogin: c.user?.isActive !== false }));
  LK.loaded = true;
  return LK;
}

function payPill(p) {
  if (!p) return '—';
  const cls = { PAID: 'p-good', PART_PAID: 'p-warn', UNPAID: 'p-info', NOT_SENT: 'p-mute', NO_INVOICE: 'p-mute' }[p.state] || 'p-mute';
  return `<span class="pill ${p.overdue ? 'p-bad' : cls}">${esc(p.label)}</span>`;
}

// ================= dashboard =================
// One call (/dashboard/overview) feeds every widget. Filters are kept for the
// session so returning to the dashboard shows the same location and season.
let DASHF = { locationId: '', seasonId: '', revMode: 'month', week0: null };
let DASH = null;

const aed0 = (n) => 'AED ' + Math.round(Number(n || 0)).toLocaleString('en-AE');
const aedShort = (n) => { n = Number(n || 0); const a = Math.abs(n);
  return a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n)); };
const STREAM_VAR = { ACADEMY: '--s-academy', KITS: '--s-kits', MAN_CITY_LEAGUE: '--s-mcl', ABU_DHABI_CUP: '--s-adc',
  RAMADAN_CUP: '--s-ramadan', SALOU_CUP: '--s-salou', OTHER: '--s-other', PENDING: '--s-pending' };
const sc = (k) => `var(${STREAM_VAR[k] || '--s-other'})`;
const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const pctTxt = (p) => (p == null ? '—' : p + '%');

/** Round an axis maximum up to a friendly number. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

VIEWS.dashboard = async () => {
  await loadLookups();
  const qs = new URLSearchParams();
  if (DASHF.locationId) qs.set('locationId', DASHF.locationId);
  if (DASHF.seasonId) qs.set('seasonId', DASHF.seasonId);
  const [d, q] = await Promise.all([
    api('/dashboard/overview' + (qs.toString() ? '?' + qs : '')),
    api('/dashboard/pending-actions').catch(() => null),
  ]);
  DASH = d;
  if (!DASHF.seasonId) DASHF.seasonId = d.filters.season.id;
  if (DASHF.week0 == null && d.admin.schedule) DASHF.week0 = Math.max(1, d.admin.schedule.currentWeek);
  renderDashboard(q);
};

function renderDashboard(q) {
  const d = DASH, a = d.admin, f = d.finance;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('page-title').textContent = 'Dashboard';
  $('view').innerHTML = `<div class="dash">
    <div class="dhead">
      <div><div class="dtitle">LaLiga Football Academy Abu Dhabi</div><div class="ddate">${esc(today)}</div></div>
      <div class="dctl">
        <div class="dfilters">
          <label class="dsel"><span>Location</span><select id="df-loc">${opt('', 'All locations', !DASHF.locationId)}${LK.locations.map((l) => opt(l.id, shortLoc(l.name), DASHF.locationId === l.id)).join('')}</select></label>
          <label class="dsel"><span>Season</span><select id="df-season">${LK.seasons.map((s) => opt(s.id, seasonName(s), DASHF.seasonId === s.id)).join('')}</select></label>
        </div>
        <div class="card wallet" title="Credit held in family wallets${d.filters.location ? ' at this location' : ''} — overpayments, refunds to wallet and sibling credits not yet used.">
          <div class="wn">${money(d.wallet.balance)}</div><div class="wl">${walletIcon()} Wallet balance</div>
          <div class="mini">${d.wallet.familiesWithCredit} famil${d.wallet.familiesWithCredit === 1 ? 'y' : 'ies'} in credit</div></div>
      </div>
    </div>

    <h3 class="dsec">Admin dashboard</h3>
    <div class="dgrid dadmin">
      ${playersCard(a.players)}
      ${coachesCard(a.coaches)}
      ${attendanceCard(a.attendance)}
      <div class="card dcard dsched" id="d-sched">${scheduleCard(a.schedule)}</div>
    </div>

    ${f ? `<h3 class="dsec">Finance dashboard</h3>
    <div class="dgrid dfin">
      <div class="card dcard" id="d-rev">${revenueCard(f)}</div>
      ${kitsCard(f.kits)}
      ${paymentsCard(f.payments)}
    </div>` : ''}

    ${q ? needsAttention(q) : ''}
  </div>`;
  $('df-loc').addEventListener('change', (e) => { DASHF.locationId = e.target.value; go('dashboard'); });
  $('df-season').addEventListener('change', (e) => { DASHF.seasonId = e.target.value; DASHF.week0 = null; go('dashboard'); });
  wireRev();
}
function wireRev() { const rm = $('df-rev'); if (rm) rm.onchange = (e) => { DASHF.revMode = e.target.value; $('d-rev').innerHTML = revenueCard(DASH.finance); wireRev(); }; }
const seasonName = (s) => {
  const y = s.startDate ? new Date(s.startDate).getFullYear() : null;
  return y && !/\d{4}/.test(s.name) ? `${s.name} (${y}–${String(y + 1).slice(2)})` : s.name;
};
const walletIcon = () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 13h2M2 10h20M6 6V4h12v2"/></svg>`;
const cardHead = (t, extra = '') => `<div class="dch"><h4>${t}</h4>${extra}</div>`;

// ---------- registered players ----------
function playersCard(p) {
  const pts = p.spark || [], max = Math.max(1, ...pts.map((x) => x.n)), W = 220, H = 56;
  const xy = pts.map((x, i) => [pts.length > 1 ? (i / (pts.length - 1)) * W : W, H - 4 - (x.n / max) * (H - 10)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const up = p.change >= 0;
  const delta = p.changePct != null ? `${up ? '+' : ''}${p.changePct}%` : (p.change ? `${up ? '+' : ''}${p.change}` : '0');
  return `<div class="card dcard">${cardHead('Registered players', '<span class="dic">●</span>')}
    <div class="bign">${p.registered.toLocaleString('en-AE')}</div>
    <div class="trend ${p.change > 0 ? 'up' : p.change < 0 ? 'down' : ''}">${p.change > 0 ? '▲' : p.change < 0 ? '▼' : '■'} ${delta} <span>vs last week (${p.lastWeek})</span></div>
    ${p.waitlisted ? `<div class="mini">${p.waitlisted} waitlisted</div>` : ''}
    <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Registered players over the last 8 weeks">
      <polygon points="0,${H} ${line} ${W},${H}" class="sa"/><polyline points="${line}" class="sl"/>
      ${xy.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="2.5" class="sd"><title>${dt(pts[i].at)}: ${pts[i].n}</title></circle>`).join('')}
    </svg><div class="mini">Children with an active enrolment this season, week by week</div></div>`;
}

// ---------- coaches ----------
function coachesCard(c) {
  const av = (x) => x.photoUrl ? `<img class="av" src="${esc(x.photoUrl)}" alt="">` : `<span class="av">${esc(initials(x.name))}</span>`;
  const split = c.notSet === c.total && c.total
    ? `<div class="mini">Full/part-time not set yet</div>`
    : `<div class="ftpt"><b>${c.fullTime}</b> full-time<br><b>${c.partTime}</b> part-time${c.notSet ? `<br><span class="mini">${c.notSet} not set</span>` : ''}</div>`;
  return `<div class="card dcard">${cardHead('Coaches', can('coach.edit') ? `<button class="lnk" data-act="dCoaches">Edit</button>` : '')}
    <div class="crow"><div class="bign">${c.total}</div>${split}</div>
    <div class="fc"><div class="k">Featured coaches</div>${c.featured.map((x) => `<div class="fcm">${av(x)}<div><b>${esc(x.name)}</b><div class="mini">${x.teams} team${x.teams === 1 ? '' : 's'}${x.employmentType ? ' · ' + (x.employmentType === 'FULL_TIME' ? 'Full-time' : 'Part-time') : ''}</div></div></div>`).join('') || '<div class="mini">No coaches</div>'}</div>
    ${c.notSet && can('coach.edit') ? `<button class="btn sm ghost" style="margin-top:10px" data-act="dCoaches">Set full / part-time</button>` : ''}</div>`;
}

// ---------- attendance ----------
function attendanceCard(t) {
  const R = 42, C = 2 * Math.PI * R, p = t.overallPct ?? 0;
  const cls = t.overallPct == null ? '' : p >= 85 ? 'good' : p >= 70 ? 'warn' : 'bad';
  return `<div class="card dcard">${cardHead('Players attendance', '<span class="mini">overall %</span>')}
    <div class="att"><svg viewBox="0 0 100 100" class="donut ${cls}" role="img" aria-label="Attendance ${pctTxt(t.overallPct)}">
      <circle cx="50" cy="50" r="${R}" class="trk"/>
      <circle cx="50" cy="50" r="${R}" class="val" stroke-dasharray="${(C * p / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/>
      <text x="50" y="55" text-anchor="middle">${pctTxt(t.overallPct)}</text></svg>
      <div class="cats">${t.byCategory.length ? t.byCategory.map((c) => `<div class="cat"><span class="cc">${esc(c.code)}</span><span class="cb"><i style="width:${c.pct ?? 0}%"></i></span><span class="cv">${pctTxt(c.pct)}</span></div>`).join('')
        : '<div class="mini">No registers submitted yet this season. Attendance appears here as coaches mark sessions.</div>'}</div></div>
    ${t.marked ? `<div class="mini">${t.present.toLocaleString()} of ${t.marked.toLocaleString()} marked places attended (late counts as present)</div>` : ''}</div>`;
}

// ---------- schedule ----------
const SPAN = 12;
function scheduleCard(s) {
  if (!s) return cardHead('Academy schedule') + '<div class="mini">This season has no term dates.</div>';
  const w0 = Math.min(Math.max(1, DASHF.week0 || s.currentWeek), Math.max(1, s.lastWeek - SPAN + 1));
  const w1 = Math.min(s.lastWeek, w0 + SPAN - 1), n = w1 - w0 + 1;
  const col = (x) => ({ a: Math.max(x.startWeek, w0) - w0 + 2, b: Math.min(x.endWeek, w1) - w0 + 3 });
  const vis = (x) => x.endWeek >= w0 && x.startWeek <= w1;
  const bar = (x, cls, label, row) => { const c = col(x);
    return `<div class="tbar ${cls}" style="grid-column:${c.a}/${c.b};grid-row:${row}" title="${esc(label)} · ${dt(x.startDate)}${x.endDate !== x.startDate ? ' – ' + dt(x.endDate) : ''}${x.location ? ' · ' + esc(shortLoc(x.location)) : ''}${x.notes ? ' · ' + esc(x.notes) : ''}"><span>${esc(label)}</span></div>`; };
  const weeks = s.weeks.slice(w0 - 1, w1);
  const events = s.events.filter(vis), bookings = s.bookings.filter(vis), hols = s.holidays.filter(vis);
  const tools = `<span class="tnav"><button class="lnk" data-act="dWeeks" data-a1="-${SPAN}" ${w0 <= 1 ? 'disabled' : ''} aria-label="Earlier weeks">‹</button><button class="lnk" data-act="dWeeks" data-a1="0">Now</button><button class="lnk" data-act="dWeeks" data-a1="${SPAN}" ${w1 >= s.lastWeek ? 'disabled' : ''} aria-label="Later weeks">›</button>${can('session.create') ? `<button class="lnk" data-act="dCalendar">+ Add</button>` : ''}</span>`;
  return `${cardHead('Academy schedule <span class="h4s">remaining weeks</span>', tools)}
    <div class="srem"><b>${s.remainingTrainingWeeks}</b> training weeks left this season${s.currentTerm ? ` · ${esc(s.currentTerm.name)} ends ${dt(s.currentTerm.endDate)}` : ''}</div>
    <div class="tgrid" style="grid-template-columns:86px repeat(${n},minmax(22px,1fr))">
      <div class="tl0" style="grid-row:1"></div>
      ${s.terms.filter(vis).map((t) => bar(t, 'term', t.name, 1)).join('')}
      <div class="tl0" style="grid-row:2">Week</div>
      ${weeks.map((w, i) => `<div class="twk ${w.n === s.currentWeek ? 'now' : ''} ${w.holiday ? 'off' : ''} ${!w.term ? 'gap' : ''}" style="grid-column:${i + 2};grid-row:2" title="Week ${w.n}: ${dt(w.start)} – ${dt(w.end)}${w.holiday ? ' · ' + esc(w.holiday) : ''}">${w.n}</div>`).join('')}
      <div class="tl0" style="grid-row:3">Pitch bookings</div>
      ${weeks.map((w, i) => `<div class="tcell ${w.n === s.currentWeek ? 'now' : ''}" style="grid-column:${i + 2};grid-row:3"></div>`).join('')}
      ${bookings.map((b) => bar(b, 'book', b.location ? shortLoc(b.location) : b.title, 3)).join('')}
      <div class="tl0" style="grid-row:4">Matches / events</div>
      ${weeks.map((w, i) => `<div class="tcell ${w.n === s.currentWeek ? 'now' : ''}" style="grid-column:${i + 2};grid-row:4"></div>`).join('')}
      ${events.map((e) => bar(e, 'evt', e.title + (e.team ? ' · ' + e.team : ''), 4)).join('')}
      <div class="tl0" style="grid-row:5">Breaks</div>
      ${weeks.map((w, i) => `<div class="tcell ${w.n === s.currentWeek ? 'now' : ''}" style="grid-column:${i + 2};grid-row:5"></div>`).join('')}
      ${hols.map((h) => bar(h, 'hol', h.title, 5)).join('')}
    </div>
    ${!events.length ? `<div class="mini" style="margin-top:6px">No matches or tournaments in these weeks${can('session.create') ? ' — add them with + Add' : ''}.</div>` : ''}`;
}
ACT.dWeeks = (delta) => {
  const s = DASH.admin.schedule; delta = Number(delta);
  DASHF.week0 = delta === 0 ? s.currentWeek : Math.max(1, Math.min(s.lastWeek, (DASHF.week0 || s.currentWeek) + delta));
  $('d-sched').innerHTML = scheduleCard(s);
};

// ---------- revenue ----------
function revenueCard(f) {
  const r = f.revenue, byTerm = DASHF.revMode === 'term';
  const cols = byTerm ? r.terms : r.months;
  const keys = f.streams.map((s) => s.key);
  const tot = (c) => keys.reduce((s, k) => s + (c[k] || 0), 0) + (c.PENDING || 0);
  const max = niceMax(Math.max(0, ...cols.map(tot)));
  const W = 560, H = 250, L = 46, B = 26, T = 8, cw = (W - L - 6) / Math.max(1, cols.length), bw = Math.min(34, cw * 0.62);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  let bars = '';
  cols.forEach((c, i) => {
    let acc = 0; const x = L + i * cw + (cw - bw) / 2;
    for (const k of [...keys, 'PENDING']) {
      const v = c[k] || 0; if (v <= 0) continue;
      const y0 = y(acc), y1 = y(acc + v); acc += v;
      const label = k === 'PENDING' ? 'Pending (unpaid)' : f.streams.find((s) => s.key === k).label;
      bars += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" fill="${sc(k)}" class="${k === 'PENDING' ? 'pend' : ''}"><title>${esc(c.label)}${c.year ? ' ' + c.year : ''} · ${esc(label)}: ${money(v)}</title></rect>`;
    }
    const lbl = byTerm ? c.label : `${c.label} ${String(c.year).slice(2)}`;
    bars += `<text x="${(L + i * cw + cw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(lbl)}</text>`;
  });
  const legend = [...f.streams.map((s) => ({ k: s.key, l: s.label, v: s.amount })), { k: 'PENDING', l: 'Pending amount', v: r.pending }];
  return `${cardHead('Total revenue', `<select id="df-rev" class="dmini" aria-label="Group by">${opt('month', 'Monthly', !byTerm)}${opt('term', 'By term', byTerm)}</select>`)}
    <div class="revtop"><div><div class="bign">${aed0(r.total)}</div>
      <div class="mini">Collected <b>${aed0(r.collected)}</b> · pending <b>${aed0(r.pending)}</b> · ${byTerm ? 'by term' : 'by invoice month'}</div></div>
      <div class="legend">${legend.map((g) => `<span title="${money(g.v)}"><i style="background:${sc(g.k)}" class="${g.k === 'PENDING' ? 'pend' : ''}"></i>${esc(g.l)}</span>`).join('')}</div></div>
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Revenue ${byTerm ? 'by term' : 'by month'}, stacked by stream">
      <defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--s-pending)"/><line x1="0" y1="0" x2="0" y2="5" stroke="var(--surface)" stroke-width="1.6"/></pattern></defs>
      ${ticks.map((t) => `<line x1="${L}" x2="${W - 4}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="grid"/><text x="${L - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" class="ax">${aedShort(t)}</text>`).join('')}
      ${bars}
    </svg>
    ${r.total ? '' : '<div class="mini">No invoices issued this season yet.</div>'}`;
}

// ---------- kits ----------
function kitsCard(k) {
  const W = 300, H = 270, L = 30, B = 34, T = 14, n = k.types.length, cw = (W - L - 4) / n, bw = Math.min(38, cw * 0.6);
  const max = niceMax(Math.max(1, ...k.types.map((t) => t.units)));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((t) => Math.round(t * max));
  return `<div class="card dcard">${cardHead('Kits sales', `<span class="mini">${aed0(k.revenue)}</span>`)}
    <div class="mini" title="A Development kit counts as one training kit; an Advanced kit as a training kit and a home (match) kit.">${k.units} piece${k.units === 1 ? '' : 's'} sold this season</div>
    <svg viewBox="0 0 ${W} ${H}" class="chart kits" role="img" aria-label="Kit pieces sold by type">
      ${ticks.map((t) => `<line x1="${L}" x2="${W - 2}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="grid"/><text x="${L - 5}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" class="ax">${t}</text>`).join('')}
      ${k.types.map((t, i) => { const x = L + i * cw + (cw - bw) / 2, yy = y(t.units);
        return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - yy).toFixed(1)}" rx="3" class="kb"><title>${esc(t.label)}: ${t.units}</title></rect>
          <text x="${(x + bw / 2).toFixed(1)}" y="${(yy - 4).toFixed(1)}" text-anchor="middle" class="vl">${t.units}</text>
          <text x="${(L + i * cw + cw / 2).toFixed(1)}" y="${H - 18}" text-anchor="middle" class="ax">${esc(t.label.replace(' kit', ''))}</text>
          <text x="${(L + i * cw + cw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ax">${/kit/.test(t.label) ? 'kit' : ''}</text>`; }).join('')}
    </svg></div>`;
}

// ---------- payments ----------
function paymentsCard(p) {
  const segs = [
    { l: 'Fully paid', n: p.fullyPaid.count, v: p.fullyPaid.amount, c: 'var(--good)' },
    { l: 'Partially paid', n: p.partiallyPaid.count, v: p.partiallyPaid.amount, c: 'var(--warn)' },
    { l: 'Unpaid', n: p.unpaid.count, v: p.unpaid.amount, c: 'var(--bad)' },
  ];
  const total = segs.reduce((s, x) => s + x.n, 0), R = 40, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = total ? segs.filter((s) => s.n).map((s) => { const len = C * s.n / total;
    const el = `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${s.c}" stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 50 50)"><title>${s.l}: ${s.n} invoice${s.n === 1 ? '' : 's'} · ${money(s.v)}</title></circle>`;
    off += len; return el; }).join('') : `<circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="16"/>`;
  const ag = p.aging;
  return `<div class="card dcard dpay">${cardHead('Payment status & unpaid summary', `<button class="lnk" data-act="go" data-a1="invoices">Invoices →</button>`)}
    <div class="pdon"><svg viewBox="0 0 100 100" class="pd" role="img" aria-label="Invoices by payment status">${arcs}<text x="50" y="50" text-anchor="middle" class="pn">${total}</text><text x="50" y="63" text-anchor="middle" class="pl">invoices</text></svg>
      <div class="plg">${segs.map((s) => `<div class="pr"><i style="background:${s.c}"></i><span>${s.l}</span><b>${s.n}</b><em>${aed0(s.v)}</em></div>`).join('')}</div></div>
    <div class="ptiles">
      <div class="ptile"><div class="k">Unpaid players</div><div class="v">${p.unpaidPlayers}</div><div class="mini">${p.unpaidInvoices} unpaid invoice${p.unpaidInvoices === 1 ? '' : 's'}</div></div>
      <div class="ptile good" title="Credit put into family wallets this season: overpayments, refunds to wallet, sibling credits"><div class="k">Wallet credit given</div><div class="v">${aed0(p.walletCredited)}</div><div class="mini">${p.walletCreditedPct == null ? '—' : p.walletCreditedPct + '% of total revenue'}</div></div>
    </div>
    <div class="pbot">
      <div class="unp"><div class="k">Total unpaid</div><div class="v">${aed0(p.totalUnpaid)}</div><div class="pc"><span>of total revenue</span><b>${p.unpaidPctOfRevenue == null ? '—' : p.unpaidPctOfRevenue + '%'}</b></div></div>
      <div class="aging"><div class="ah">Overdue by</div>
        <div class="a1"><span>0–30 days</span><b>${aed0(ag.d0_30.amount)}</b></div>
        <div class="a2"><span>31–60 days</span><b>${aed0(ag.d31_60.amount)}</b></div>
        <div class="a3"><span>Over 60 days</span><b>${aed0(ag.d60plus.amount)}</b></div>
        <div class="a0"><span>Not yet due</span><b>${aed0(ag.notDue.amount)}</b></div>
      </div>
    </div></div>`;
}

function needsAttention(q) {
  const qi = (n, l, target) => `<div class="qitem ${n > 0 ? 'alert' : 'ok'}" data-act="go" data-a1="${target}"><span class="qn">${n}</span><span class="ql">${l}</span></div>`;
  return `<div class="sec"><h3>Needs attention <span class="cnt">click to act</span></h3><div class="queue">
    ${qi(q.overdueInvoices.count, 'Overdue invoices', 'invoices')}${qi(q.newLeads.count, 'New leads to contact', 'leads')}
    ${qi(q.waitlisted.count, 'Waitlisted players', 'players')}${qi(q.registersNotSubmitted.count, 'Registers not submitted', 'attendance')}
  </div></div>`;
}

// ---------- coach type & photo ----------
ACT.dCoaches = async () => {
  const list = await api('/coaches');
  openDrawer('Coaches — full-time or part-time', `<p class="mini" style="margin-top:0">This drives the Coaches card. A photo is optional; it is shrunk to a small avatar before it is saved.</p>
    ${list.map((c) => `<div class="lookup-hit"><div style="display:flex;gap:10px;align-items:center">${c.photoUrl ? `<img class="av" src="${esc(c.photoUrl)}" alt="">` : `<span class="av">${esc(initials(c.user?.fullName))}</span>`}<b>${esc(c.user?.fullName || 'Coach')}</b></div>
      <div style="display:flex;gap:6px;align-items:center"><select class="sel" style="width:auto" data-coach="${c.id}">${opt('', 'Not set', !c.employmentType)}${opt('FULL_TIME', 'Full-time', c.employmentType === 'FULL_TIME')}${opt('PART_TIME', 'Part-time', c.employmentType === 'PART_TIME')}</select>
      <label class="btn sm ghost" style="cursor:pointer">Photo<input type="file" accept="image/png,image/jpeg,image/webp" data-photo="${c.id}" hidden></label></div></div>`).join('')}
    <div class="row-end"><button class="btn" data-act="dCoachesDone">Done</button></div>`);
  document.querySelectorAll('[data-coach]').forEach((s) => s.addEventListener('change', async () => {
    try { await api('/coaches/' + s.dataset.coach, { method: 'PATCH', body: JSON.stringify({ employmentType: s.value || null }) }); toast('Saved'); }
    catch (e) { toast(e.message); }
  }));
  document.querySelectorAll('[data-photo]').forEach((inp) => inp.addEventListener('change', async () => {
    const file = inp.files[0]; if (!file) return;
    try {
      const url = await shrinkImage(file, 128);
      await api('/coaches/' + inp.dataset.photo, { method: 'PATCH', body: JSON.stringify({ photoUrl: url }) });
      toast('Photo saved'); ACT.dCoaches();
    } catch (e) { toast(e.message || 'Could not read that image'); }
  }));
};
ACT.dCoachesDone = () => { closeDrawer(); go('dashboard'); };
function shrinkImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image(), r = new FileReader();
    r.onload = () => { img.src = r.result; };
    r.onerror = reject;
    img.onload = () => {
      const c = document.createElement('canvas'), s = Math.min(img.width, img.height);
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    r.readAsDataURL(file);
  });
}

// ---------- calendar entries ----------
const EV_KIND = { PITCH_BOOKING: 'Pitch booking', MATCH: 'Match', TOURNAMENT: 'Tournament', EVENT: 'Event', CAMP: 'Camp', HOLIDAY: 'Break / holiday' };
ACT.dCalendar = async () => {
  const s = DASH.filters.season;
  const list = await api('/academy-events?seasonId=' + s.id);
  openDrawer('Academy calendar', `<div class="frm">
      <div><label class="lbl" for="ev-kind">Type</label><select class="sel" id="ev-kind">${Object.entries(EV_KIND).map(([k, v]) => opt(k, v, k === 'MATCH')).join('')}</select></div>
      <div><label class="lbl" for="ev-loc">Location</label><select class="sel" id="ev-loc">${opt('', 'Any / away')}${LK.locations.map((l) => opt(l.id, shortLoc(l.name), l.id === DASHF.locationId)).join('')}</select></div>
      <div class="full"><label class="lbl" for="ev-title">Title</label><input class="in" id="ev-title" placeholder="e.g. Abu Dhabi Cup — U12 HPC"></div>
      <div><label class="lbl" for="ev-from">From</label><input class="in" id="ev-from" type="date"></div>
      <div><label class="lbl" for="ev-to">To</label><input class="in" id="ev-to" type="date"></div>
      <div class="full"><label class="lbl" for="ev-notes">Notes</label><input class="in" id="ev-notes"></div></div>
    <div id="ev-err" style="margin-top:8px"></div>
    <div class="row-end"><button class="btn" data-act="dCalendarAdd">Add to calendar</button></div>
    <h4 style="margin:20px 0 8px">This season</h4>
    ${list.map((e) => `<div class="lookup-hit"><div><b>${esc(e.title)}</b> <span class="chip">${esc(EV_KIND[e.kind] || e.kind)}</span><div class="mini">${dt(e.startDate)}${e.endDate !== e.startDate ? ' – ' + dt(e.endDate) : ''}${e.location ? ' · ' + esc(shortLoc(e.location.name)) : ''}</div></div>
      ${can('session.delete') ? `<button class="btn sm ghost" data-act="dCalendarDel" data-a1="${e.id}">Remove</button>` : ''}</div>`).join('') || '<div class="mini">Nothing yet.</div>'}`);
};
ACT.dCalendarAdd = async () => {
  const body = { kind: $('ev-kind').value, title: $('ev-title').value.trim(), startDate: $('ev-from').value,
    endDate: $('ev-to').value || $('ev-from').value, seasonId: DASH.filters.season.id,
    locationId: $('ev-loc').value || undefined, notes: $('ev-notes').value.trim() || undefined };
  if (body.title.length < 2 || !body.startDate) { $('ev-err').innerHTML = '<div class="note bad">A title and a start date are needed.</div>'; return; }
  try { await api('/academy-events', { method: 'POST', body: JSON.stringify(body) }); toast('Added'); closeDrawer(); go('dashboard'); }
  catch (e) { $('ev-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};
ACT.dCalendarDel = async (id) => {
  try { await api('/academy-events/' + id, { method: 'DELETE' }); toast('Removed'); ACT.dCalendar(); go('dashboard'); }
  catch (e) { toast(e.message); }
};

// ================= term options, sessions a week, extras =================
// One picker used by "Register a child" and the player page's "Add term", so
// both price the same way: the six term options from the price list, the
// sessions-a-week tier, and optional kits / Man City League.
const PK_SHORT = { T1: 'Term 1', T2: 'Term 2', T3: 'Term 3', T1_2: 'Terms 1 & 2', T2_3: 'Terms 2 & 3', FULL: 'Full season' };
const newPurchase = () => ({ options: null, key: '', package: null, spw: null, productIds: [], startDate: '', startTouched: false, plan: { on: false, rows: [] } });
const TODAY = () => new Date().toISOString().slice(0, 10);
/** When a term option is chosen: a started option defaults the start date to today (prorated), unless the desk already typed one. */
function defaultStart(st) {
  const p = st.options?.packages?.find((x) => x.code === st.package);
  if (st.startTouched) { if (p && st.startDate && (st.startDate > (p.endDate || '9999'))) st.startDate = ''; return; }
  st.startDate = p && p.started && !p.finished ? TODAY() : '';
}

/** Load what can be bought for this child/team; keeps choices that still apply. */
async function loadPurchaseOptions(st, q) {
  const key = JSON.stringify(q);
  if (st.options && st.key === key) return st;
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
  st.options = await api('/registration/options?' + qs);
  st.key = key;
  const o = st.options;
  // No term option is picked for the desk: the package is always a deliberate choice.
  if (st.package && !o.packages.some((p) => p.code === st.package && !p.finished)) st.package = null;
  if (!st.spw || !o.tiers.some((t) => t.sessionsPerWeek === st.spw)) {
    st.spw = o.tiers.some((t) => t.sessionsPerWeek === o.defaultSessionsPerWeek) ? o.defaultSessionsPerWeek : (o.tiers[0]?.sessionsPerWeek ?? null);
  }
  st.productIds = st.productIds.filter((id) => o.products.some((p) => p.id === id));
  return st;
}

function purchasePicker(st, pre) {
  const o = st.options;
  if (!o) return '<div class="loading">Loading options…</div>';
  if (!o.usePriceList) return '<div class="note warn">No price list is set up for this season.</div>';
  const pk = o.packages.map((p) => `<button class="opt ${st.package === p.code ? 'on' : ''}" data-${pre}pk="${p.code}" ${p.finished ? 'disabled' : ''}>
      <span class="t">${esc(p.label)}</span><div class="d">${p.startDate ? `${dt(p.startDate)} – ${dt(p.endDate)}` : 'dates not set'}</div>
      <div class="d">${p.weeks ? p.weeks + ' weeks' : ''}${p.finished ? ' · finished' : p.started ? ' · under way' : ''}</div></button>`).join('');
  const tiers = o.tiers.map((t) => `<button class="opt ${st.spw === t.sessionsPerWeek ? 'on' : ''}" data-${pre}spw="${t.sessionsPerWeek}">
      <span class="t">${t.sessionsPerWeek} session${t.sessionsPerWeek === 1 ? '' : 's'} a week</span>
      <div class="d">${t.hoursPerSession ? (t.hoursPerSession === 1 ? '1 hour' : '1½ hours') + ' each' : ''}${t.sessionsPerWeek === o.defaultSessionsPerWeek ? ' · the team’s schedule' : ''}</div></button>`).join('')
    || '<div class="note warn">The price list has no price for this category.</div>';
  const prods = o.products.map((p) => `<label class="chk xtra"><input type="checkbox" data-${pre}prod="${p.id}" ${st.productIds.includes(p.id) ? 'checked' : ''}>
      <span><b>${esc(p.name)}</b>${p.description ? ` <span class="mini">— ${esc(p.description)}</span>` : ''}</span><span class="xp">${money(p.priceInclVat)}</span></label>`).join('');
  return `<span class="lbl">Term option${st.package ? '' : ' <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--coral)">— choose one</span>'}</span><div class="opts c3">${pk}</div>
    <span class="lbl" style="margin-top:14px">Sessions a week</span><div class="opts c3">${tiers}</div>
    ${st.spw && st.spw !== o.defaultSessionsPerWeek ? `<div class="note warn" style="margin-top:8px">The team trains ${o.defaultSessionsPerWeek} times a week; this family is paying for ${st.spw}.</div>` : ''}
    ${st.package ? startDateField(st, pre) : ''}
    ${prods ? `<span class="lbl" style="margin-top:14px">Optional extras <span style="text-transform:none;letter-spacing:0;font-weight:400">(prices include VAT)</span></span><div class="xtras">${prods}</div>` : ''}`;
}

function startDateField(st, pre) {
  const p = st.options?.packages?.find((x) => x.code === st.package) || {};
  return `<span class="lbl" style="margin-top:14px">Start date</span>
    <div class="sdrow"><input class="in" type="date" id="${pre}-start" value="${esc(st.startDate || '')}" ${p.startDate ? `min="${p.startDate}"` : ''} ${p.endDate ? `max="${p.endDate}"` : ''}>
      <span class="mini">${st.startDate && p.startDate && st.startDate > p.startDate ? 'Training fee prorated by the sessions left from this date.' : `From the first day${p.startDate ? ' (' + dt(p.startDate) + ')' : ''} = full price.`}
      ${st.startDate ? ` <a class="lnk2" data-act="startClear" data-a1="${pre}">Charge from the first day</a>` : ''}</span></div>`;
}
const pickerState = (pre) => (pre === 'at' ? ATP : pre === 'rg' ? REG.purchase : null);
ACT.startClear = (pre) => {
  const st = pickerState(pre); if (!st) return;
  st.startDate = ''; st.startTouched = true;
  const i = $(pre + '-start'); if (i) { i.value = ''; i.dispatchEvent(new Event('change')); }
};

function wirePurchasePicker(st, pre, root, onChange) {
  root.querySelectorAll(`[data-${pre}pk]`).forEach((b) => b.addEventListener('click', () => { st.package = b.dataset[pre + 'pk']; defaultStart(st); onChange(true); }));
  const sd = root.querySelector(`#${pre}-start`);
  if (sd) sd.addEventListener('change', () => { st.startDate = sd.value || ''; st.startTouched = true; onChange(true); });
  root.querySelectorAll(`[data-${pre}spw]`).forEach((b) => b.addEventListener('click', () => { st.spw = Number(b.dataset[pre + 'spw']); onChange(true); }));
  root.querySelectorAll(`[data-${pre}prod]`).forEach((c) => c.addEventListener('change', () => {
    const id = c.dataset[pre + 'prod'];
    st.productIds = c.checked ? [...new Set([...st.productIds, id])] : st.productIds.filter((x) => x !== id);
    onChange(false);
  }));
}

function purchaseQuery(st) {
  const qs = new URLSearchParams();
  if (st.package) qs.set('package', st.package);
  if (st.spw) qs.set('sessionsPerWeek', st.spw);
  if (st.productIds.length) qs.set('productIds', st.productIds.join(','));
  if (st.manual?.percent) qs.set('manualPercent', st.manual.percent);
  else if (st.manual?.preset) qs.set('manualPreset', st.manual.preset);
  if (st.startDate) qs.set('startDate', st.startDate);
  return qs;
}

// ================= players: directory =================
const PAY_OPTS = [
  ['', 'Any payment status'], ['PAID', 'Paid'], ['PART_PAID', 'Part paid'], ['UNPAID', 'Unpaid'],
  ['OVERDUE', 'Overdue'], ['NOT_SENT', 'Invoice not sent'], ['NO_INVOICE', 'No invoice'],
  ['REFUNDED', 'Refunded'], ['WRITTEN_OFF', 'Written off'],
];
const PF_KEYS = ['search', 'playerRef', 'guardianRef', 'registeredFrom', 'registeredTo',
  'locationId', 'ageGroupId', 'seasonId', 'termId', 'teamId', 'coachId', 'paymentStatus'];
let PF = { page: 1 };   // kept across visits, so "back to players" returns to the same search

VIEWS.players = async () => {
  await loadLookups();
  if (can('player.create')) $('page-acts').innerHTML = `<button class="btn sm" data-act="go" data-a1="register">+ Register a child</button>`;
  const f = (k, label, ph, type) => `<div><label class="lbl" for="f-${k}">${label}</label><input class="in" id="f-${k}"${type ? ` type="${type}"` : ''} placeholder="${ph || ''}"></div>`;
  const s = (k, label) => `<div><label class="lbl" for="f-${k}">${label}</label><select class="sel" id="f-${k}"></select></div>`;
  $('view').innerHTML = `
    <div class="card filters">
      <div class="fgrid">
        <div class="w2"><label class="lbl" for="f-search">Name or phone</label><input class="in" id="f-search" placeholder="Child or parent name, or 050 123 4567"></div>
        ${f('playerRef', 'Player No', 'PL-')}${f('guardianRef', 'Parent No', 'PR-')}
        ${f('registeredFrom', 'Registered from', '', 'date')}${f('registeredTo', 'Registered to', '', 'date')}
        ${s('locationId', 'Location')}${s('ageGroupId', 'Age group')}${s('seasonId', 'Season')}
        ${s('termId', 'Term')}${s('teamId', 'Team')}${s('coachId', 'Coach')}
      </div>
      <div class="fbar">
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          <div style="width:210px;${can('invoice.view') ? '' : 'display:none'}"><select class="sel" id="f-paymentStatus" aria-label="Payment status"></select></div>
          <label class="chk"><input type="checkbox" id="f-includeArchived"> Include archived</label>
          <span class="fcount" id="f-count"></span>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn sm ghost" data-act="clearPlayerFilters">Clear</button>
          <button class="btn sm" data-act="runPlayerSearch">Search</button>
        </div>
      </div>
    </div>
    <div class="card" id="p-res"><div class="loading">Loading…</div></div>`;

  fillPlayerSelects();
  for (const k of ['search', 'playerRef', 'guardianRef', 'registeredFrom', 'registeredTo']) $('f-' + k).value = PF[k] || '';
  $('f-includeArchived').checked = !!PF.includeArchived;

  // Typing searches on Enter; choosing from a list searches straight away.
  for (const id of ['f-search', 'f-playerRef', 'f-guardianRef']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') ACT.runPlayerSearch(); });
  }
  for (const id of ['f-registeredFrom', 'f-registeredTo', 'f-termId', 'f-teamId', 'f-coachId', 'f-paymentStatus', 'f-includeArchived']) {
    $(id).addEventListener('change', () => ACT.runPlayerSearch());
  }
  // These narrow other lists (season → terms, age group/location → teams).
  for (const id of ['f-seasonId', 'f-ageGroupId', 'f-locationId']) {
    $(id).addEventListener('change', () => { readPlayerFilters(); fillPlayerSelects(); ACT.runPlayerSearch(); });
  }
  await loadPlayers();
};

function readPlayerFilters() {
  for (const k of PF_KEYS) { const el = $('f-' + k); if (el) PF[k] = el.value.trim() || undefined; }
  PF.includeArchived = $('f-includeArchived').checked || undefined;
}

function fillPlayerSelects() {
  $('f-locationId').innerHTML = opt('', 'All locations') + LK.locations.map((l) => opt(l.id, shortLoc(l.name), PF.locationId === l.id)).join('');
  $('f-ageGroupId').innerHTML = opt('', 'All age groups') + LK.ageGroups.map((a) => opt(a.id, a.code, PF.ageGroupId === a.id)).join('');
  $('f-seasonId').innerHTML = opt('', 'All seasons') + LK.seasons.map((s) => opt(s.id, s.name + (s.isActive ? ' (current)' : ''), PF.seasonId === s.id)).join('');
  const terms = LK.terms.filter((t) => !PF.seasonId || t.seasonId === PF.seasonId);
  if (PF.termId && !terms.some((t) => t.id === PF.termId)) PF.termId = undefined;
  $('f-termId').innerHTML = opt('', 'All terms') + terms.map((t) => opt(t.id, t.name, PF.termId === t.id)).join('');
  const ag = LK.ageGroups.find((a) => a.id === PF.ageGroupId);
  const loc = LK.locations.find((l) => l.id === PF.locationId);
  const teams = LK.teams.filter((t) => (!ag || (t.ageCodes || []).includes(ag.code)) && (!loc || t.location === loc.name));
  if (PF.teamId && !teams.some((t) => t.id === PF.teamId)) PF.teamId = undefined;
  $('f-teamId').innerHTML = opt('', 'All teams') + teams.map((t) => opt(t.id, t.name, PF.teamId === t.id)).join('');
  $('f-coachId').innerHTML = opt('', 'All coaches') + LK.coaches.map((c) => opt(c.id, c.name, PF.coachId === c.id)).join('');
  $('f-paymentStatus').innerHTML = PAY_OPTS.map(([v, t]) => opt(v, t, (PF.paymentStatus || '') === v)).join('');
}

ACT.runPlayerSearch = () => { readPlayerFilters(); PF.page = 1; loadPlayers(); };
ACT.clearPlayerFilters = () => { PF = { page: 1 }; VIEWS.players(); };
ACT.playerPage = (n) => { PF.page = Math.max(1, Number(n) || 1); loadPlayers(); };

async function loadPlayers() {
  const qs = new URLSearchParams({ limit: '50', page: String(PF.page || 1) });
  let active = 0;
  for (const k of PF_KEYS) if (PF[k]) { qs.set(k, PF[k]); active++; }
  if (PF.includeArchived) { qs.set('includeArchived', 'true'); active++; }
  $('f-count').innerHTML = active ? `<b>${active}</b> filter${active > 1 ? 's' : ''} applied` : 'No filters applied';
  $('p-res').innerHTML = '<div class="loading">Searching…</div>';
  try {
    const d = await api('/players?' + qs);
    if (!d.data.length) {
      $('p-res').innerHTML = `<div class="empty">No children match${active ? ' these filters' : ' yet'}.${can('player.create') ? ' <a data-act="go" data-a1="register">Register a child</a>' : ''}</div>`;
      return;
    }
    const from = (d.meta.page - 1) * d.meta.limit + 1, to = from + d.data.length - 1;
    $('p-res').innerHTML = `<div class="tblwrap"><table class="dir"><thead><tr>
        <th>Parent email</th><th>Parent mobile</th><th>Player No</th><th>Parent No</th><th>Player name</th>
        <th>DOB</th><th>Gender</th><th>Category</th><th>Location</th>${can('invoice.view') ? '<th>Payment</th>' : ''}<th>Team</th>
        <th>Coach</th><th>Term</th><th>Days</th><th>Comments</th></tr></thead>
      <tbody>${d.data.map((r) => `<tr class="clickable" data-act="openPlayer" data-a1="${r.id}">
        <td class="em" title="${esc(r.guardianEmail)}">${esc(r.guardianEmail)}</td><td class="mono">${esc(fmtPhone(r.guardianMobile))}</td>
        <td class="ref">${esc(r.reference)}</td><td class="ref">${esc(r.guardianReference)}</td>
        <td><b>${esc(r.name)}</b>${r.archived ? ' <span class="pill p-mute">archived</span>' : ''}</td>
        <td>${dt(r.dateOfBirth)}</td><td>${r.gender === 'FEMALE' ? 'Female' : 'Male'}</td>
        <td><span class="chip">${esc(r.category || '—')}</span></td>
        <td>${esc(shortLoc(r.location))}</td>${can('invoice.view') ? `<td>${payPill(r.payment)}</td>` : ''}
        <td>${esc(r.team?.name || '—')}</td><td>${esc(r.coach?.name || '—')}</td>
        <td>${esc(r.term?.name || '—')}</td><td>${esc(r.days)}</td>
        <td class="cm">${r.latestComment ? esc(trunc(r.latestComment.body, 90)) + (r.commentCount > 1 ? ` <span class="ref">+${r.commentCount - 1} more</span>` : '') : '—'}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="pager"><span>Showing ${from}–${to} of ${d.meta.total} <span class="scrollhint" id="p-hint"></span></span><span style="display:flex;gap:6px">
        <button class="btn sm ghost" data-act="playerPage" data-a1="${d.meta.page - 1}" ${d.meta.page <= 1 ? 'disabled' : ''}>← Previous</button>
        <button class="btn sm ghost" data-act="playerPage" data-a1="${d.meta.page + 1}" ${d.meta.page >= d.meta.totalPages ? 'disabled' : ''}>Next →</button>
      </span></div>`;
    const wrap = $('p-res').querySelector('.tblwrap');
    if (wrap && wrap.scrollWidth > wrap.clientWidth + 4) $('p-hint').textContent = ' · scroll sideways for more columns →';
  } catch (e) { $('p-res').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// ================= players: the player page =================
let PLAYER = null, PASSPORT = null;

window.openPlayer = async (id) => {
  closeDrawer();
  CURRENT = 'players';
  $('nav').querySelectorAll('a.nav').forEach((a) => a.classList.toggle('on', a.dataset.k === 'players'));
  $('page-title').textContent = 'Player';
  $('page-acts').innerHTML = `<button class="btn sm ghost" data-act="go" data-a1="players">← All players</button>`;
  $('view').innerHTML = '<div class="loading">Loading…</div>';
  try {
    await loadLookups();
    let reports;
    [PLAYER, PASSPORT, reports] = await Promise.all([
      api(`/players/${id}/profile`),
      api(`/players/${id}/passport`).catch(() => null),   // development & attendance; optional by role
      can('evaluation.view') ? api(`/players/${id}/reports`).catch(() => []) : Promise.resolve([]),
    ]);
    PLAYER.reports = reports;
    renderPlayer();
  } catch (e) { $('view').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
};
// Older screens (rosters, dashboard, attendance) open players through this name.
window.showPlayer = (id) => window.openPlayer(id);
ACT.openPlayer = (id) => window.openPlayer(id);

async function reloadPlayer() {
  if (!PLAYER) return;
  const id = PLAYER.player.id;
  let reports;
  [PLAYER, PASSPORT, reports] = await Promise.all([
    api(`/players/${id}/profile`), api(`/players/${id}/passport`).catch(() => null),
    can('evaluation.view') ? api(`/players/${id}/reports`).catch(() => []) : Promise.resolve([]),
  ]);
  PLAYER.reports = reports;
  if (CURRENT === 'players' && $('page-title').textContent === 'Player') renderPlayer();
}

function renderPlayer() {
  const d = PLAYER, p = d.player, g = d.guardian, t = d.team;
  const archived = !!p.archivedAt;
  const act = (key, icon, title, sub, cls) =>
    `<button class="${cls || ''}" data-act="${key}"><span class="ic">${icon}</span><span>${esc(title)}<span class="sub">${sub}</span></span></button>`;

  // In the order the desk asked for.
  const actions = [];
  if (can('player.edit')) actions.push(act('pEdit', '✎', 'Edit user', 'Child and parent details'));
  if (can('registration.create') && can('invoice.create')) {
    actions.push(act('pAddTerm', '+', 'Add term and generate invoice', d.currentTerm ? `Current: ${esc(d.currentTerm.name)}` : 'Not enrolled yet'));
  }
  if (can('invoice.create')) actions.push(act('pItems', '◆', 'User term — add items', 'Kits, league or another charge'));
  if (can('wallet.view')) actions.push(act('pWallet', '◈', 'Wallet', money(g.wallet.balance)));
  if (can('guardian.manage')) actions.push(act('pSendLogin', '✉', 'Send sign-in details', `Parent portal · ${esc(g.email)}`));
  if (can('guardian.manage')) actions.push(act('pAccount', '⇄', 'Account switch', `View as ${esc(g.fullName)}`));
  if (can('player.delete')) actions.push(act('pDelete', '✕', 'Delete user', archived ? 'Archived — restore or remove' : 'Archive — history is kept', 'dang'));
  actions.push(act('pCoach', '◎', 'Assigned coach', t?.coach ? esc(t.coach.name) : (t ? 'No coach on this team yet' : 'Not on a team')));

  const kv = (rows) => `<dl>${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const at = PASSPORT?.attendance, dv = PASSPORT?.development, docs = PASSPORT?.documents;

  $('view').innerHTML = `
  <div class="pp">
    <div class="pside">
      <div class="card idc">
        <div class="nm">${esc(p.name)}</div>
        <div class="ref" style="margin-top:3px">${esc(p.reference)} · parent ${esc(g.reference)}</div>
        <div class="meta"><span class="chip">${esc(d.category.code || '—')}</span>${lvlBadge(p.level)}${d.payment ? payPill(d.payment) : ''}${archived ? '<span class="pill p-mute">archived</span>' : ''}</div>
      </div>
      <div class="card acts-list">${actions.join('')}</div>
      <div class="card cmts">
        <h4>Admin comments <span class="ref">${d.comments.length}</span></h4>
        ${can('player.edit') ? `<textarea class="in" id="cm-body" placeholder="Note what happened — e.g. parent asked to move to Mon/Wed/Fri"></textarea>
          <div class="row-end" style="margin-top:8px"><button class="btn sm" data-act="pComment">Add comment</button></div>` : ''}
        ${d.comments.map((c) => `<div class="cmt"><div class="who">${esc(c.author)} · ${dtm(c.at)}</div>${esc(c.body)}</div>`).join('') || '<div class="mini">No comments yet.</div>'}
      </div>
    </div>

    <div class="pmain">
      ${archived ? `<div class="note warn">Archived ${dt(p.archivedAt)}${p.archiveReason ? ' — ' + esc(p.archiveReason) : ''}. ${can('player.delete') ? '<a data-act="pRestore">Restore</a>' : ''}</div>` : ''}
      <div class="facts">
        <div class="card fact"><h4>Placement</h4>
          <div class="big">${t ? esc(t.name) : 'Not on a team'}</div>
          <div class="mini">${t ? esc(t.levelExplainer) : 'Add a term to place them on a team'}</div>
          ${kv([['Category', `<span class="chip">${esc(d.category.code || '—')}</span> <span class="mini">${esc(d.category.note)}</span>`],
                ['Days', t ? esc(t.schedule) : '—'], ['Location', esc(shortLoc(t?.location))],
                ['Coach', esc(t?.coach?.name || '—')],
                ['Term', d.currentTerm ? `<b>${esc(d.currentTerm.name)}</b> <span class="mini">${esc(d.currentTerm.season || '')}</span>${d.currentTerm.terms && d.currentTerm.terms !== d.currentTerm.name ? `<div class="mini">${esc(d.currentTerm.terms)}${d.currentTerm.inProgress ? ' · now: ' + esc(d.currentTerm.inProgress) : ''}</div>` : ''}` : '—']])}
        </div>
        <div class="card fact"><h4>Child</h4>
          <div class="big">${esc(p.name)}</div><div class="mini">${esc(p.reference)}</div>
          ${kv([['Born', dt(p.dateOfBirth)], ['Gender', p.gender === 'FEMALE' ? 'Female' : 'Male'],
                p.kitSize && ['Kit size', esc(p.kitSize)], p.previousAcademy && ['Previous', esc(p.previousAcademy)],
                ['Emergency', p.emergencyContactName ? esc(p.emergencyContactName) + (p.emergencyContactPhone ? ` · <span class="mono">${esc(fmtPhone(p.emergencyContactPhone))}</span>` : '') : '<span class="mini">not recorded</span>'],
                p.medicalNotes && ['Medical', `<span style="color:var(--warn)">${esc(p.medicalNotes)}</span>`],
                ['Registered', dt(p.registeredAt)]])}
        </div>
        <div class="card fact"><h4>Parent</h4>
          <div class="big">${esc(g.fullName)}</div><div class="mini">${esc(g.relationship || 'Parent')} · ${esc(g.reference)}</div>
          ${kv([['Email', esc(g.email)], g.secondaryEmail && ['Also', esc(g.secondaryEmail) + (g.secondaryEmailName ? ` <span class="mini">${esc(g.secondaryEmailName)}</span>` : '')],
                ['Mobile', `<span class="mono">${esc(fmtPhone(g.mobile))}</span>`],
                ['Area', esc([...new Set([g.city, g.emirate].filter(Boolean))].join(', ') || '—')], g.wallet && ['Wallet', money(g.wallet.balance)]])}
        </div>
        ${d.moneyHidden ? '' : `<div class="card fact"><h4>Billing</h4>
          <div class="big">${payPill(d.payment)}</div>
          ${kv([['Invoice', d.payment.invoiceNumber ? `<a data-act="showInvoice" data-a1="${d.invoices[0].id}">${esc(d.payment.invoiceNumber)}</a>` : '—'],
                ['Balance', d.payment.balance != null ? money(d.payment.balance) : '—'],
                ['Sibling', d.siblingDiscount ? `${esc(d.siblingDiscount.position)} child — ${d.siblingDiscount.percent ? d.siblingDiscount.percent + '% off' : 'full price'}` : '—'],
                (d.siblingCredits || []).length && ['Credited', d.siblingCredits.map((c) => `${money(c.total)} <span class="mini">· re-ranked to ${c.percentAfter}% ${dt(c.at)}</span>`).join('<br>')]])}
        </div>`}
      </div>

      ${d.siblings.length ? `<div class="card"><div class="sec" style="margin:0;padding:14px 16px 4px"><h3>Siblings <span class="cnt">${d.siblings.length}</span></h3></div>
        <div class="tblwrap"><table><tbody>${d.siblings.map((s) => `<tr class="clickable" data-act="openPlayer" data-a1="${s.id}">
          <td class="ref">${esc(s.reference)}</td><td><b>${esc(s.name)}</b>${s.archived ? ' <span class="pill p-mute">archived</span>' : ''}</td>
          <td><span class="chip">${esc(s.category || '—')}</span></td><td>${esc(s.team || '—')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}

      ${d.moneyHidden ? '' : `<div class="card"><div class="sec" style="margin:0;padding:14px 16px 4px"><h3>Invoices <span class="cnt">${d.invoices.length}</span></h3></div>
        ${d.invoices.length ? `<div class="tblwrap"><table><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr></thead>
        <tbody>${d.invoices.map((i) => `<tr class="clickable" data-act="showInvoice" data-a1="${i.id}">
          <td class="ref">${esc(i.number)}</td><td>${dt(i.issueDate)}</td><td>${dt(i.dueDate)}</td>
          <td class="num">${money(i.total)}</td><td class="num">${money(i.paid)}</td><td class="num"><b>${money(i.balance)}</b></td>
          <td>${payPill(i.payment)}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No invoices yet.</div>'}
      </div>`}

      <div class="split">
        <div class="card" style="padding:14px 16px"><h3 style="font-size:14px;margin-bottom:10px">Terms and teams</h3>
          <div class="tl">${(d.purchases || []).map((pu) => `<div class="ev"><b>${esc(pu.label)} · ${esc(pu.team || 'no team')}</b>
            ${pu.terms.length > 1 ? `<div class="mini" style="margin:2px 0">${pu.terms.map((t) => `${esc(t.name)}${t.status !== pu.status ? ' ' + statusPill(t.status) : ''}`).join(' · ')}</div>` : ''}
            <span>${esc(pu.season || '')}${pu.sessionsPerWeek ? ` · ${pu.sessionsPerWeek} session${pu.sessionsPerWeek === 1 ? '' : 's'} a week` : ''} — ${statusPill(pu.status)} ${dt(pu.enrolledAt)}</span></div>`).join('') || '<div class="mini">Not enrolled in any term yet.</div>'}</div>
        </div>
        <div class="card" style="padding:14px 16px"><h3 style="font-size:14px;margin-bottom:10px">Attendance and development</h3>
          ${at ? `<div class="score"><span class="lb">attendance</span><span class="sb"><i style="width:${at.rate || 0}%;background:${(at.rate || 0) >= 80 ? 'var(--good)' : 'var(--warn)'}"></i></span><span class="sv">${at.rate ?? '—'}%</span></div>
            <div class="mini" style="margin-bottom:10px">${at.present} present of ${at.sessions} sessions</div>` : ''}
          ${(PLAYER.reports || []).length ? `<div class="mini" style="margin:6px 0 4px;font-weight:700;color:var(--ink)">Term reports</div>${PLAYER.reports.map((r) => `<div class="kidrow"><div><a class="lnk2" data-act="rpOpen" data-a1="${r.id}">${esc(r.term || '')} · ${esc(RTYPE_WORD[r.reportType])}</a>
              <div class="mini">${[r.coach ? esc(r.coach) : '', r.overall != null ? `overall ${r.overall.toFixed(1)}` : ''].filter(Boolean).join(' · ')}</div></div>${rstatePill(r.sentAt ? 'SENT' : r.status)}</div>`).join('')}`
            : dv && Object.keys(dv.averages || {}).length ? Object.entries(dv.averages).map(([k, v]) => `<div class="score"><span class="lb">${esc(k)}</span><span class="sb"><i style="width:${v / 5 * 100}%"></i></span><span class="sv">${v}</span></div>`).join('') : '<div class="mini">No term reports yet — coaches write them in Player development.</div>'}
          ${docs?.missing?.length ? `<div class="mini" style="color:var(--warn);margin-top:10px">Missing documents: ${docs.missing.map((x) => esc(humanDoc(x))).join(', ')}</div>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

// ---- comments ----
ACT.pComment = async () => {
  const body = $('cm-body').value.trim();
  if (body.length < 2) return toast('Write a comment first');
  try { await api(`/players/${PLAYER.player.id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }); toast('Comment added'); await reloadPlayer(); }
  catch (e) { toast(e.message); }
};

// ---- edit user ----
const fld = (label, id, value, attrs, full) =>
  `<div class="${full ? 'full' : ''}"><label class="lbl" for="${id}">${label}</label><input class="in" id="${id}" value="${esc(value ?? '')}" ${attrs || ''}></div>`;
const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
const RELATIONS = ['Father', 'Mother', 'Guardian', 'Other'];

ACT.pEdit = () => {
  const d = PLAYER, p = d.player, g = d.guardian;
  openDrawer('Edit user', `
    <h3 style="font-size:13px;margin-bottom:10px">Child</h3>
    <div class="frm">
      ${fld('First name', 'e-first', p.firstName)}${fld('Last name', 'e-last', p.lastName)}
      ${fld('Date of birth', 'e-dob', p.dateOfBirth, 'type="date"')}
      <div><label class="lbl" for="e-gender">Gender</label><select class="sel" id="e-gender">${opt('MALE', 'Male', p.gender === 'MALE')}${opt('FEMALE', 'Female', p.gender === 'FEMALE')}</select></div>
      <div class="full"><label class="lbl" for="e-cat">Category</label>
        <select class="sel" id="e-cat">${opt('', `Automatic — from date of birth (${d.category.fromDob || 'none'})`, !d.category.isOverride)}${LK.ageGroups.map((a) => opt(a.id, a.code + ' — set manually', d.category.isOverride && d.category.ageGroupId === a.id)).join('')}</select>
        <div class="hint">Leave on automatic unless the child is deliberately playing in another group.</div></div>
      ${fld('Kit size', 'e-kit', p.kitSize)}${fld('Previous academy', 'e-prev', p.previousAcademy)}
      ${fld('Emergency contact', 'e-ecn', p.emergencyContactName)}${fld('Emergency phone', 'e-ecp', p.emergencyContactPhone)}
      <div class="full"><label class="lbl" for="e-med">Medical notes</label><textarea class="in" id="e-med">${esc(p.medicalNotes || '')}</textarea></div>
    </div>
    <h3 style="font-size:13px;margin:20px 0 10px">Parent <span class="ref">${esc(g.reference)}</span></h3>
    <div class="frm">
      ${fld('Full name', 'e-gname', g.fullName, '', true)}
      <div><label class="lbl" for="e-grel">Relationship</label><select class="sel" id="e-grel">${RELATIONS.map((r) => opt(r, r, (g.relationship || 'Father') === r)).join('')}</select></div>
      ${fld('Mobile', 'e-gmob', g.mobile, 'type="tel"')}
      ${fld('Email', 'e-gmail', g.email, 'type="email"', true)}
      ${fld('Second email', 'e-gmail2', g.secondaryEmail, 'type="email"', true)}
      <div><label class="lbl" for="e-gemi">Emirate</label><select class="sel" id="e-gemi">${opt('', '—')}${EMIRATES.map((x) => opt(x, x, g.emirate === x)).join('')}</select></div>
      ${fld('City / area', 'e-gcity', g.city)}
    </div>
    <div id="e-err" style="margin-top:12px"></div>
    <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" data-act="pEditSave">Save changes</button></div>`);
};

ACT.pEditSave = async () => {
  const d = PLAYER, p = d.player, g = d.guardian;
  const v = (id) => $(id).value.trim();
  const err = (m) => { $('e-err').innerHTML = `<div class="note bad">${esc(m)}</div>`; };
  if (!v('e-first') || !v('e-last')) return err('First and last name are required.');
  if (!v('e-dob')) return err('Date of birth is required.');
  if (!v('e-gname') || !v('e-gmob')) return err('Parent name and mobile are required.');
  if (!/^\S+@\S+\.\S+$/.test(v('e-gmail'))) return err('Enter a valid parent email.');

  // Send only what changed; an emptied optional field is cleared.
  const pp = {}, gp = {};
  const set = (obj, key, val, old, optional) => { if ((val || '') !== (old || '')) obj[key] = optional && val === '' ? null : val; };
  set(pp, 'firstName', v('e-first'), p.firstName); set(pp, 'lastName', v('e-last'), p.lastName);
  set(pp, 'dateOfBirth', v('e-dob'), p.dateOfBirth); set(pp, 'gender', v('e-gender'), p.gender);
  set(pp, 'kitSize', v('e-kit'), p.kitSize, true); set(pp, 'previousAcademy', v('e-prev'), p.previousAcademy, true);
  set(pp, 'emergencyContactName', v('e-ecn'), p.emergencyContactName, true);
  set(pp, 'emergencyContactPhone', v('e-ecp'), p.emergencyContactPhone, true);
  set(pp, 'medicalNotes', v('e-med'), p.medicalNotes, true);
  const cat = v('e-cat');
  if (cat && (!d.category.isOverride || cat !== d.category.ageGroupId)) pp.ageGroupId = cat;
  if (!cat && d.category.isOverride) pp.ageGroupId = null;
  set(gp, 'fullName', v('e-gname'), g.fullName); set(gp, 'relationship', v('e-grel'), g.relationship);
  set(gp, 'mobile', v('e-gmob'), g.mobile); set(gp, 'email', v('e-gmail'), g.email);
  set(gp, 'secondaryEmail', v('e-gmail2'), g.secondaryEmail, true);
  set(gp, 'emirate', v('e-gemi'), g.emirate, true); set(gp, 'city', v('e-gcity'), g.city, true);

  if (!Object.keys(pp).length && !Object.keys(gp).length) { closeDrawer(); return toast('Nothing changed'); }
  try {
    if (Object.keys(pp).length) await api(`/players/${p.id}`, { method: 'PATCH', body: JSON.stringify(pp) });
    if (Object.keys(gp).length) await api(`/guardians/${g.id}`, { method: 'PATCH', body: JSON.stringify(gp) });
    closeDrawer(); toast('Saved'); await reloadPlayer();
  } catch (e) { err(e.message); }
};

// ---- add term + invoice ----
let ATP = null;   // purchase state for the add-term drawer
ACT.pAddTerm = async () => {
  const d = PLAYER;
  if (d.player.archivedAt) return toast('Restore this child before adding a term');
  ATP = newPurchase();
  openDrawer('Add term and generate invoice', `
    <div class="frm">
      <div class="full"><label class="lbl" for="at-team">Team</label><select class="sel" id="at-team"></select>
        <label class="chk" style="margin-top:7px"><input type="checkbox" id="at-all"> Show teams outside ${esc(d.category.code || 'their category')} (playing up or down)</label></div>
    </div>
    <div id="at-pick" style="margin-top:14px"></div>
    <div id="at-quote" style="margin-top:14px"></div>
    <div id="at-manbox">${manualDiscountBlock('at', ATP)}</div>
    <div id="at-planbox">${planBox('at')}</div>
    <label class="chk" style="margin-top:12px"><input type="checkbox" id="at-issue" checked> Issue the invoice now <span class="mini">(untick to keep it as a draft)</span></label>
    <div id="at-err" style="margin-top:10px"></div>
    <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" id="at-go" data-act="pAddTermGo">Enrol and invoice</button></div>`);
  fillAddTermTeams();
  $('at-team').addEventListener('change', addTermPick);
  $('at-all').addEventListener('change', () => { fillAddTermTeams(); addTermPick(); });
  await addTermPick();
};

async function addTermPick() {
  const box = $('at-pick'); if (!box) return;
  const teamId = $('at-team').value;
  const team = LK.teams.find((t) => t.id === teamId);
  try {
    await loadPurchaseOptions(ATP, { ageGroupId: PLAYER.category.ageGroupId || '', teamId, level: team?.level || PLAYER.player.level || '' });
  } catch (e) { box.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
  const enrolled = new Set(PLAYER.history.filter((h) => !['CANCELLED', 'TRANSFERRED'].includes(h.status)).map((h) => h.term));
  const draw = () => {
    box.innerHTML = purchasePicker(ATP, 'at') + (enrolled.size ? `<div class="mini" style="margin-top:8px">Already enrolled: ${[...enrolled].map(esc).join(', ')}</div>` : '');
    wirePurchasePicker(ATP, 'at', box, (redraw) => { if (redraw) draw(); refreshAddTermQuote(); });
  };
  draw();
  await refreshAddTermQuote();
}

function fillAddTermTeams() {
  const d = PLAYER, all = $('at-all').checked, code = d.category.code;
  const keep = $('at-team').value || d.team?.id || '';
  const teams = LK.teams.filter((t) => all || !code || (t.ageCodes || []).includes(code));
  $('at-team').innerHTML = opt('', 'No team yet — place later') + teams.map((t) =>
    opt(t.id, `${t.name} · ${t.schedule} · ${t.isFull ? 'full, will waitlist' : t.placesLeft + ' places'}`, t.id === keep)).join('');
}

async function refreshAddTermQuote() {
  const box = $('at-quote'); if (!box) return;
  const teamId = $('at-team').value;
  if (!ATP.package || !ATP.spw) { box.innerHTML = ''; $('at-go').disabled = true; return; }
  box.innerHTML = '<div class="loading">Pricing…</div>';
  const qs = purchaseQuery(ATP); if (teamId) qs.set('teamId', teamId);
  try {
    const q = await api(`/players/${PLAYER.player.id}/terms/quote?${qs}`);
    ATP.lastQuote = q; planAmounts('at');
    $('at-go').disabled = !q.ok;
    if (!q.ok && q.listPrice === undefined) { box.innerHTML = `<div class="note warn">${esc(q.reason)}</div>`; return; }
    box.innerHTML = `${!q.ok ? `<div class="note warn" style="margin-bottom:10px">${esc(q.reason)}</div>` : ''}
      ${q.categoryWarning ? `<div class="note warn" style="margin-bottom:10px">${esc(q.categoryWarning)} Confirming places them outside their category.</div>` : ''}
      ${quoteTable(q, PLAYER.category.code)}`;
  } catch (e) { box.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; $('at-go').disabled = true; }
}

function quoteTable(q, cat) {
  const what = q.sessionsPerWeek
    ? `${esc(q.packageLabel)} · ${esc(q.category || cat || '')} · ${q.sessionsPerWeek} session${q.sessionsPerWeek === 1 ? '' : 's'}/week`
    : `${esc(q.term.name)} fee${cat ? ' · ' + esc(cat) : ''}`;
  const extras = q.extras || [];
  return `<div class="quote">
    <div class="ql"><span>${what}${q.proration ? `<div class="mini">Price list ${money(q.proration.fullPriceInclVat ?? q.proration.fullPrice)} incl. VAT · <b>prorated</b>: starts ${dmy(q.proration.startDate)}, ${q.proration.sessionsLeft} of ${q.proration.sessionsTotal} sessions → ${money(q.listPriceInclVat ?? q.listPrice)}</div>` : q.listPriceInclVat ? `<div class="mini">Price list ${money(q.listPriceInclVat)} incl. VAT${q.terms && q.terms.length > 1 ? ' · ' + q.terms.map((t) => esc(t.name)).join(' + ') : ''}</div>` : ''}</span><span>${money(q.listPrice)}</span></div>
    ${q.manualDiscount ? `<div class="ql disc"><span>${esc(q.manualDiscount.label)}<div class="mini">training fee only · ${q.manualDiscount.extra ? 'extra discount on the full-price child' : 'replaces the sibling discount'}</div></span><span>−${money(q.manualDiscount.amount)}</span></div>` : ''}
    ${q.siblingDiscount ? `<div class="ql disc"><span>Sibling discount — ${esc(q.siblingDiscount.position)} child, ${q.siblingDiscount.percent}%<div class="mini">${esc(q.siblingDiscount.reason)}</div></span><span>−${money(q.siblingDiscount.amount)}</span></div>` : ''}
    <div class="ql"><span>VAT ${Number(q.vatRate)}%</span><span>${money(q.vat)}</span></div>
    ${extras.length ? `<div class="ql"><span><b>Fee total</b></span><span><b>${money(q.total)}</b></span></div>
      ${extras.map((x) => `<div class="ql"><span>+ ${esc(x.name)} <span class="mini">incl. VAT</span></span><span>${money(x.inclVat)}</span></div>`).join('')}` : ''}
    <div class="ql tot"><span>Total</span><span>${money(q.grandTotal ?? q.total)}</span></div></div>`;
}

/**
 * Credits made to siblings who moved down the ladder because this child joined —
 * e.g. an older sister registering makes her younger brother the 2nd child.
 */
function creditNote(credits) {
  if (!credits || !credits.length) return '';
  return `<div class="note good" style="margin-top:12px"><b>Sibling discount credited</b>${credits.map((c) => {
    const where = c.appliedToInvoice >= c.total ? `applied to ${esc(c.invoiceNumber)}`
      : c.appliedToInvoice > 0 ? `${money(c.appliedToInvoice)} applied to ${esc(c.invoiceNumber)}, ${money(c.leftInWallet)} kept in the wallet`
      : `kept in the family wallet — ${esc(c.invoiceNumber)} was already paid`;
    return `<div style="margin-top:6px">${esc(c.playerName)} is now at ${c.percentAfter}% (was ${c.percentBefore}%): <b>${money(c.total)}</b> ${where}.</div>`;
  }).join('')}</div>`;
}

const MANUAL_PRESETS = [['EARLY_BIRD_10', 'Early bird', 10], ['DISCOUNT_10', 'Discount', 10], ['DISCOUNT_15', 'Discount', 15],
  ['DISCOUNT_25', 'Discount', 25], ['DISCOUNT_50', 'Discount', 50], ['SPONSORED_100', 'Sponsored', 100]];
/**
 * A manual discount: a preset or any percentage, off the training package only
 * (kits and the league are still charged). On the full-price child it is an extra
 * discount; on a brother or sister it replaces the sibling discount — never both.
 */
const manWord = (m) => (m?.percent ? `${m.percent}%` : m?.preset ? `${MANUAL_PRESETS.find((x) => x[0] === m.preset)?.[1] || ''} ${MANUAL_PRESETS.find((x) => x[0] === m.preset)?.[2]}%` : '');
function manualDiscountBlock(ctx, st, open) {
  const m = st.manual || (st.manual = { preset: '', percent: null, reason: '' });
  const on = !!(m.preset || m.percent);
  return `<details style="margin-top:12px" ${on || open ? 'open' : ''}><summary class="mini" style="cursor:pointer">Manual discount — any percentage${on ? ` — <b style="color:var(--coral)">${esc(manWord(m))}</b>` : ''}</summary>
    <div class="opts c3" style="margin-top:10px">${MANUAL_PRESETS.map(([code, word, pct]) => `<button class="opt ${m.preset === code && !m.percent ? 'on' : ''}" data-act="manPick" data-a1="${ctx}" data-a2="${code}">
      <span class="t">${pct}%</span><div class="d">${esc(word)}${pct === 100 ? ' — training free, kits &amp; league still charged' : ''}</div></button>`).join('')}</div>
    <div class="frm" style="margin-top:10px">
      <div><label class="lbl" for="${ctx}-mpct">Or type a percentage</label>
        <div class="sdrow"><input class="in" id="${ctx}-mpct" type="number" min="0.01" max="100" step="0.01" placeholder="e.g. 12.5" value="${m.percent ?? ''}" style="max-width:120px"><span>%</span>
        <button class="btn sm ghost" data-act="manPct" data-a1="${ctx}">Apply</button></div></div>
      <div><label class="lbl" for="${ctx}-mrsn">Reason / approved by <span style="text-transform:none;letter-spacing:0;font-weight:400">(optional)</span></label><input class="in" id="${ctx}-mrsn" value="${esc(m.reason || '')}" placeholder="e.g. Approved by Karim — scholarship"></div>
      <div class="full hint">Comes off the season package (training fee) only. On the <b>full-price child</b> it is an extra discount; on a brother or sister it <b>replaces</b> the sibling discount. Kits, the league and tournaments are never discounted.${on ? ' <a class="lnk2" data-act="manPick" data-a1="' + ctx + '" data-a2="">Remove the discount</a>' : ''}</div>
    </div></details>`;
}
const manState = (ctx) => (ctx === 'at' ? ATP : ctx === 'rg' ? REG.purchase : ctx === 'ia' ? INVT.draft : /^k\d+$/.test(ctx) ? REG.kids[Number(ctx.slice(1))]?.purchase : null);
document.addEventListener('input', (e) => {
  const id = e.target?.id || ''; const mm = /^(at|rg|ia|k\d+)-mrsn$/.exec(id); if (!mm) return;
  const st = manState(mm[1]); if (st?.manual) st.manual.reason = e.target.value;
});
function manRedraw(ctx) {
  if (ctx === 'at') { const box = $('at-manbox'); if (box) box.innerHTML = manualDiscountBlock('at', ATP); refreshAddTermQuote(); }
  else if (ctx === 'rg') { const box = $('rg-manbox'); if (box) box.innerHTML = manualDiscountBlock('rg', REG.purchase); regQuote(); }
  else if (ctx === 'ia') renderInvTraining();
  else regFamilyQuote();
}
ACT.manPick = (ctx, code) => {
  const st = manState(ctx); if (!st) return; st.manual = st.manual || { preset: '', percent: null, reason: '' };
  const r = $(ctx + '-mrsn'); if (r) st.manual.reason = r.value;
  st.manual.preset = st.manual.preset === code && !st.manual.percent ? '' : code; st.manual.percent = null;
  manRedraw(ctx);
};
ACT.manPct = (ctx) => {
  const st = manState(ctx); if (!st) return; st.manual = st.manual || { preset: '', percent: null, reason: '' };
  const v = Number($(ctx + '-mpct')?.value);
  if (!(v > 0 && v <= 100)) return toast('Type a percentage between 0.01 and 100');
  const r = $(ctx + '-mrsn'); if (r) st.manual.reason = r.value;
  st.manual.percent = Math.round(v * 100) / 100; st.manual.preset = '';
  manRedraw(ctx);
};
/** The manual discount to send: a preset or any percentage, with the reason. */
const manualBody = (m) => (m?.percent ? { percent: m.percent, reason: m.reason || undefined } : m?.preset ? { preset: m.preset, reason: m.reason || undefined } : undefined);
function readManualDiscount(errEl, st) {
  st = st || ATP;
  const m = st?.manual; if (!m || !(m.preset || m.percent)) return { ok: true, value: undefined };
  const ctx = st === ATP ? 'at' : 'rg';
  const r = $(ctx + '-mrsn'); if (r) m.reason = r.value.trim();
  return { ok: true, value: manualBody(m) };
}

ACT.pAddTermGo = async () => {
  const errEl = $('at-err'); errEl.innerHTML = '';
  const manual = readManualDiscount(errEl); if (!manual.ok) return;
  const planErr = planCheck(ATP.plan); if (planErr) { errEl.innerHTML = `<div class="note bad">${esc(planErr)}</div>`; return; }
  const teamId = $('at-team').value || undefined;
  const team = LK.teams.find((t) => t.id === teamId);
  const outside = !!(team && PLAYER.category.code && !(team.ageCodes || []).includes(PLAYER.category.code));
  const body = { package: ATP.package, sessionsPerWeek: ATP.spw || undefined,
    productIds: ATP.productIds.length ? ATP.productIds : undefined, teamId, allowCategoryOverride: outside || undefined,
    manualDiscount: manual.value, startDate: ATP.startDate || undefined, instalments: planBody(ATP.plan), issue: $('at-issue').checked };
  $('at-go').disabled = true;
  try {
    const r = await api(`/players/${PLAYER.player.id}/terms`, { method: 'POST', body: JSON.stringify(body) });
    const inv = r.invoice;
    openDrawer('Term added', `
      <div class="note good">${esc(PLAYER.player.name)} is enrolled${r.waitlisted ? ' — the team is full, so they are on the waitlist' : ''}.</div>
      ${inv ? `<dl class="kv" style="margin-top:14px"><dt>Invoice</dt><dd class="ref">${esc(inv.number)}</dd><dt>Status</dt><dd>${statusPill(inv.status)}</dd>
        <dt>Total</dt><dd><b>${money(inv.total)}</b></dd><dt>Discount</dt><dd>${(r.appliedDiscounts || []).map(esc).join('<br>') || 'none'}</dd></dl>` : ''}
      ${creditNote(r.siblingCredits)}
      <div class="row-end">${inv ? `<button class="btn ghost" data-act="showInvoice" data-a1="${inv.id}">Open invoice</button>` : ''}<button class="btn" data-act="closeDrawer">Done</button></div>`);
    await loadLookups(true); await reloadPlayer();
  } catch (e) { errEl.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; $('at-go').disabled = false; }
};

// ---- "User term": add items to a registered child ----
let UT = null;
ACT.pItems = async () => {
  const d = PLAYER;
  if (d.player.archivedAt) return toast('Restore this child first');
  const prods = (await api('/products?activeOnly=true')).sort((a, b) => a.sortOrder - b.sortOrder);
  UT = { qty: {}, custom: [] };
  const lvl = d.player.level;
  openDrawer('User term — add items', `
    <p class="mini" style="margin-top:0">Add kits, a league or another charge for ${esc(d.player.name)}. This raises its own invoice; the term fee is not touched. Prices include VAT.</p>
    <div class="xtras">${prods.map((p) => `<div class="xrow"><span><b>${esc(p.name)}</b>${p.description ? ` <span class="mini">— ${esc(p.description)}</span>` : ''}
        ${p.levels?.length && lvl && !p.levels.includes(lvl) ? `<div class="mini" style="color:var(--warn)">Usually for ${p.levels.map((l) => LEVEL_WORD[l]).join(' / ')}</div>` : ''}</span>
        <span class="xp">${money(p.priceInclVat)}</span>
        <input class="in qty" type="number" min="0" max="20" value="0" data-utq="${p.id}" aria-label="Quantity of ${esc(p.name)}"></div>`).join('') || '<div class="mini">No items in the catalogue.</div>'}</div>
    <details style="margin-top:12px"><summary class="mini" style="cursor:pointer">Add a custom item</summary>
      <div class="frm" style="margin-top:10px">
        <div class="full"><label class="lbl" for="ut-cd">Description</label><input class="in" id="ut-cd" placeholder="e.g. Abu Dhabi Cup entry"></div>
        <div><label class="lbl" for="ut-ca">Price (AED, incl. VAT)</label><input class="in" id="ut-ca" type="number" min="0" step="0.01"></div>
        <div><label class="lbl" for="ut-cs">Reported as</label><select class="sel" id="ut-cs">
          ${[['OTHER', 'Other'], ['KITS', 'Kits sales'], ['MAN_CITY_LEAGUE', 'Manchester City League'], ['ABU_DHABI_CUP', 'Abu Dhabi Cup'], ['RAMADAN_CUP', 'Ramadan Cup'], ['SALOU_CUP', 'Salou Cup'], ['ACADEMY', 'LALIGA Academy']].map(([k, v]) => opt(k, v)).join('')}</select></div>
      </div></details>
    <div class="quote" style="margin-top:14px"><div class="ql tot"><span>Total</span><span id="ut-tot">${money(0)}</span></div></div>
    <label class="chk" style="margin-top:12px"><input type="checkbox" id="ut-issue" checked> Issue the invoice now</label>
    <div id="ut-err" style="margin-top:10px"></div>
    <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" id="ut-go" data-act="pItemsGo">Add and invoice</button></div>`);
  const total = () => {
    let t = 0;
    document.querySelectorAll('[data-utq]').forEach((i) => { const p = prods.find((x) => x.id === i.dataset.utq); t += (Number(i.value) || 0) * Number(p.priceInclVat); });
    t += Number($('ut-ca').value) || 0;
    $('ut-tot').textContent = money(t);
  };
  document.querySelectorAll('[data-utq]').forEach((i) => i.addEventListener('input', total));
  $('ut-ca').addEventListener('input', total);
};
ACT.pItemsGo = async () => {
  const items = [];
  document.querySelectorAll('[data-utq]').forEach((i) => { const n = Math.floor(Number(i.value) || 0); if (n > 0) items.push({ productId: i.dataset.utq, quantity: n }); });
  const cd = $('ut-cd').value.trim(), ca = Number($('ut-ca').value) || 0;
  if (cd || ca) {
    if (cd.length < 2 || !(ca > 0)) { $('ut-err').innerHTML = '<div class="note bad">A custom item needs a description and a price.</div>'; return; }
    items.push({ description: cd, amountInclVat: ca, stream: $('ut-cs').value });
  }
  if (!items.length) { $('ut-err').innerHTML = '<div class="note bad">Choose at least one item.</div>'; return; }
  $('ut-go').disabled = true;
  try {
    const r = await api(`/players/${PLAYER.player.id}/items`, { method: 'POST', body: JSON.stringify({ items, issue: $('ut-issue').checked }) });
    const inv = r.invoice;
    openDrawer('Items added', `<div class="note good">Added for ${esc(PLAYER.player.name)}.</div>
      <dl class="kv" style="margin-top:14px"><dt>Invoice</dt><dd class="ref">${esc(inv.number)}</dd><dt>Status</dt><dd>${statusPill(inv.status)}</dd>
      <dt>Items</dt><dd>${inv.lineItems.map((l) => esc(l.description.replace(/^.*? — /, ''))).join('<br>')}</dd><dt>Total</dt><dd><b>${money(inv.total)}</b></dd></dl>
      <div class="row-end"><button class="btn ghost" data-act="showInvoice" data-a1="${inv.id}">Open invoice</button><button class="btn" data-act="closeDrawer">Done</button></div>`);
    await reloadPlayer();
  } catch (e) { $('ut-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; $('ut-go').disabled = false; }
};

// ---- wallet ----
ACT.pWallet = () => window.showWallet(PLAYER.guardian.id, PLAYER.guardian.fullName);

// ---- account switch (read-only parent view) ----
ACT.pAccount = () => {
  const g = PLAYER.guardian;
  openDrawer('Account switch', `
    <div class="note info">See exactly what ${esc(g.fullName)} sees in their account. This view is read-only, and opening it is recorded in the activity log with your reason.</div>
    <div style="margin-top:14px"><label class="lbl" for="av-reason">Reason</label><input class="in" id="av-reason" placeholder="e.g. Parent called about the Term 2 invoice"></div>
    <div id="av-err" style="margin-top:10px"></div>
    <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" data-act="pAccountGo">Open parent view</button></div>`);
  $('av-reason').addEventListener('keydown', (e) => { if (e.key === 'Enter') ACT.pAccountGo(); });
  $('av-reason').focus();
};

ACT.pAccountGo = async () => {
  const reason = $('av-reason').value.trim();
  if (reason.length < 5) { $('av-err').innerHTML = '<div class="note bad">Give a reason (at least 5 characters) — it goes in the activity log.</div>'; return; }
  try {
    const v = await api(`/guardians/${PLAYER.guardian.id}/account-view`, { method: 'POST', body: JSON.stringify({ reason }) });
    openDrawer(`Viewing as ${v.viewingAs.name}`, `
      <div class="note warn">Read-only — this is the parent's view of their account (${esc(v.viewingAs.reference)}). Recorded in the activity log.</div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card kpi"><div class="l">To pay</div><div class="n ${v.outstanding > 0 ? 'bad' : 'good'}">${money(v.outstanding)}</div></div>
        <div class="card kpi"><div class="l">Wallet credit</div><div class="n">${money(v.walletBalance)}</div></div>
      </div>
      <h3 style="font-size:13px;margin:18px 0 8px">Children</h3>
      ${v.children.map((c) => `<div class="card" style="padding:12px 14px;margin-bottom:8px"><b>${esc(c.name)}</b> <span class="chip">${esc(c.category || '—')}</span>
        <div class="mini">${c.team ? esc(c.team.name) + ' · ' + esc(c.team.schedule) + (c.team.coach ? ' · Coach ' + esc(c.team.coach.name) : '') : 'Not placed on a team yet'}</div></div>`).join('') || '<div class="mini">No children.</div>'}
      <h3 style="font-size:13px;margin:18px 0 8px">Invoices</h3>
      ${v.invoices.length ? `<div class="card tblwrap"><table><thead><tr><th>Invoice</th><th>Due</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr></thead>
        <tbody>${v.invoices.map((i) => `<tr><td class="ref">${esc(i.number)}</td><td>${dt(i.dueDate)}</td><td class="num">${money(i.total)}</td><td class="num">${money(i.balance)}</td><td class="mini">${esc(i.status)}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="mini">No invoices.</div>'}
      <div class="row-end"><button class="btn" data-act="closeDrawer">Close parent view</button></div>`);
  } catch (e) { $('av-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

// ---- delete user (archive first; permanent only for mistakes) ----
ACT.pDelete = () => {
  const p = PLAYER.player, archived = !!p.archivedAt;
  openDrawer('Delete user', `
    ${archived ? `<div class="note warn">${esc(p.name)} is archived${p.archiveReason ? ' — ' + esc(p.archiveReason) : ''}.</div>
      <div class="row-end" style="justify-content:flex-start"><button class="btn" data-act="pRestore">Restore ${esc(p.firstName)}</button></div>`
    : `<h3 style="font-size:14px;margin-bottom:6px">Archive ${esc(p.name)}</h3>
      <p class="mini" style="margin:0 0 12px">Removes the child from player lists, rosters and invoicing and frees their team place. Invoices, payments, attendance and comments are all kept, and they can be restored at any time. This is the right choice when a child leaves.</p>
      <label class="lbl" for="dl-reason">Reason</label><input class="in" id="dl-reason" placeholder="e.g. Family relocated to Dubai">
      <div id="dl-err" style="margin-top:10px"></div>
      <div class="row-end" style="justify-content:flex-start"><button class="btn danger" data-act="pArchiveGo">Archive child</button></div>`}
    <details style="margin-top:26px"><summary class="mini" style="cursor:pointer">Delete permanently — only for a record created by mistake</summary>
      <p class="mini" style="margin:10px 0">This erases the child completely and can't be undone. It is refused if the child has any invoices, discounts, attendance, evaluations or documents, because removing those would break financial records.</p>
      <label class="lbl" for="dp-confirm">Type ${esc(p.reference)} to confirm</label><input class="in" id="dp-confirm" autocomplete="off">
      <label class="lbl" for="dp-reason" style="margin-top:10px">Reason</label><input class="in" id="dp-reason" placeholder="e.g. Duplicate entry">
      <div id="dp-err" style="margin-top:10px"></div>
      <div class="row-end" style="justify-content:flex-start"><button class="btn danger" data-act="pPermanentGo">Delete permanently</button></div>
    </details>`);
};

ACT.pArchiveGo = async () => {
  const reason = $('dl-reason').value.trim();
  if (reason.length < 5) { $('dl-err').innerHTML = '<div class="note bad">Give a reason (at least 5 characters).</div>'; return; }
  try { await api(`/players/${PLAYER.player.id}/archive`, { method: 'POST', body: JSON.stringify({ reason }) });
    closeDrawer(); toast('Archived — history kept'); await loadLookups(true); await reloadPlayer(); }
  catch (e) { $('dl-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

ACT.pRestore = async () => {
  try {
    const r = await api(`/players/${PLAYER.player.id}/restore`, { method: 'POST', body: JSON.stringify({}) });
    closeDrawer(); toast(r.note || (r.team ? `Restored to ${r.team}` : 'Restored')); await loadLookups(true); await reloadPlayer();
  } catch (e) { toast(e.message); }
};

ACT.pPermanentGo = async () => {
  const p = PLAYER.player, err = (m) => { $('dp-err').innerHTML = `<div class="note bad">${esc(m)}</div>`; };
  if ($('dp-confirm').value.trim().toUpperCase() !== p.reference.toUpperCase()) return err(`Type ${p.reference} exactly to confirm.`);
  const reason = $('dp-reason').value.trim();
  if (reason.length < 5) return err('Give a reason (at least 5 characters).');
  try {
    await api(`/players/${p.id}/delete-permanently`, { method: 'POST', body: JSON.stringify({ reason }) });
    closeDrawer(); toast(`${p.reference} deleted`); PLAYER = null; await loadLookups(true); go('players');
  } catch (e) { err(e.message); }
};

// ---- assigned coach ----
ACT.pCoach = () => {
  const t = PLAYER.team;
  if (!t) {
    return openDrawer('Assigned coach', `<div class="note info">${esc(PLAYER.player.firstName)} isn't on a team yet, so there's no coach. Use “Add term and generate invoice” to place them.</div>
      <div class="row-end"><button class="btn" data-act="closeDrawer">OK</button></div>`);
  }
  const board = LK.teams.find((x) => x.id === t.id);
  const n = board ? board.enrolled : null;
  openDrawer('Assigned coach', `
    <div class="kv"><dt>Team</dt><dd><b>${esc(t.name)}</b> · ${esc(t.schedule)}</dd><dt>Coach</dt><dd>${esc(t.coach?.name || 'None yet')}</dd></div>
    ${can('team.edit') ? `
      <label class="lbl" for="co-sel">Change the team's coach</label>
      <select class="sel" id="co-sel">${opt('', 'No coach')}${LK.coaches.map((c) => opt(c.id, c.name + (c.canLogin ? '' : ' (no login yet)'), t.coach?.id === c.id)).join('')}</select>
      <div class="note info" style="margin-top:10px">The coach belongs to the team, so this changes it for everyone on ${esc(t.name)}${n != null ? ` — ${n} child${n === 1 ? '' : 'ren'}` : ''}.</div>
      <div id="co-err" style="margin-top:10px"></div>
      <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" data-act="pCoachGo" data-a1="${t.id}">Save</button></div>`
    : '<div class="mini">Your role can view the coach but not change it.</div>'}`);
};

ACT.pCoachGo = async (teamId) => {
  const coachId = $('co-sel').value || null;
  try { await api(`/teams/${teamId}/coach`, { method: 'PATCH', body: JSON.stringify({ coachId }) });
    closeDrawer(); toast('Coach updated for the whole team'); await loadLookups(true); await reloadPlayer(); }
  catch (e) { $('co-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

// ================= guardians =================
// Search like the players list; each row is a family with its children. Edit
// covers the parent's details and an additional email for another family member
// (copied on invoice emails).
let GF = { page: 1 };
const GF_KEYS = ['search', 'reference', 'emirate', 'children', 'portal', 'additionalEmail'];
const EMIRATE_LIST = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
VIEWS.guardians = async () => {
  const v = (k) => esc(GF[k] ?? '');
  const sel = (k, opts) => `<select class="sel" id="gf-${k}">${opts.map(([val, t]) => opt(val, t, (GF[k] ?? '') === val)).join('')}</select>`;
  $('view').innerHTML = `<div class="card filters">
    <div class="fgrid">
      <div class="w2"><label class="lbl" for="gf-search">Search</label><input class="in" id="gf-search" value="${v('search')}" placeholder="Parent or child name, email (main or additional), mobile"></div>
      <div><label class="lbl" for="gf-reference">Parent no.</label><div class="pfx"><span>PR</span><input class="in" id="gf-reference" value="${v('reference')}" placeholder="xxxxxx"></div></div>
      <div><label class="lbl" for="gf-children">Children</label>${sel('children', [['', 'Any'], ['active', 'Has a child on file'], ['none', 'No active child']])}</div>
      <div><label class="lbl" for="gf-emirate">Emirate</label>${sel('emirate', [['', 'Any emirate'], ...EMIRATE_LIST.map((e) => [e, e])])}</div>
      <div><label class="lbl" for="gf-portal">Parent sign-in</label>${sel('portal', [['', 'Any'], ['signed_in', 'Has signed in'], ['sent', 'Details sent, not signed in'], ['never', 'Never sent']])}</div>
      <div><label class="lbl" for="gf-additionalEmail">Additional email</label>${sel('additionalEmail', [['', 'Either'], ['yes', 'Has one'], ['no', 'None']])}</div>
    </div>
    <div class="fbar"><div style="display:flex;gap:8px"><button class="btn sm" data-act="gSearch">Search</button><button class="btn sm ghost" data-act="gClear">Clear</button></div>
      <span class="fcount" id="gf-count"></span><span></span></div></div>
  <div class="card tblwrap" id="gf-tbl"><div class="loading">Loading…</div></div>`;
  $('view').querySelectorAll('.filters input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') ACT.gSearch(); }));
  $('view').querySelectorAll('.filters select').forEach((i) => i.addEventListener('change', () => ACT.gSearch()));
  await loadGuardians();
};
ACT.gSearch = () => { GF.page = 1; loadGuardians(); };
ACT.gClear = () => { GF = { page: 1 }; go('guardians'); };
ACT.gPage = (n) => { GF.page = Number(n); loadGuardians(); };
async function loadGuardians() {
  const box = $('gf-tbl'); if (!box) return;
  for (const k of GF_KEYS) { const el = $('gf-' + k); if (el) GF[k] = el.value.trim(); }
  const qs = new URLSearchParams({ page: GF.page, limit: 50 });
  for (const k of GF_KEYS) if (GF[k]) qs.set(k, GF[k]);
  try {
    const d = await api('/guardians/directory?' + qs);
    $('gf-count').innerHTML = `<b>${d.meta.total}</b> parent${d.meta.total === 1 ? '' : 's'}`;
    const portal = (g) => g.lastLoginAt ? `<span class="pill p-good">signed in</span><div class="mini">${dmy(g.lastLoginAt)}</div>` : g.credentialsSentAt ? `<span class="pill p-info">details sent</span><div class="mini">${dmy(g.credentialsSentAt)}</div>` : '<span class="mini">—</span>';
    box.innerHTML = d.data.length ? `<table class="dir" id="gf-table"><thead><tr><th data-col="ref">Parent No</th><th data-col="name">Parent</th><th data-col="email">Email</th><th data-col="extra">Additional email</th>
        <th data-col="mob">Mobile</th><th data-col="kids">Children</th><th data-col="area">Area</th>${can('wallet.view') ? '<th data-col="wal" class="num">Wallet</th>' : ''}<th data-col="portal">Parent sign-in</th><th data-col="act"></th></tr></thead>
      <tbody>${d.data.map((g) => `<tr>
        <td class="ref">${esc(g.reference)}</td>
        <td><b>${esc(g.fullName)}</b><div class="mini">${esc(g.relationship || '')}</div></td>
        <td class="em" title="${esc(g.email)}">${esc(g.email)}</td>
        <td class="em">${g.secondaryEmail ? `${esc(g.secondaryEmail)}${g.secondaryEmailName ? `<div class="mini">${esc(g.secondaryEmailName)}</div>` : ''}` : '<span class="mini">—</span>'}</td>
        <td class="mono">${esc(fmtPhone(g.mobile))}</td>
        <td>${g.children.map((c) => `<div><a class="lnk2" data-act="openPlayer" data-a1="${c.id}">${esc(c.reference)}</a> ${esc(c.name)} ${c.category ? `<span class="chip">${esc(c.category)}</span>` : ''}${c.archived ? ' <span class="pill p-mute">archived</span>' : ''}</div>`).join('') || '<span class="mini">no children</span>'}</td>
        <td>${esc([...new Set([g.city, g.emirate].filter(Boolean))].join(', ') || '—')}</td>
        ${can('wallet.view') ? `<td class="num"><a class="lnk2" data-act="showWallet" data-a1="${g.id}" data-a2="${esc(g.fullName)}">${money(g.wallet)}</a></td>` : ''}
        <td>${portal(g)}</td>
        <td>${can('guardian.edit') ? `<button class="btn sm ghost" data-act="gEdit" data-a1="${g.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="pager"><span>Page ${d.meta.page} of ${d.meta.pages}</span><span>
        <button class="btn sm ghost" data-act="gPage" data-a1="${d.meta.page - 1}" ${d.meta.page <= 1 ? 'disabled' : ''}>‹ Previous</button>
        <button class="btn sm ghost" data-act="gPage" data-a1="${d.meta.page + 1}" ${d.meta.page >= d.meta.pages ? 'disabled' : ''}>Next ›</button></span></div>`
      : '<div class="empty">No parents match.</div>';
    resizableTable($('gf-table'), 'guardians');
    window.__gRows = d.data;
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
ACT.gEdit = async (id) => {
  openDrawer('Edit parent', '<div class="loading">Loading…</div>');
  try {
    const g = await api('/guardians/' + id);
    openDrawer(`Edit parent — ${g.reference}`, `<div class="frm">
      ${fld('Full name *', 'ge-name', g.fullName)}
      <div><label class="lbl" for="ge-rel">Relationship</label><select class="sel" id="ge-rel">${RELATIONS.map((r) => opt(r, r, (g.relationship || 'Father') === r)).join('')}</select></div>
      ${fld('Email *', 'ge-email', g.email, 'type="email"')}${fld('Mobile *', 'ge-mob', g.mobile, 'type="tel"')}
      <div><label class="lbl" for="ge-emi">Emirate</label><select class="sel" id="ge-emi">${opt('', '—')}${EMIRATE_LIST.map((x) => opt(x, x, g.emirate === x)).join('')}</select></div>
      ${fld('City / area', 'ge-city', g.city || '')}
    </div>
    <div class="sec"><h3>Additional email <span class="cnt">another family member</span></h3>
      <div class="frm">${fld('Email', 'ge-x', g.secondaryEmail || '', 'type="email" placeholder="e.g. the other parent"')}${fld('Whose is it?', 'ge-xn', g.secondaryEmailName || '', 'placeholder="e.g. Mother — Rana"')}
      <div class="full hint">Invoice emails go to the main email and are copied to this one. Parent sign-in details only go to the main email.</div></div></div>
    <div class="mini" style="margin-top:12px">Children: ${(g.players || []).map((c) => `<a class="lnk2" data-act="openPlayer" data-a1="${c.id}">${esc(c.reference)}</a> ${esc(c.firstName + ' ' + c.lastName)}`).join(', ') || 'none'}</div>
    <div id="ge-err" style="margin-top:10px"></div>
    <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" data-act="gSave" data-a1="${g.id}">Save</button></div>`);
  } catch (e) { openDrawer('Edit parent', `<div class="empty">${esc(e.message)}</div>`); }
};
ACT.gSave = async (id) => {
  const body = { fullName: $('ge-name').value.trim(), relationship: $('ge-rel').value, email: $('ge-email').value.trim(), mobile: $('ge-mob').value.trim(),
    emirate: $('ge-emi').value || undefined, city: $('ge-city').value.trim() || undefined,
    secondaryEmail: $('ge-x').value.trim() || null, secondaryEmailName: $('ge-xn').value.trim() || null };
  if (!body.fullName || !body.email || !body.mobile) { $('ge-err').innerHTML = '<div class="note bad">Name, email and mobile are needed.</div>'; return; }
  try { await api('/guardians/' + id, { method: 'PATCH', body: JSON.stringify(body) }); closeDrawer(); toast('Parent saved');
    if (CURRENT === 'guardians') loadGuardians(); else if (PLAYER && $('page-title').textContent === 'Player') reloadPlayer(); }
  catch (e) { $('ge-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};
window.showWallet = async (id,name) => {
  openDrawer(name+' — wallet','<div class="loading">Loading…</div>');
  try{ const w = await api(`/guardians/${id}/wallet`);
    openDrawer(name+' — wallet', `<dl class="kv"><dt>Balance</dt><dd style="font-family:Archivo,system-ui,sans-serif;font-size:20px;font-weight:800">${money(w.balance)}</dd></dl>
      <h3 style="font-size:13px;margin-bottom:8px">Transactions</h3>
      ${(w.transactions||[]).length?`<table><tbody>${w.transactions.map(t=>`<tr><td>${dt(t.createdAt)}</td><td>${statusPill(t.type)}</td><td class="num">${money(t.amount)}</td><td class="mini">${esc(t.reason||'')}</td></tr>`).join('')}</tbody></table>`:'<div class="mini">No transactions.</div>'}`);
  }catch(e){ openDrawer(name, `<div class="empty">${esc(e.message)}</div>`); }
};

// ================= trials & leads =================
// Every family that shows interest lands here — the website's "Book a Free
// Trial" pop-up, a phone call, a chat, a walk-in. The desk works each one from
// New to Joined: contact, book a trial into a real training session, record how
// it went, and register the child through Register a child.
const LEAD_STAGES = [['NEW', 'New'], ['CONTACTED', 'Contacted'], ['TRIAL_BOOKED', 'Trial booked'], ['TRIAL_ATTENDED', 'Trial done'],
  ['OFFER_MADE', 'Awaiting decision'], ['REGISTERED', 'Joined'], ['LOST', 'Not joining']];
const STAGE_WORD = Object.fromEntries(LEAD_STAGES);
const STAGE_CLS = { NEW: 'p-info', CONTACTED: 'p-mute', TRIAL_BOOKED: 'p-info', TRIAL_ATTENDED: 'p-warn', OFFER_MADE: 'p-warn', REGISTERED: 'p-good', LOST: 'p-mute' };
const stagePill = (s) => `<span class="pill ${STAGE_CLS[s] || 'p-mute'}">${esc(STAGE_WORD[s] || s)}</span>`;
const LEAD_SOURCES = [['POPUP', 'Website pop-up'], ['WEBSITE', 'Website (other)'], ['ENQUIRY', 'Phone / walk-in'], ['REFERRAL', 'Referral'],
  ['SOCIAL_MEDIA', 'Social media'], ['SCHOOL', 'School'], ['EMAIL_SMS', 'Email / SMS'], ['TV_RADIO', 'TV / radio'], ['OTHER', 'Other']];
const SOURCE_WORD = Object.fromEntries(LEAD_SOURCES);
const LOST_REASONS = ['Price', 'Location / too far', 'Training days or times', 'Joined another academy', 'Child not interested', 'No response after several attempts', 'Too young / too old', 'Other'];
const OPEN_STAGES = ['NEW', 'CONTACTED', 'TRIAL_BOOKED', 'TRIAL_ATTENDED', 'OFFER_MADE'];
const dmyt = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—';
const dayTime = (d) => d ? new Date(d).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—';
const hhmm = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
const dubaiDay = (d) => new Date(new Date(d).getTime() + 4 * 3600000).toISOString().slice(0, 10);
const waLink = (mobile, text) => `https://wa.me/${String(mobile || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0(5\d{8})$/, '971$1')}?text=${encodeURIComponent(text || '')}`;
/** A date-time input's value for "n days from now at 10:00" (browser time — the desk is in the UAE). */
const inDays = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d; };
const localInput = (d) => { if (!d) return ''; const x = new Date(d); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };

function followUpCell(l) {
  if (!OPEN_STAGES.includes(l.status)) return '<span class="mini">—</span>';
  if (!l.nextFollowUpAt) return l.status === 'NEW' ? '<span class="pill p-warn">Contact now</span>' : '<span class="mini">not set</span>';
  const t = new Date(l.nextFollowUpAt), today = dubaiDay(new Date());
  const cls = t < new Date() && dubaiDay(t) < today ? 'bad' : dubaiDay(t) === today ? 'warn' : '';
  return `<span class="${cls ? 'pill p-' + cls : ''}">${dayTime(t)}</span>`;
}
const ACT_WORD = { COMMENT: 'Comment', CALL: 'Call', WHATSAPP: 'WhatsApp', EMAIL: 'Email', SMS: 'SMS', STATUS: 'Stage', FOLLOW_UP: 'Follow-up',
  ASSIGNED: 'Assigned', TRIAL_BOOKED: 'Trial booked', TRIAL_RESULT: 'Trial', LOST: 'Not joining', CONVERTED: 'Registered', EDITED: 'Edited', CREATED: 'Enquiry' };
const CALL_WORD = { ANSWERED: 'answered', NO_ANSWER: 'no answer', BUSY: 'busy', WRONG_NUMBER: 'wrong number' };

let LF = { status: 'OPEN', page: 1 };
const LF_KEYS = ['search', 'source', 'assignedToId', 'category', 'createdFrom', 'createdTo', 'trialFrom', 'trialTo', 'hasComments'];
let LEADS_OWNERS = null;

VIEWS.leads = async () => {
  await loadLookups();
  const [st, owners] = await Promise.all([api('/leads/stats'), LEADS_OWNERS ? Promise.resolve(LEADS_OWNERS) : api('/leads/owners').catch(() => [])]);
  LEADS_OWNERS = owners;
  const v = (k) => esc(LF[k] ?? '');
  const sel = (k, opts) => `<select class="sel" id="lf-${k}">${opts.map(([val, t]) => opt(val, t, (LF[k] ?? '') === val)).join('')}</select>`;
  const more = LF_KEYS.some((k) => k !== 'search' && LF[k]);
  $('page-acts').innerHTML = `${can('lead.create') ? '<button class="btn sm" data-act="leadNew">+ Add enquiry</button>' : ''}
    <button class="btn sm ghost" data-act="go" data-a1="trials">Trials sheet</button>
    ${can('lead.edit') ? '<button class="btn sm ghost" data-act="leadTemplates">Message templates</button>' : ''}`;
  const tab = (k, label, n, alert) => `<button class="tab ${LF.status === k ? 'on' : ''}" data-act="leadTab" data-a1="${k}">${label}${n != null ? ` <span style="opacity:.75;font-weight:500">${n}</span>` : ''}${alert ? ' <span class="pill p-bad" style="margin-left:2px">!</span>' : ''}</button>`;
  $('view').innerHTML = `
    <div class="queue" style="margin-bottom:14px">
      <div class="qitem ${st.due ? 'alert' : 'ok'}" data-act="leadTab" data-a1="DUE"><span class="qn">${st.due}</span><span class="ql">Follow-ups due today${st.overdue ? ` · ${st.overdue} overdue` : ''}</span></div>
      <div class="qitem ${st.NEW ? 'alert' : 'ok'}" data-act="leadTab" data-a1="NEW"><span class="qn">${st.NEW}</span><span class="ql">New, not contacted yet${st.newWaiting ? ` · ${st.newWaiting} waiting over a day` : ''}</span></div>
      <div class="qitem" data-act="leadTab" data-a1="TRIAL_BOOKED"><span class="qn">${st.trialsThisWeek}</span><span class="ql">Trials in the next 7 days</span></div>
      <div class="qitem ok" data-act="leadTab" data-a1="REGISTERED"><span class="qn">${st.joined30}<span style="font-size:13px;font-weight:600;color:var(--muted)"> / ${st.last30}</span></span><span class="ql">Joined from last 30 days' enquiries (${st.conversion30}%)</span></div>
    </div>
    <div class="tabs">${tab('OPEN', 'To work on', st.open)}${tab('DUE', 'Due today', st.due, st.overdue > 0)}
      ${LEAD_STAGES.map(([k, l]) => tab(k, l, st[k])).join('')}${tab('', 'All')}</div>
    <div class="card filters">
      <div class="fgrid">
        <div class="w2"><label class="lbl" for="lf-search">Search</label><input class="in" id="lf-search" value="${v('search')}" placeholder="Parent, child, mobile, email or TR number"></div>
        <div><label class="lbl" for="lf-source">Source</label>${sel('source', [['', 'Any source'], ...LEAD_SOURCES])}</div>
        <div><label class="lbl" for="lf-assignedToId">Team member</label>${sel('assignedToId', [['', 'Anyone'], ['none', 'Not assigned'], ...owners.map((o) => [o.id, o.fullName])])}</div>
      </div>
      <details ${more ? 'open' : ''} style="margin-top:10px"><summary class="mini" style="cursor:pointer">More filters</summary>
      <div class="fgrid" style="margin-top:10px">
        <div><label class="lbl" for="lf-category">Category</label>${sel('category', [['', 'Any category'], ...LK.ageGroups.map((a) => [a.code, a.code])])}</div>
        <div><label class="lbl" for="lf-createdFrom">Received from</label><input class="in" type="date" id="lf-createdFrom" value="${v('createdFrom')}"></div>
        <div><label class="lbl" for="lf-createdTo">Received to</label><input class="in" type="date" id="lf-createdTo" value="${v('createdTo')}"></div>
        <div><label class="lbl" for="lf-trialFrom">Trial from</label><input class="in" type="date" id="lf-trialFrom" value="${v('trialFrom')}"></div>
        <div><label class="lbl" for="lf-trialTo">Trial to</label><input class="in" type="date" id="lf-trialTo" value="${v('trialTo')}"></div>
        <div><label class="lbl" for="lf-hasComments">Comments</label>${sel('hasComments', [['', 'Either'], ['yes', 'Has comments'], ['no', 'No comments yet']])}</div>
      </div></details>
      <div class="fbar"><div style="display:flex;gap:8px"><button class="btn sm" data-act="leadSearch">Search</button><button class="btn sm ghost" data-act="leadClear">Clear</button></div>
        <span class="fcount" id="lf-count"></span>${can('lead.export') ? '<button class="btn sm ghost" data-act="leadCsv">Export Excel</button>' : ''}</div></div>
    <div class="card tblwrap" id="lf-tbl"><div class="loading">Loading…</div></div>`;
  $('view').querySelectorAll('.filters input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') ACT.leadSearch(); }));
  await loadLeads();
};
function readLeadFilters() {
  for (const k of LF_KEYS) { const el = $('lf-' + k); if (el) LF[k] = el.value.trim(); }
  const qs = new URLSearchParams();
  if (LF.status) qs.set('status', LF.status);
  for (const k of LF_KEYS) if (LF[k]) qs.set(k, LF[k]);
  return qs;
}
ACT.leadTab = (s) => { readLeadFilters(); LF.status = s; LF.page = 1; go('leads'); };
ACT.leadSearch = () => { LF.page = 1; loadLeads(); };
ACT.leadClear = () => { LF = { status: LF.status, page: 1 }; go('leads'); };
ACT.leadPage = (p) => { LF.page = Number(p); loadLeads(); };
ACT.leadCsv = async () => { try { await fetchFile('/leads.csv?' + readLeadFilters(), 'Trials-and-leads.csv'); } catch (e) { toast(e.message); } };

async function loadLeads() {
  const box = $('lf-tbl'); if (!box) return;
  const qs = readLeadFilters(); qs.set('page', LF.page); qs.set('limit', 50);
  try {
    const d = await api('/leads?' + qs);
    $('lf-count').innerHTML = `<b>${d.meta.total}</b> lead${d.meta.total === 1 ? '' : 's'}`;
    const last = (a) => a ? `<span class="mini"><b style="color:var(--ink);font-weight:600">${esc(ACT_WORD[a.type] || a.type)}</b> ${esc(trunc(a.body || '', 70))}<br>${esc(a.by || '')} · ${dmyt(a.at)}</span>` : '<span class="mini">—</span>';
    box.innerHTML = d.data.length ? `<table id="lf-table" class="dir">
      <thead><tr><th data-col="ref">Track No</th><th data-col="rec">Received</th><th data-col="parent">Parent</th><th data-col="child">Child</th><th data-col="stage">Stage</th>
        <th data-col="fu">Next follow-up</th><th data-col="trial">Trial</th><th data-col="src">Source</th><th data-col="own">Team member</th><th data-col="last">Last activity</th></tr></thead>
      <tbody>${d.data.map((l) => `<tr class="clickable" data-act="openLead" data-a1="${l.id}">
        <td class="ref">${esc(l.reference)}${l.duplicateOfLeadId ? ' <span class="pill p-warn" title="Same mobile or email as an earlier enquiry">repeat</span>' : ''}</td>
        <td>${dmyt(l.createdAt)}</td>
        <td title="${esc(l.guardianName)}"><b>${esc(l.guardianName)}</b><div class="mini">${esc(fmtPhone(l.guardianMobile))}</div>${l.existingGuardianId ? '<div class="mini" style="color:var(--good)">family already registered</div>' : ''}</td>
        <td title="${esc(l.playerName)}">${esc(l.playerName)}<div class="mini">${l.ageGroupLabel ? `<span class="chip">${esc(l.ageGroupLabel)}</span> ` : ''}${l.playerDob ? dmy(l.playerDob) : ''}</div></td>
        <td>${stagePill(l.status)}${l.status === 'LOST' && l.lostReason ? `<div class="mini">${esc(trunc(l.lostReason, 40))}</div>` : ''}</td>
        <td>${followUpCell(l)}${l.contactAttempts ? `<div class="mini">${l.contactAttempts} attempt${l.contactAttempts === 1 ? '' : 's'}</div>` : ''}</td>
        <td>${l.trialDate ? `${dayTime(l.trialDate)}<div class="mini">${esc(l.trialTeamName || l.venueLabel || '')}${l.trialOutcome ? ' · ' + ({ ATTENDED: 'came', ANOTHER_TRIAL: 'came — another trial', NO_SHOW: 'no-show' }[l.trialOutcome] || '') : ''}</div>` : '<span class="mini">—</span>'}</td>
        <td><span class="chip">${esc(SOURCE_WORD[l.source] || l.source)}</span></td>
        <td>${esc(l.assignedToName || '—')}</td>
        <td class="cm">${last(l.lastActivity)}${l.comments ? `<div class="mini">${l.comments} comment${l.comments === 1 ? '' : 's'}</div>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="pager"><span>Page ${d.meta.page} of ${d.meta.pages}</span><span>
        <button class="btn sm ghost" data-act="leadPage" data-a1="${d.meta.page - 1}" ${d.meta.page <= 1 ? 'disabled' : ''}>‹ Previous</button>
        <button class="btn sm ghost" data-act="leadPage" data-a1="${d.meta.page + 1}" ${d.meta.page >= d.meta.pages ? 'disabled' : ''}>Next ›</button></span></div>`
      : `<div class="empty">${LF.status === 'DUE' ? 'Nothing due today — nice work.' : 'No leads match.'}</div>`;
    resizableTable($('lf-table'), 'leads');
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// ---------- the lead drawer ----------
let LEAD_OUTCOMES = null;
let LD = null;   // { d: detail, panel: null | 'trial' | 'result' | 'lost' | 'edit', slots, templates }
window.openLead = async (id) => {
  openDrawer('Lead', '<div class="loading">Loading…</div>', true);
  try { LD = { d: await api(`/leads/${id}/detail`), panel: null }; renderLead(); }
  catch (e) { openDrawer('Lead', `<div class="empty">${esc(e.message)}</div>`, true); }
};
ACT.openLead = (id) => window.openLead(id);
async function leadRefresh(detail) {
  LD.d = detail && detail.lead ? detail : await api(`/leads/${LD.d.lead.id}/detail`);
  renderLead();
  if (CURRENT === 'leads') { loadLeads(); api('/leads/stats').then(() => {}).catch(() => {}); }
}

function renderLead() {
  const { lead: l, timeline, possibleDuplicates: dup, existingFamily: fam, trialSession: ts, trialTeam: tt, assignedTo } = LD.d;
  const open = OPEN_STAGES.includes(l.status), edit = can('lead.edit');
  const first = (s) => String(s || '').trim().split(/\s+/)[0];
  const next = !open ? '' :
    l.status === 'TRIAL_BOOKED' ? `<button class="btn" data-act="leadPanel" data-a1="result">Record the trial</button>`
    : ['TRIAL_ATTENDED', 'OFFER_MADE'].includes(l.status) ? `<button class="btn" data-act="leadRegister">Register ${esc(first(l.playerName))}</button>`
    : `<button class="btn" data-act="leadPanel" data-a1="trial">Book a trial</button>`;
  const ev = (a) => {
    const m = a.meta || {};
    let head = ACT_WORD[a.type] || a.type, body = a.body || '';
    if (a.type === 'CALL') head = 'Call — ' + (CALL_WORD[m.outcome] || 'logged');
    if (a.type === 'EMAIL') head = m.outcome === 'NOT_SENT_EMAIL_NOT_CONNECTED' ? 'Email written (email not connected — not sent)' : 'Email sent';
    if (a.type === 'WHATSAPP') head = 'WhatsApp message';
    if (a.type === 'STATUS') { head = `Moved to ${STAGE_WORD[m.to] || m.to}`; if (m.auto) body = 'automatically, after the first contact'; }
    if (a.type === 'FOLLOW_UP') head = m.at ? `Follow-up set for ${dayTime(m.at)}` : 'Follow-up cleared';
    if (a.type === 'ASSIGNED') { head = `Given to ${a.body}`; body = ''; }
    if (a.type === 'TRIAL_BOOKED') { head = `Trial booked — ${m.team || 'session'}, ${dayTime(m.at)}`; }
    if (a.type === 'TRIAL_RESULT') head = m.outcome === 'ATTENDED' ? `Came to the trial${m.level ? ' — recommended ' + m.level : ''}` : 'Did not come to the trial';
    if (a.type === 'LOST') head = 'Not joining';
    if (a.type === 'CONVERTED') head = `Registered${m.reference ? ' — ' + m.reference : ''}`;
    if (a.type === 'EDITED') { head = 'Details edited'; body = (m.fields || []).join(', '); }
    if (a.type === 'CREATED') { head = `Enquiry received — ${SOURCE_WORD[m.source] || m.source || ''}`; }
    return `<div class="ev"><b>${esc(head)}</b>${body ? `<div style="white-space:pre-wrap;margin:2px 0">${esc(body)}</div>` : ''}<span>${esc(a.by || (a.type === 'CREATED' ? 'Website' : ''))} · ${dmyt(a.at)}</span></div>`;
  };
  // Comments as the desk writes them, each with its date — calls, WhatsApps and notes; no system events.
  const notes = timeline.filter((a) => NOTE_TYPES.includes(a.type) && (a.body || a.type === 'CALL' || a.type === 'WHATSAPP'));
  openDrawer(`${l.playerName} — ${l.reference}`, `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div><div style="font-size:18px;font-weight:700">${esc(l.playerName)} ${l.ageGroupLabel ? `<span class="chip">${esc(l.ageGroupLabel)}</span>` : ''}</div>
        <div class="mini">${l.playerDob ? 'Born ' + dmy(l.playerDob) : 'Date of birth not given'}${l.playerGender ? ' · ' + (l.playerGender === 'FEMALE' ? 'girl' : 'boy') : ''} · ${esc(SOURCE_WORD[l.source] || l.source)}${l.sourceDetail ? ' (' + esc(l.sourceDetail) + ')' : ''} · received ${dmyt(l.createdAt)}</div></div>
      <div style="text-align:right">${stagePill(l.status)}<div class="mini" style="margin-top:4px">${l.contactAttempts || 0} contact attempt${l.contactAttempts === 1 ? '' : 's'}</div></div>
    </div>
    <div class="card" style="padding:12px 14px;margin-top:12px;box-shadow:none">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div><b>${esc(l.guardianName)}</b>${l.isGuardian ? ' <span class="mini">parent / guardian</span>' : ''}
          <div class="mini"><a class="lnk2" href="tel:${esc(l.guardianMobile)}">${esc(fmtPhone(l.guardianMobile))}</a> · ${l.guardianEmail ? `<a class="lnk2" href="mailto:${esc(l.guardianEmail)}">${esc(l.guardianEmail)}</a>` : '<span style="color:var(--warn)">no email yet</span>'}</div></div>
        <div style="display:flex;gap:6px"><a class="btn sm ghost" href="${esc(waLink(l.guardianMobile, ''))}" target="_blank" rel="noopener">WhatsApp</a>
          <a class="btn sm ghost" href="tel:${esc(l.guardianMobile)}">Call</a></div>
      </div></div>
    ${fam ? `<div class="note good" style="margin-top:10px">This family is already registered: <b>${esc(fam.fullName)}</b> <span class="ref">${esc(fam.reference)}</span> · ${fam.children} child${fam.children === 1 ? '' : 'ren'} on file. Registering will add ${esc(first(l.playerName))} to the same parent, so the sibling discount applies.</div>` : ''}
    ${dup.length ? `<div class="note warn" style="margin-top:10px">Same mobile or email as ${dup.length} other enquir${dup.length === 1 ? 'y' : 'ies'}: ${dup.map((x) => `<a class="lnk2" data-act="openLead" data-a1="${x.id}">${esc(x.reference)}</a> ${esc(x.playerName)} (${esc(STAGE_WORD[x.status] || x.status)})`).join(', ')}</div>` : ''}
    ${l.status === 'REGISTERED' && l.player ? `<div class="note good" style="margin-top:10px">Joined — <a class="lnk2" data-act="openPlayer" data-a1="${l.player.id}">${esc(l.player.reference)} ${esc(l.player.firstName + ' ' + l.player.lastName)}</a></div>` : ''}
    ${l.status === 'LOST' ? `<div class="note" style="margin-top:10px;background:var(--surface-2)">Not joining: <b>${esc(l.lostReason || '—')}</b>${edit ? ` <button class="btn sm ghost" style="margin-left:8px" data-act="leadReopen">Reopen</button>` : ''}</div>` : ''}

    <div class="kv" style="margin-top:14px">
      <dt>Trial</dt><dd>${ts ? `<b>${dayTime(ts.startsAt)}–${hhmm(ts.endsAt)}</b> · ${esc(tt?.name || '')} ${tt ? lvlBadge(tt.level) : ''}<div class="mini">${esc(shortLoc(ts.location))}${l.trialOutcome ? ' · ' + ({ ATTENDED: '<b style="color:var(--good)">came</b>', ANOTHER_TRIAL: '<b style="color:var(--good)">came</b> — another trial needed', NO_SHOW: '<b style="color:var(--bad)">did not come</b>' }[l.trialOutcome] || '') : ''}</div>${l.trialFeedback ? `<div class="mini">Coach: ${esc(l.trialFeedback)}</div>` : ''}`
        : l.trialDate ? `${dayTime(l.trialDate)}${l.venueLabel ? ' · ' + esc(l.venueLabel) : ''}` : '<span class="mini">not booked</span>'}</dd>
      ${ts || l.trialDate ? `<dt>Trial coach</dt><dd>${esc(LD.d.trialCoach?.name || '—')}${l.trialConfirmed ? ' · <span style="color:var(--good)">parent confirmed</span>' : ''}
        ${can('evaluation.create') && l.trialOutcome !== 'NO_SHOW' && l.status !== 'LOST' ? ` <button class="btn sm ghost" style="margin-left:6px" data-act="evalOpen" data-a1="${l.id}">${(LD.d.evaluations || []).length ? 'Add an evaluation' : 'Evaluate the trial'}</button>` : ''}</dd>` : ''}
      ${l.followUpOutcome ? `<dt>Follow-up</dt><dd>${esc(l.followUpOutcome)}</dd>` : ''}
      <dt>Next follow-up</dt><dd>${open ? followUpCell(l) : '<span class="mini">—</span>'}</dd>
      <dt>Team member</dt><dd>${edit ? `<select class="sel" id="ld-owner" style="max-width:240px">${opt('', 'Not assigned')}${(LEADS_OWNERS || []).map((o) => opt(o.id, o.fullName, l.assignedToId === o.id)).join('')}</select>` : esc(assignedTo?.fullName || 'Not assigned')}</dd>
      ${l.level ? `<dt>Level</dt><dd>${esc(l.level)}</dd>` : ''}
    </div>

    ${edit && open ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">${next}
      ${l.status !== 'TRIAL_BOOKED' ? '' : '<button class="btn ghost" data-act="leadPanel" data-a1="trial">Move the trial</button>'}
      ${['TRIAL_ATTENDED', 'OFFER_MADE'].includes(l.status) ? '' : `<button class="btn ghost" data-act="leadRegister">Register now</button>`}
      ${l.status === 'TRIAL_ATTENDED' ? '<button class="btn ghost" data-act="leadStage" data-a1="OFFER_MADE">Thinking about it</button>' : ''}
      <button class="btn ghost" data-act="leadPanel" data-a1="lost">Not joining</button></div>` : ''}
    ${edit && l.status === 'REGISTERED' ? `<div style="margin-top:12px"><button class="btn sm ghost" data-act="leadRegister">Register a brother or sister from this enquiry</button></div>` : ''}
    <div id="ld-panel"></div>

    ${edit ? `<div class="sec"><h3>Log contact <span class="cnt">pick one, then save — with or without a comment</span></h3>
      <div class="chips logchips" role="radiogroup" aria-label="What happened">
        ${LOG_CHIPS.map(([type, outcome, word], i) => `<button class="chipbtn logchip ${LD.pick === i ? 'on' : ''}" role="radio" aria-checked="${LD.pick === i}" data-act="leadPick" data-a1="${i}"><span class="tick">✓</span>${esc(word)}</button>`).join('')}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
        <select class="sel" id="ld-quick" style="max-width:100%;flex:1 1 260px"><option value="">Quick note — choose a standard follow-up…</option>${(LD.outcomes || []).map((o) => opt(o, o, l.followUpOutcome === o)).join('')}</select></div>
      <textarea class="in" id="ld-note" rows="2" style="margin-top:8px" placeholder="Comment (optional) — what was said, what they asked for…"></textarea>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <label class="lbl" for="ld-fu" style="margin:0">Next follow-up</label>
        <input class="in" type="datetime-local" id="ld-fu" style="max-width:210px" value="${open ? localInput(l.nextFollowUpAt) : ''}" ${open ? '' : 'disabled'}>
        ${open ? `<button class="chipbtn" data-act="leadFuQuick" data-a1="1">Tomorrow</button><button class="chipbtn" data-act="leadFuQuick" data-a1="3">In 3 days</button><button class="chipbtn" data-act="leadFuQuick" data-a1="7">Next week</button><button class="chipbtn" data-act="leadFuQuick" data-a1="">None</button>` : ''}
        <button class="btn sm" style="margin-left:auto" id="ld-save" data-act="leadComment">Save</button></div></div>

    <div class="sec"><h3>Send a message</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="sel" id="ld-tpl" style="max-width:240px">${opt('', 'Choose a ready-made message…')}${(LD.templates || []).map((t) => opt(t.key, t.label)).join('')}</select>
        <span class="mini">Edit it before sending if you like.</span></div>
      <input class="in" id="ld-subj" style="margin-top:8px;display:none" placeholder="Email subject">
      <textarea class="in" id="ld-msg" rows="4" style="margin-top:8px" placeholder="Message"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <a class="btn sm" id="ld-wa" href="#" target="_blank" rel="noopener" data-act="leadWaSent">Open in WhatsApp</a>
        <button class="btn sm ghost" data-act="leadEmail" ${l.guardianEmail ? '' : 'disabled title="Add the parent\'s email first"'}>Send by email</button></div>
      <div class="mini" style="margin-top:6px">WhatsApp opens on this computer with the message ready — press send there. It is logged here as a contact.</div></div>` : ''}

    ${(LD.d.evaluations || []).length ? `<div class="sec"><h3>Coach's evaluation <span class="cnt">${LD.d.evaluations.length}</span></h3>${LD.d.evaluations.map(evalCard).join('')}</div>` : ''}
    <div class="sec"><h3>Comments <span class="cnt">${notes.length}</span></h3>${notes.map(noteRow).join('') || '<div class="mini">No comments yet.</div>'}</div>
    ${edit ? `<div class="sec"><button class="btn sm ghost" data-act="leadPanel" data-a1="edit">Edit details</button></div>` : ''}`, true);
  wireLead();
  if (LD.panel) renderLeadPanel();
}

async function wireLead() {
  const l = LD.d.lead;
  const own = $('ld-owner');
  if (own) own.addEventListener('change', async () => {
    try { await api(`/leads/${l.id}/assign`, { method: 'PATCH', body: JSON.stringify({ assignedToId: own.value || null }) }); toast('Assigned'); leadRefresh(); }
    catch (e) { toast(e.message); }
  });
  const msg = $('ld-msg'), wa = $('ld-wa'), tpl = $('ld-tpl');
  if (!msg) return;
  const syncWa = () => { wa.href = waLink(l.guardianMobile, msg.value); };
  msg.addEventListener('input', syncWa); syncWa();
  if (!LEAD_OUTCOMES) { try { LEAD_OUTCOMES = (await api('/leads/outcomes')).outcomes; } catch { LEAD_OUTCOMES = []; } }
  if (!LD.outcomes) { LD.outcomes = LEAD_OUTCOMES; const q = $('ld-quick'); if (q) q.innerHTML = '<option value="">Quick note — choose a standard follow-up…</option>' + LEAD_OUTCOMES.map((o) => opt(o, o, l.followUpOutcome === o)).join(''); }
  if (!LD.templates) { try { LD.templates = (await api('/leads/templates')).templates; tpl.innerHTML = opt('', 'Choose a ready-made message…') + LD.templates.map((t) => opt(t.key, t.label)).join(''); } catch {} }
  tpl.addEventListener('change', async () => {
    if (!tpl.value) return;
    try { const c = await api(`/leads/${l.id}/compose`, { method: 'POST', body: JSON.stringify({ template: tpl.value }) });
      msg.value = c.text; $('ld-subj').value = c.subject; $('ld-subj').style.display = c.canEmail ? '' : 'none'; syncWa(); }
    catch (e) { toast(e.message); }
  });
}
const ldFollowUp = () => { const v = $('ld-fu')?.value; return v ? new Date(v).toISOString() : null; };
ACT.leadFuQuick = (n) => { $('ld-fu').value = n === '' ? '' : localInput(inDays(Number(n))); };
const LOG_CHIPS = [['CALL', 'ANSWERED', 'Called — spoke to them'], ['CALL', 'NO_ANSWER', 'Called — no answer'], ['CALL', 'BUSY', 'Called — busy / call back'],
  ['WHATSAPP', 'SENT', 'WhatsApp sent'], ['EMAIL', 'SENT', 'Email sent'], ['CALL', 'WRONG_NUMBER', 'Wrong number']];
const NOTE_TYPES = ['COMMENT', 'CALL', 'WHATSAPP', 'EMAIL', 'SMS', 'TRIAL_RESULT', 'LOST'];
const NOTE_HEAD = { CALL: (m) => 'Called — ' + (CALL_WORD[m.outcome] || 'logged'), WHATSAPP: () => 'WhatsApp', EMAIL: (m) => m.outcome === 'NOT_SENT_EMAIL_NOT_CONNECTED' ? 'Email (not sent — email not connected)' : 'Email',
  SMS: () => 'SMS', TRIAL_RESULT: (m) => m.outcome === 'ATTENDED' ? 'After the trial' : 'Trial — did not come', LOST: () => 'Not joining', COMMENT: () => '' };
const noteRow = (a) => {
  const head = (NOTE_HEAD[a.type] || (() => ''))(a.meta || {});
  return `<div class="cmt"><div class="who"><b style="color:var(--ink)">${dmyt(a.at)}</b> · ${esc(a.by || 'Website')}${head ? ` · <span style="color:var(--coral)">${esc(head)}</span>` : ''}</div>${a.body ? `<div style="white-space:pre-wrap">${esc(a.body)}</div>` : ''}</div>`;
};
const EVAL_WORD = { DEVELOPMENT: 'Development', ADVANCED: 'Advanced', HPC: 'HPC', ADV_INVITE: 'Advanced invitation', NOT_READY: 'Not ready yet' };
const RATING_KEYS = [['technical', 'Technical'], ['tactical', 'Tactical'], ['physical', 'Physical'], ['attitude', 'Attitude']];
const evalCard = (e) => `<div class="card" style="padding:12px 14px;margin-bottom:8px;box-shadow:none">
  <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(EVAL_WORD[e.recommendation] || e.recommendation)}${e.anotherTrial ? ' · wants to see them again' : ''}</b><span class="mini">${esc(e.by || '')} · ${dmyt(e.createdAt || e.at)}</span></div>
  ${e.ratings ? `<div class="mini" style="margin-top:4px">${RATING_KEYS.filter(([k]) => e.ratings[k]).map(([k, w]) => `${w} <b style="color:var(--ink)">${e.ratings[k]}/5</b>`).join(' · ')}</div>` : ''}
  ${e.strengths ? `<div style="margin-top:4px"><span class="mini">Strengths:</span> ${esc(e.strengths)}</div>` : ''}${e.toImprove || e.to_improve ? `<div><span class="mini">To work on:</span> ${esc(e.toImprove || e.to_improve)}</div>` : ''}
  ${e.recommendedTeam ? `<div class="mini">Recommended team: ${esc(e.recommendedTeam)}</div>` : ''}</div>`;
ACT.leadPick = (i) => {
  i = Number(i); LD.pick = LD.pick === i ? null : i;
  document.querySelectorAll('.logchip').forEach((b, k) => { const on = LD.pick === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  const b = document.querySelectorAll('.logchip')[i]; if (b && LD.pick === i) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
};
ACT.leadComment = async () => {
  const l = LD.d.lead, open = OPEN_STAGES.includes(l.status);
  const pick = LD.pick != null ? LOG_CHIPS[LD.pick] : null;
  const quick = $('ld-quick')?.value || '';
  const typed = $('ld-note').value.trim();
  const body = [quick, typed].filter(Boolean).join(' — ');
  const fuRaw = ldFollowUp();
  const fuChanged = open && (fuRaw || null) !== (l.nextFollowUpAt ? new Date(l.nextFollowUpAt).toISOString() : null);
  if (!pick && !body && !fuChanged) return toast('Pick what happened, write a comment, or change the follow-up');
  const btn = $('ld-save'); if (btn) btn.disabled = true;
  try {
    let d;
    if (pick) {
      // A no-answer / busy call with no follow-up chosen: try again tomorrow.
      const fu = fuChanged ? fuRaw : (open && ['NO_ANSWER', 'BUSY'].includes(pick[1]) && !fuRaw ? inDays(1).toISOString() : undefined);
      d = await api(`/leads/${l.id}/activities`, { method: 'POST', body: JSON.stringify({ type: pick[0], outcome: pick[1], body: body || undefined, nextFollowUpAt: open ? fu : undefined }) });
    } else if (body) d = await api(`/leads/${l.id}/activities`, { method: 'POST', body: JSON.stringify({ type: 'COMMENT', body, ...(fuChanged ? { nextFollowUpAt: fuRaw } : {}) }) });
    else d = await api(`/leads/${l.id}/follow-up`, { method: 'PATCH', body: JSON.stringify({ at: fuRaw }) });
    if (quick && quick !== l.followUpOutcome && can('lead.edit')) await api(`/leads/${l.id}/trial-sheet`, { method: 'PATCH', body: JSON.stringify({ followUpOutcome: quick, logComment: false }) }).catch(() => {});
    LD.pick = null;
    toast(pick ? `Saved — ${pick[2].toLowerCase()}` : body ? 'Comment saved' : 'Follow-up saved');
    leadRefresh(quick ? null : d);
  } catch (e) { toast(e.message); if (btn) btn.disabled = false; }
};
ACT.leadWaSent = async () => {
  const text = $('ld-msg').value.trim();
  if (!text) return;   // nothing written: WhatsApp just opens the chat
  try { const d = await api(`/leads/${LD.d.lead.id}/message`, { method: 'POST', body: JSON.stringify({ channel: 'WHATSAPP', text, template: $('ld-tpl').value || undefined, nextFollowUpAt: ldFollowUp() ?? undefined }) });
    leadRefresh(d); }
  catch (e) { toast(e.message); }
};
ACT.leadEmail = async () => {
  const text = $('ld-msg').value.trim(); if (!text) return toast('Write the message first');
  try { const d = await api(`/leads/${LD.d.lead.id}/message`, { method: 'POST', body: JSON.stringify({ channel: 'EMAIL', text, subject: $('ld-subj').value.trim() || undefined, template: $('ld-tpl').value || undefined, nextFollowUpAt: ldFollowUp() ?? undefined }) });
    toast(d.emailed?.simulated ? 'Email isn\'t connected yet — saved to the Email log, not sent' : 'Email sent'); leadRefresh(d); }
  catch (e) { toast(e.message); }
};
ACT.leadStage = async (s) => {
  try { await api(`/leads/${LD.d.lead.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: s }) }); toast('Moved to ' + STAGE_WORD[s]); leadRefresh(); }
  catch (e) { toast(e.message); }
};
ACT.leadReopen = () => ACT.leadStage('CONTACTED');
ACT.leadPanel = async (p) => { LD.panel = LD.panel === p ? null : p; renderLeadPanel(); };

async function renderLeadPanel() {
  const box = $('ld-panel'); if (!box) return;
  const l = LD.d.lead, p = LD.panel;
  if (!p) { box.innerHTML = ''; return; }
  const card = (h, inner) => `<div class="card" style="padding:14px;margin-top:12px;box-shadow:none;border-color:var(--coral)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>${h}</b><button class="btn sm ghost" data-act="leadPanel" data-a1="${p}">Close</button></div>${inner}</div>`;
  if (p === 'trial') {
    box.innerHTML = card('Book a free trial', '<div class="loading">Finding sessions…</div>');
    try {
      const slots = await api(`/leads/${l.id}/trial-slots`);
      const byDay = new Map();
      for (const s of slots) { const k = dubaiDay(s.startsAt); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); }
      box.innerHTML = card('Book a free trial', `<div class="mini" style="margin-bottom:8px">Training sessions in the next three weeks for ${l.ageGroupLabel ? `<b>${esc(l.ageGroupLabel)}</b>` : 'every category (add the date of birth to narrow this down)'}. The child appears on that session's register for the coach.</div>
        ${[...byDay.entries()].map(([day, list]) => `<div style="margin-top:10px"><div class="mini" style="font-weight:700;color:var(--ink)">${new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          ${list.map((s) => `<div class="lookup-hit" style="margin:6px 0 0"><div><b>${hhmm(s.startsAt)}–${hhmm(s.endsAt)}</b> ${esc(s.team)} ${lvlBadge(s.level)}<div class="mini">${esc(shortLoc(s.location))}${s.trialsBooked ? ` · ${s.trialsBooked} trial${s.trialsBooked === 1 ? '' : 's'} already booked` : ''}</div></div>
            <button class="btn sm ${l.trialSessionId === s.id ? 'ghost' : ''}" data-act="leadBook" data-a1="${s.id}" ${l.trialSessionId === s.id ? 'disabled' : ''}>${l.trialSessionId === s.id ? 'Booked' : 'Book'}</button></div>`).join('')}</div>`).join('')
        || '<div class="empty">No training sessions in the next three weeks for this category. Check the Schedule page.</div>'}`);
    } catch (e) { box.innerHTML = card('Book a free trial', `<div class="note bad">${esc(e.message)}</div>`); }
  } else if (p === 'result') {
    box.innerHTML = card('How did the trial go?', `<div class="frm">
      <div class="full"><label class="lbl" for="ld-fb">Coach's feedback</label><textarea class="in" id="ld-fb" rows="2" placeholder="Strengths, what to work on, the group that suits them">${esc(l.trialFeedback || '')}</textarea></div>
      <div><label class="lbl" for="ld-lvl">Recommended level</label><select class="sel" id="ld-lvl">${opt('', '—')}${['DEVELOPMENT', 'ADVANCED', 'HPC'].map((k) => opt(LEVEL_WORD[k], LEVEL_WORD[k], (l.level || '').toUpperCase() === k)).join('')}</select></div></div>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" data-act="leadResult" data-a1="ATTENDED">They came</button><button class="btn ghost" data-act="leadResult" data-a1="NO_SHOW">They didn't come</button></div>
      <div class="mini" style="margin-top:6px">Either way a follow-up is set for tomorrow.</div>`);
  } else if (p === 'lost') {
    box.innerHTML = card('Not joining', `<div class="opts" style="grid-template-columns:1fr 1fr">${LOST_REASONS.map((r) => `<button class="opt" data-act="leadLostPick" data-a1="${esc(r)}"><span class="t" style="font-size:13px">${esc(r)}</span></button>`).join('')}</div>
      <textarea class="in" id="ld-lostnote" rows="2" style="margin-top:10px" placeholder="Anything to add (optional)"></textarea>
      <div class="row-end"><button class="btn danger" data-act="leadLost">Mark as not joining</button></div>`);
  } else if (p === 'edit') {
    box.innerHTML = card('Edit details', `<div class="frm">
      ${fld('Parent name', 'le-gn', l.guardianName)}${fld('Mobile', 'le-gm', l.guardianMobile, 'type="tel"')}
      ${fld('Email', 'le-ge', l.guardianEmail || '', 'type="email"', true)}
      ${fld('Child name', 'le-pn', l.playerName)}${fld('Date of birth', 'le-dob', l.playerDob || '', 'type="date"')}
      <div><label class="lbl" for="le-gender">Boy or girl</label><select class="sel" id="le-gender">${opt('', '—')}${opt('MALE', 'Boy', l.playerGender === 'MALE')}${opt('FEMALE', 'Girl', l.playerGender === 'FEMALE')}</select></div>
      <div><label class="lbl" for="le-src">Source</label><select class="sel" id="le-src">${LEAD_SOURCES.map(([k, t]) => opt(k, t, l.source === k)).join('')}</select></div></div>
      <div class="row-end"><button class="btn" data-act="leadSaveEdit">Save</button></div>`);
  }
}
ACT.leadBook = async (sid) => {
  try { const d = await api(`/leads/${LD.d.lead.id}/trial`, { method: 'POST', body: JSON.stringify({ sessionId: sid }) });
    LD.panel = null; toast('Trial booked — send the confirmation below'); await leadRefresh(d);
    const t = $('ld-tpl'); if (t) { t.value = 'trial_confirmation'; t.dispatchEvent(new Event('change')); } }
  catch (e) { toast(e.message); }
};
ACT.leadResult = async (outcome) => {
  try { const d = await api(`/leads/${LD.d.lead.id}/trial-result`, { method: 'POST', body: JSON.stringify({ outcome, feedback: $('ld-fb').value.trim() || undefined, recommendedLevel: $('ld-lvl').value || undefined }) });
    LD.panel = null; toast(outcome === 'ATTENDED' ? 'Trial recorded' : 'Recorded as no-show — moved back to Contacted'); await leadRefresh(d);
    const t = $('ld-tpl'); if (t && outcome === 'ATTENDED') { t.value = 'after_trial'; t.dispatchEvent(new Event('change')); } }
  catch (e) { toast(e.message); }
};
let LOST_PICK = '';
ACT.leadLostPick = (r) => { LOST_PICK = r; document.querySelectorAll('[data-act="leadLostPick"]').forEach((b) => b.classList.toggle('on', b.dataset.a1 === r)); };
ACT.leadLost = async () => {
  const note = $('ld-lostnote').value.trim();
  const reason = [LOST_PICK, note].filter(Boolean).join(' — ');
  if (!reason) return toast('Choose a reason');
  try { await api(`/leads/${LD.d.lead.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'LOST', reason }) });
    LD.panel = null; LOST_PICK = ''; toast('Marked as not joining'); leadRefresh(); }
  catch (e) { toast(e.message); }
};
ACT.leadSaveEdit = async () => {
  const body = { guardianName: $('le-gn').value.trim(), guardianMobile: $('le-gm').value.trim(), guardianEmail: $('le-ge').value.trim() || null,
    playerName: $('le-pn').value.trim(), source: $('le-src').value };
  if ($('le-dob').value) body.playerDob = $('le-dob').value;
  if ($('le-gender').value) body.playerGender = $('le-gender').value;
  try { await api(`/leads/${LD.d.lead.id}`, { method: 'PATCH', body: JSON.stringify(body) }); LD.panel = null; toast('Saved'); leadRefresh(); }
  catch (e) { toast(e.message); }
};

// ---------- add an enquiry by hand ----------
ACT.leadNew = () => {
  openDrawer('Add an enquiry', `<p class="mini" style="margin-bottom:12px">For a phone call, walk-in or chat. Website pop-up requests arrive here by themselves.</p>
    <div class="frm">
      ${fld('Parent name *', 'ln-gn', '')}${fld('Mobile *', 'ln-gm', '', 'type="tel" placeholder="050 123 4567"')}
      ${fld('Email', 'ln-ge', '', 'type="email"', true)}
      ${fld('Child name *', 'ln-pn', '')}${fld('Date of birth', 'ln-dob', '', 'type="date"')}
      <div><label class="lbl" for="ln-gender">Boy or girl</label><select class="sel" id="ln-gender">${opt('', '—')}${opt('MALE', 'Boy')}${opt('FEMALE', 'Girl')}</select></div>
      <div><label class="lbl" for="ln-src">How did they hear about us?</label><select class="sel" id="ln-src">${LEAD_SOURCES.map(([k, t]) => opt(k, t, k === 'ENQUIRY')).join('')}</select></div>
      <div class="full"><label class="lbl" for="ln-notes">Notes</label><textarea class="in" id="ln-notes" rows="2" placeholder="What they asked about"></textarea></div></div>
    <div id="ln-err" style="margin-top:10px"></div>
    <div class="row-end"><button class="btn" data-act="leadCreate">Add enquiry</button></div>`);
  $('ln-gn').focus();
};
ACT.leadCreate = async () => {
  const body = { guardianName: $('ln-gn').value.trim(), guardianMobile: $('ln-gm').value.trim(), guardianEmail: $('ln-ge').value.trim() || undefined,
    playerName: $('ln-pn').value.trim(), playerDob: $('ln-dob').value || undefined, playerGender: $('ln-gender').value || undefined,
    source: $('ln-src').value, notes: $('ln-notes').value.trim() || undefined };
  if (!body.guardianName || !body.guardianMobile || !body.playerName) { $('ln-err').innerHTML = '<div class="note bad">Parent name, mobile and child name are needed.</div>'; return; }
  try { const l = await api('/leads', { method: 'POST', body: JSON.stringify(body) }); toast('Enquiry ' + l.reference + ' added');
    if (CURRENT === 'leads') loadLeads(); window.openLead(l.id); }
  catch (e) { $('ln-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

// ---------- message templates ----------
ACT.leadTemplates = async () => {
  try {
    const { templates } = await api('/leads/templates');
    openDrawer('Message templates', `<p class="mini" style="margin-bottom:12px">These fill in by themselves: {{parent}}, {{child}}, {{staff}}, {{trialDay}}, {{trialTime}}, {{team}}, {{venue}}, {{level}}.</p>
      ${templates.map((t, i) => `<div class="card" style="padding:12px;margin-bottom:10px;box-shadow:none"><div class="frm">
        ${fld('Name', 'tp-l' + i, t.label)}${fld('Email subject', 'tp-s' + i, t.subject)}
        <div class="full"><label class="lbl" for="tp-t${i}">Message</label><textarea class="in" id="tp-t${i}" rows="4">${esc(t.text)}</textarea></div></div>
        <input type="hidden" id="tp-k${i}" value="${esc(t.key)}"></div>`).join('')}
      <div class="row-end"><button class="btn" data-act="leadTplSave" data-a1="${templates.length}">Save templates</button></div>`, true);
  } catch (e) { toast(e.message); }
};
ACT.leadTplSave = async (n) => {
  const templates = [];
  for (let i = 0; i < Number(n); i++) templates.push({ key: $('tp-k' + i).value, label: $('tp-l' + i).value.trim(), subject: $('tp-s' + i).value.trim(), text: $('tp-t' + i).value.trim() });
  try { await api('/leads/templates', { method: 'PUT', body: JSON.stringify({ templates }) }); if (LD) LD.templates = null; toast('Templates saved'); closeDrawer(); }
  catch (e) { toast(e.message); }
};

// ---------- convert: Register a child, filled in from the lead ----------
ACT.leadRegister = async () => {
  const { lead: l, existingFamily: fam, trialTeam: tt } = LD.d;
  await loadLookups();
  const second = l.status === 'REGISTERED';
  REG = newReg(false);
  REG.leadId = l.id; REG.leadRef = l.reference; REG.leadName = l.playerName;
  REG.query = l.guardianMobile;
  REG.newGuardian = { ...REG.newGuardian, fullName: l.guardianName, email: l.guardianEmail || '', mobile: l.guardianMobile };
  REG.gMode = 'new';
  try {
    const hits = await api('/registration/guardian-lookup?q=' + encodeURIComponent(l.guardianMobile));
    const g = hits.find((h) => h.id === (fam?.id || l.existingGuardianId)) || (hits.length === 1 ? hits[0] : null);
    if (g) { REG.guardian = g; REG.gMode = 'find'; } else REG.hits = hits;
  } catch { /* lookup is advisory */ }
  const names = String(l.playerName || '').trim().split(/\s+/);
  if (!second) {
    REG.child.firstName = names[0] || '';
    REG.child.lastName = names.slice(1).join(' ') || String(l.guardianName || '').trim().split(/\s+/).slice(1).join(' ');
    REG.child.dateOfBirth = l.playerDob || '';
    REG.child.gender = l.playerGender || '';
  } else REG.child.lastName = names.slice(1).join(' ');
  REG.child.emergencyContactName = l.guardianName; REG.child.emergencyContactPhone = l.guardianMobile;
  if (REG.child.dateOfBirth) { try { REG.placement = await api('/registration/placement?dob=' + REG.child.dateOfBirth); } catch {} }
  const lvl = String(l.level || '').toUpperCase();
  if (['DEVELOPMENT', 'ADVANCED', 'HPC'].includes(lvl)) REG.level = lvl;
  if (tt && !second) { REG.level = REG.level || tt.level; if (tt.level === REG.level) REG.teamId = tt.id; }
  closeDrawer();
  go('register');
};

// ================= registration =================
// Four steps, nothing saved until Confirm: an abandoned registration leaves no
// half-made family behind. The parent is found before one is created, because
// duplicate parents were the root of most billing mix-ups in the legacy data.
const REG_STEPS = [
  ['Parent', 'Find or add'], ['Child', 'Details and category'], ['Placement', 'Level and team'],
  ['Term and extras', 'Price and confirm'], ['Done', 'Registered'],
];
let REG = null;

function newReg(keepGuardian) {
  const prev = REG;
  return {
    step: keepGuardian ? 2 : 1,
    gMode: 'find', hits: [], query: '',
    guardian: keepGuardian ? prev.guardian : null,
    newGuardian: { fullName: '', relationship: 'Father', email: '', mobile: '', emirate: 'Abu Dhabi', city: '' },
    child: { firstName: '', lastName: keepGuardian ? prev.child.lastName : '', dateOfBirth: '', gender: '',
      kitSize: '', previousAcademy: '', medicalNotes: '', emergencyContactName: '', emergencyContactPhone: '' },
    placement: null, manualAgeGroupId: '',
    level: null, teamId: null, showAllTeams: false,
    addTerm: true, purchase: newPurchase(), issue: true, quote: null, plan: { on: false, rows: [] },
    playerId: null, result: null, busy: false, error: '',
    kids: [],   // brothers and sisters already filled in on this registration (one family invoice)
  };
}

VIEWS.register = async () => {
  await loadLookups();
  if (!REG || REG.result) REG = newReg(false);
  renderReg();
};
ACT.regSibling = () => { const lead = REG && { leadId: REG.leadId, leadRef: REG.leadRef, leadName: REG.leadName }; REG = newReg(true); if (lead?.leadId) Object.assign(REG, lead); renderReg(); };
ACT.regFresh = () => { REG = newReg(false); renderReg(); };

const regCat = () => {
  if (REG.manualAgeGroupId) return LK.ageGroups.find((a) => a.id === REG.manualAgeGroupId) || null;
  return REG.placement?.ageGroupId ? LK.ageGroups.find((a) => a.id === REG.placement.ageGroupId) || null : null;
};
const regGuardianName = () => REG.guardian ? REG.guardian.fullName : (REG.newGuardian.fullName || 'New parent');

function renderReg() {
  $('page-title').textContent = 'Register a child';
  $('page-acts').innerHTML = '';
  $('view').innerHTML = `${REG.leadId ? `<div class="note info" style="margin-bottom:12px">Registering from enquiry <b>${esc(REG.leadRef)}</b> (${esc(REG.leadName)}) — the details are filled in from the lead; check them as you go. ${REG.result ? '' : '<a class="lnk2" data-act="regFresh">Start blank instead</a>'}</div>` : ''}<div class="reg">
    <div class="card steps">${REG_STEPS.map(([t, s], i) => {
      const n = i + 1, cls = n === REG.step ? 'on' : (n < REG.step && !REG.result ? 'done' : '');
      return `<div class="step ${cls}" ${cls === 'done' ? `data-act="regGoto" data-a1="${n}"` : ''}><span class="n">${n < REG.step ? '✓' : n}</span><span>${t}<span class="s2">${s}</span></span></div>`;
    }).join('')}</div>
    <div class="card rbody" id="reg-body"></div>
    <div class="card rsum" id="reg-sum"></div></div>`;
  ({ 1: regStep1, 2: regStep2, 3: regStep3, 4: regStep4, 5: regStep5 })[REG.step]();
  renderRegSummary();
}
ACT.regGoto = (n) => { n = Number(n); if (n < REG.step && !REG.result) { REG.step = n; REG.error = ''; renderReg(); } };
ACT.regBack = () => { if (REG.step > 1) { REG.step--; REG.error = ''; renderReg(); } };

function renderRegSummary() {
  const c = REG.child, cat = regCat(), team = LK.teams.find((t) => t.id === REG.teamId);
  const pu = REG.purchase;
  const it = (k, v) => `<div class="it"><div class="k">${k}</div>${v}</div>`;
  const fq = REG.familyQuote;
  const kidLine = (k, i) => {
    const q = fq?.children?.find((x) => x.key === 'k' + i);
    const kc = k.cat;
    return `<div class="kidrow"><div><b>${esc(k.child.firstName + ' ' + k.child.lastName)}</b> ${kc ? `<span class="chip">${esc(kc.code)}</span>` : ''}
      <div class="mini">${k.addTerm && k.purchase.package ? esc(PK_SHORT[k.purchase.package]) + (k.purchase.spw ? ` · ${k.purchase.spw}/wk` : '') : 'not enrolling yet'}${q?.position ? ` · ${esc(q.position)} child${q.manualDiscount ? ' · ' + esc(q.manualDiscount.label) : q.siblingDiscount ? ` · <b style="color:var(--good)">${q.siblingDiscount.percent}% off</b>` : ' · full price'}` : ''}</div></div>
      ${REG.result ? '' : `<a class="lnk2 mini" data-act="regRemoveKid" data-a1="${i}">Remove</a>`}</div>`;
  };
  $('reg-sum').innerHTML = `<h4>Summary</h4>
    ${REG.kids.length ? it(`Children on this registration <span class="cnt">${REG.kids.length + (REG.result ? 0 : 1)}</span>`, REG.kids.map(kidLine).join('') + (REG.result ? '' : `<div class="mini" style="margin-top:4px">+ ${esc(c.firstName || 'the child being added now')} (below)</div>`)) : ''}
    ${it('Parent', REG.guardian ? `<b>${esc(REG.guardian.fullName)}</b> <span class="ref">${esc(REG.guardian.reference)}</span>` : (REG.step > 1 ? `<b>${esc(REG.newGuardian.fullName)}</b> <span class="pill p-info">new</span>` : '<span class="mini">—</span>'))}
    ${it('Child', c.firstName ? `<b>${esc(c.firstName + ' ' + c.lastName)}</b><div class="mini">${c.dateOfBirth ? 'born ' + dt(c.dateOfBirth) : ''}</div>` : '<span class="mini">—</span>')}
    ${it('Category', cat ? `<span class="chip">${esc(cat.code)}</span>${REG.placement?.playedUp ? ' <span class="mini">plays up</span>' : ''}` : '<span class="mini">—</span>')}
    ${it('Placement', REG.level ? `${lvlBadge(REG.level)} ${team ? `<div><b>${esc(team.name)}</b></div><div class="mini">${esc(team.schedule)}</div>` : '<div class="mini">team to be chosen later</div>'}` : '<span class="mini">—</span>')}
    ${it('Term', REG.addTerm ? (pu.package && REG.step >= 4 ? `${esc(PK_SHORT[pu.package])}${pu.spw ? `<div class="mini">${pu.spw} session${pu.spw === 1 ? '' : 's'} a week</div>` : ''}` : '<span class="mini">—</span>') : '<span class="mini">not enrolling yet</span>')}
    ${REG.addTerm && REG.quote?.ok && REG.quote.extras?.length ? it('Extras', REG.quote.extras.map((x) => esc(x.name)).join('<br>')) : ''}
    ${fq && REG.kids.length && fq.ok ? it('Family invoice', `<b>${money(fq.total)}</b>${fq.siblingSavings ? `<div class="mini" style="color:var(--good)">sibling discount saves ${money(fq.siblingSavings)}</div>` : ''}${fq.manualSavings ? `<div class="mini" style="color:var(--good)">manual discounts ${money(fq.manualSavings)}</div>` : ''}`) : ''}
    ${it(REG.kids.length ? 'This child' : 'Total', REG.addTerm && REG.quote?.ok ? `<b>${money(REG.quote.grandTotal ?? REG.quote.total)}</b>${REG.quote.manualDiscount ? `<div class="mini" style="color:var(--good)">incl. ${esc(REG.quote.manualDiscount.label)} on training</div>` : REG.quote.siblingDiscount ? `<div class="mini" style="color:var(--good)">incl. ${REG.quote.siblingDiscount.percent}% sibling discount</div>` : ''}` : '<span class="mini">—</span>')}`;
}

// ---- step 1: parent ----
function regStep1() {
  const sel = REG.guardian;
  $('reg-body').innerHTML = `<h3>Who is the parent?</h3>
    <p class="lead">Search first — most families are already on file, and a second parent record for the same family causes billing mistakes.</p>
    ${sel ? `<div class="lookup-hit" style="border-color:var(--good);background:var(--good-wash)"><div><b>${esc(sel.fullName)}</b> <span class="ref">${esc(sel.reference)}</span>
        <div class="mini">${esc(sel.email)} · ${esc(fmtPhone(sel.mobile))} · ${sel.children} child${sel.children === 1 ? '' : 'ren'} on file</div></div>
        <button class="btn sm ghost" data-act="regClearParent">Change</button></div>`
    : `<input class="in" id="rg-q" placeholder="Phone, email, name or PR number" value="${esc(REG.query)}">
       <div id="rg-hits" style="margin-top:10px"></div>
       ${REG.gMode === 'new' ? regNewParentForm() : `<div style="margin-top:14px"><span class="mini">Not on file?</span> <button class="btn sm ghost" data-act="regNewParent">+ New parent</button></div>`}`}
    <div id="rg-err" style="margin-top:12px">${REG.error ? `<div class="note bad">${esc(REG.error)}</div>` : ''}</div>
    <div class="row-end"><button class="btn" data-act="regNext1">Continue</button></div>`;
  if (!sel) {
    let tmr;
    $('rg-q').addEventListener('input', (e) => { REG.query = e.target.value; clearTimeout(tmr); tmr = setTimeout(regLookup, 280); });
    if (REG.query) regLookup(); else $('rg-q').focus();
    if (REG.gMode === 'new') wireNewParentForm();
  }
}

function regNewParentForm() {
  const g = REG.newGuardian;
  return `<div class="card" style="padding:14px;margin-top:14px;box-shadow:none"><div class="frm">
    ${fld('Full name *', 'ng-name', g.fullName, '', true)}
    <div><label class="lbl" for="ng-rel">Relationship</label><select class="sel" id="ng-rel">${RELATIONS.map((r) => opt(r, r, g.relationship === r)).join('')}</select></div>
    ${fld('Mobile *', 'ng-mob', g.mobile, 'type="tel" placeholder="050 123 4567"')}
    ${fld('Email *', 'ng-mail', g.email, 'type="email"', true)}
    <div><label class="lbl" for="ng-emi">Emirate</label><select class="sel" id="ng-emi">${EMIRATES.map((x) => opt(x, x, g.emirate === x)).join('')}</select></div>
    ${fld('City / area', 'ng-city', g.city)}</div></div>`;
}
function wireNewParentForm() {
  const map = { 'ng-name': 'fullName', 'ng-rel': 'relationship', 'ng-mob': 'mobile', 'ng-mail': 'email', 'ng-emi': 'emirate', 'ng-city': 'city' };
  for (const [id, k] of Object.entries(map)) $(id).addEventListener('input', (e) => { REG.newGuardian[k] = e.target.value; renderRegSummary(); });
}

async function regLookup() {
  const q = (REG.query || '').trim(), box = $('rg-hits'); if (!box) return;
  if (q.length < 3) { box.innerHTML = ''; REG.hits = []; return; }
  try {
    REG.hits = await api('/registration/guardian-lookup?q=' + encodeURIComponent(q));
    box.innerHTML = REG.hits.length ? REG.hits.map((h, i) => `<div class="lookup-hit"><div><b>${esc(h.fullName)}</b> <span class="ref">${esc(h.reference)}</span>
        <div class="mini">${esc(h.email)} · ${esc(fmtPhone(h.mobile))} · ${h.children} child${h.children === 1 ? '' : 'ren'}</div></div>
        <button class="btn sm" data-act="regUseParent" data-a1="${i}">Use</button></div>`).join('')
      : '<div class="mini">No parent on file matches.</div>';
  } catch (e) { box.innerHTML = `<div class="mini">${esc(e.message)}</div>`; }
}

ACT.regUseParent = (i) => { REG.guardian = REG.hits[Number(i)]; REG.gMode = 'find'; REG.error = ''; renderReg(); };
ACT.regClearParent = () => { REG.guardian = null; renderReg(); };
ACT.regNewParent = () => { REG.gMode = 'new'; renderReg(); };

ACT.regNext1 = async () => {
  REG.error = '';
  if (REG.guardian) { REG.step = 2; return renderReg(); }
  if (REG.gMode !== 'new') { REG.error = 'Choose a parent from the search, or add a new one.'; return renderReg(); }
  const g = REG.newGuardian;
  g.fullName = g.fullName.trim(); g.email = g.email.trim().toLowerCase(); g.mobile = g.mobile.trim();
  if (!g.fullName || !g.mobile) { REG.error = 'Parent name and mobile are required.'; return renderReg(); }
  if (!/^\S+@\S+\.\S+$/.test(g.email)) { REG.error = 'Enter a valid email.'; return renderReg(); }
  // Last duplicate check before moving on.
  try {
    const [byMail, byPhone] = await Promise.all([
      api('/registration/guardian-lookup?q=' + encodeURIComponent(g.email)),
      api('/registration/guardian-lookup?q=' + encodeURIComponent(g.mobile)),
    ]);
    const mail = byMail.find((h) => h.email.toLowerCase() === g.email);
    if (mail) { REG.hits = [mail]; REG.query = g.email; REG.gMode = 'find'; REG.error = `${g.email} already belongs to ${mail.reference} ${mail.fullName} — use that parent.`; return renderReg(); }
    if (byPhone.length && !REG.phoneWarned) {
      REG.phoneWarned = true; REG.hits = byPhone;
      REG.error = `That mobile is already on file for ${byPhone.map((h) => h.reference + ' ' + h.fullName).join(', ')}. Use them, or press Continue again if this is a different family.`;
      REG.gMode = 'new'; return renderReg();
    }
  } catch { /* lookup is advisory */ }
  REG.step = 2; renderReg();
};

// ---- step 2: child ----
function regStep2() {
  const c = REG.child;
  if (!c.lastName && !REG.guardian && REG.newGuardian.fullName) c.lastName = REG.newGuardian.fullName.trim().split(/\s+/).slice(1).join(' ');
  if (!c.lastName && REG.guardian) c.lastName = REG.guardian.fullName.trim().split(/\s+/).slice(1).join(' ');
  $('reg-body').innerHTML = `<h3>${REG.kids.length ? `About the ${['', 'second', 'third', 'fourth', 'fifth', 'sixth'][REG.kids.length] || 'next'} child` : 'About the child'}</h3>
    ${REG.kids.length ? `<div class="note info" style="margin-bottom:10px">Same parent as ${REG.kids.map((k) => esc(k.child.firstName)).join(', ')} — all of them go on one invoice, with the sibling discount worked out across the family.</div>` : ''}
    <p class="lead">The age category comes from the date of birth — no one has to work it out.</p>
    <div class="frm">
      ${fld('First name *', 'ch-first', c.firstName)}${fld('Last name *', 'ch-last', c.lastName)}
      ${fld('Date of birth *', 'ch-dob', c.dateOfBirth, 'type="date"')}
      <div><span class="lbl">Gender *</span><div class="opts" style="grid-template-columns:1fr 1fr">
        <button class="opt ${c.gender === 'MALE' ? 'on' : ''}" data-act="regGender" data-a1="MALE"><span class="t">Boy</span></button>
        <button class="opt ${c.gender === 'FEMALE' ? 'on' : ''}" data-act="regGender" data-a1="FEMALE"><span class="t">Girl</span></button></div></div>
    </div>
    <div id="rg-cat" style="margin-top:14px"></div>
    <details style="margin-top:14px" ${c.kitSize || c.medicalNotes || c.previousAcademy ? 'open' : ''}><summary class="mini" style="cursor:pointer">More details (optional)</summary>
      <div class="frm" style="margin-top:10px">
        ${fld('Kit size', 'ch-kit', c.kitSize)}${fld('Previous academy', 'ch-prev', c.previousAcademy)}
        ${fld('Emergency contact', 'ch-ecn', c.emergencyContactName || regGuardianName())}
        ${fld('Emergency phone', 'ch-ecp', c.emergencyContactPhone || (REG.guardian?.mobile || REG.newGuardian.mobile))}
        <div class="full"><label class="lbl" for="ch-med">Medical notes / allergies</label><textarea class="in" id="ch-med">${esc(c.medicalNotes)}</textarea></div>
      </div></details>
    <div id="rg-err" style="margin-top:12px">${REG.error ? `<div class="note bad">${esc(REG.error)}</div>` : ''}</div>
    <div class="row-end"><button class="btn ghost" data-act="regBack">Back</button><button class="btn" data-act="regNext2">Continue</button></div>`;
  const map = { 'ch-first': 'firstName', 'ch-last': 'lastName', 'ch-kit': 'kitSize', 'ch-prev': 'previousAcademy', 'ch-ecn': 'emergencyContactName', 'ch-ecp': 'emergencyContactPhone', 'ch-med': 'medicalNotes' };
  for (const [id, k] of Object.entries(map)) $(id).addEventListener('input', (e) => { REG.child[k] = e.target.value; renderRegSummary(); });
  $('ch-dob').addEventListener('change', async (e) => { REG.child.dateOfBirth = e.target.value; REG.manualAgeGroupId = ''; await regPlace(); });
  renderRegCategory();
  if (!c.firstName) $('ch-first').focus();
}

async function regPlace() {
  const dob = REG.child.dateOfBirth;
  REG.placement = null; REG.level = null; REG.teamId = null;
  if (dob) { try { REG.placement = await api('/registration/placement?dob=' + dob); } catch (e) { REG.placement = { code: null, note: e.message }; } }
  renderRegCategory(); renderRegSummary();
}

function renderRegCategory() {
  const box = $('rg-cat'), p = REG.placement; if (!box) return;
  if (!REG.child.dateOfBirth || !p) { box.innerHTML = ''; return; }
  if (p.code) {
    box.innerHTML = `<div class="note ${p.playedUp ? 'warn' : 'info'}"><b>Category ${esc(p.code)}</b> — ${esc(p.note)}</div>`;
  } else {
    box.innerHTML = `<div class="note bad">${esc(p.note)}</div>
      <div style="margin-top:10px"><label class="lbl" for="ch-cat">Choose a category</label>
      <select class="sel" id="ch-cat">${opt('', '—')}${LK.ageGroups.map((a) => opt(a.id, a.code, REG.manualAgeGroupId === a.id)).join('')}</select></div>`;
    $('ch-cat').addEventListener('change', (e) => { REG.manualAgeGroupId = e.target.value; renderRegSummary(); });
  }
}
ACT.regGender = (g) => { REG.child.gender = g; document.querySelectorAll('[data-act="regGender"]').forEach((b) => b.classList.toggle('on', b.dataset.a1 === g)); renderRegSummary(); };

ACT.regNext2 = () => {
  const c = REG.child; REG.error = '';
  c.firstName = c.firstName.trim(); c.lastName = c.lastName.trim();
  if (!c.firstName || !c.lastName) REG.error = 'First and last name are required.';
  else if (!c.dateOfBirth) REG.error = 'Date of birth is required.';
  else if (!c.gender) REG.error = 'Choose boy or girl.';
  else if (!regCat()) REG.error = 'Choose a category — the date of birth doesn\'t place this child automatically.';
  if (REG.error) return renderReg();
  REG.step = 3; renderReg();
};

// ---- step 3: placement ----
function regStep3() {
  const cat = regCat();
  const forCat = (lvl) => LK.teams.filter((t) => t.level === lvl && (t.ageCodes || []).includes(cat.code));
  const LV = [['DEVELOPMENT', 'Development', 'Development pathway'], ['ADVANCED', 'Advanced', '2nd and 3rd teams'], ['HPC', 'HPC', '1st team — highest level']];
  const teams = REG.level ? LK.teams.filter((t) => t.level === REG.level && (REG.showAllTeams || (t.ageCodes || []).includes(cat.code))) : [];
  $('reg-body').innerHTML = `<h3>Level and team</h3>
    <p class="lead">${esc(REG.child.firstName)} plays <b>${esc(cat.code)}</b>. Choose the level they were assessed at, then the team.</p>
    <div class="opts c3">${LV.map(([k, t, d]) => {
      const n = forCat(k).length;
      return `<button class="opt ${REG.level === k ? 'on' : ''}" data-act="regLevel" data-a1="${k}" ${n || REG.showAllTeams ? '' : 'disabled'}>
        <span class="t">${t}</span><div class="d">${d}</div><div class="d">${n ? n + ' ' + esc(cat.code) + ' team' + (n > 1 ? 's' : '') : 'no ' + esc(cat.code) + ' team'}</div></button>`;
    }).join('')}</div>
    ${REG.level ? `<div class="opts" style="margin-top:14px">
      ${teams.map((t) => { const outside = !(t.ageCodes || []).includes(cat.code);
        return `<button class="opt ${REG.teamId === t.id ? 'on' : ''}" data-act="regTeam" data-a1="${t.id}">
          <div style="display:flex;justify-content:space-between;gap:10px"><span class="t">${esc(t.name)}</span><span class="mini">${t.isFull ? '<span style="color:var(--warn)">full — will waitlist</span>' : t.placesLeft + ' places left'}</span></div>
          <div class="d">${esc(t.levelExplainer)} · ${esc(t.schedule)} · ${t.coach ? 'Coach ' + esc(t.coach.name) : 'no coach yet'}${outside ? ` · <span style="color:var(--warn)">outside ${esc(cat.code)}</span>` : ''}</div></button>`;
      }).join('') || `<div class="mini">No ${esc(LEVEL_WORD[REG.level])} team takes ${esc(cat.code)}.</div>`}
      <button class="opt ${REG.teamId === '' ? 'on' : ''}" data-act="regTeam" data-a1=""><span class="t">No team yet</span><div class="d">Register now and place them later</div></button>
    </div>` : ''}
    <label class="chk" style="margin-top:14px"><input type="checkbox" id="rg-all" ${REG.showAllTeams ? 'checked' : ''}> Show teams outside ${esc(cat.code)} (playing up or down)</label>
    <div id="rg-err" style="margin-top:12px">${REG.error ? `<div class="note bad">${esc(REG.error)}</div>` : ''}</div>
    <div class="row-end"><button class="btn ghost" data-act="regBack">Back</button><button class="btn" data-act="regNext3">Continue</button></div>`;
  $('rg-all').addEventListener('change', (e) => { REG.showAllTeams = e.target.checked; renderReg(); });
}
ACT.regLevel = (l) => { REG.level = l; REG.teamId = null; REG.error = ''; renderReg(); };
ACT.regTeam = (id) => { REG.teamId = id; REG.error = ''; renderReg(); };
ACT.regNext3 = () => {
  REG.error = '';
  if (!REG.level) REG.error = 'Choose a level.';
  else if (REG.teamId === null) REG.error = 'Choose a team, or “No team yet”.';
  if (REG.error) return renderReg();
  REG.step = 4; renderReg();
};

// ---- step 4: term option, sessions a week, extras ----
function regStep4() {
  const noTeam = !REG.teamId;
  $('reg-body').innerHTML = `<h3>Term and extras</h3>
    <p class="lead">Pick how much of the season they are buying and how often they train. The price comes from the price list, sibling discount included.</p>
    <label class="chk"><input type="checkbox" id="rg-addterm" ${REG.addTerm ? 'checked' : ''}> Enrol now and raise the invoice</label>
    ${REG.addTerm ? `
      <div id="rg-pick" style="margin-top:14px">${purchasePicker(REG.purchase, 'rg')}</div>
      <div id="rg-quote" style="margin-top:14px"></div>
      <div id="rg-manbox">${manualDiscountBlock('rg', REG.purchase)}</div>
      <div id="rg-planbox">${planBox('rg')}</div>
      <label class="chk" style="margin-top:12px"><input type="checkbox" id="rg-issue" ${REG.issue ? 'checked' : ''}> Issue the invoice now <span class="mini">(untick to keep it as a draft)</span></label>`
    : `<div class="note info" style="margin-top:12px">${noTeam ? '' : 'The team place is only taken once they are enrolled. '}You can add a term later from the player page.</div>`}
    <div id="rg-family"></div>
    <div class="note info" style="margin-top:14px">Nothing has been saved yet. Confirm creates ${REG.guardian ? '' : 'the parent, '}${REG.kids.length ? `all ${REG.kids.length + 1} children` : 'the child'}${REG.addTerm || REG.kids.some((k) => k.addTerm) ? ` and ${REG.kids.length ? 'one family invoice' : 'the invoice'}` : ''}.</div>
    <div id="rg-err" style="margin-top:12px">${REG.error ? `<div class="note bad">${esc(REG.error)}</div>` : ''}</div>
    <div class="row-end"><button class="btn ghost" data-act="regBack">Back</button>
      <button class="btn ghost" data-act="regAddSibling" title="Same parent, one invoice — the sibling discount is worked out across the family">+ Add a brother or sister</button>
      <button class="btn" id="rg-go" data-act="regConfirm">${REG.kids.length ? `Confirm ${REG.kids.length + 1} children` : 'Confirm registration'}</button></div>`;
  $('rg-addterm').addEventListener('change', (e) => { REG.addTerm = e.target.checked; renderReg(); });
  if (REG.addTerm) {
    $('rg-issue').addEventListener('change', (e) => { REG.issue = e.target.checked; });
    regPick();
  }
}

/** (Re)load the options for this child and team, then price. */
async function regPick() {
  const box = $('rg-pick'); if (!box) return;
  const cat = regCat();
  try {
    await loadPurchaseOptions(REG.purchase, { ageGroupId: cat?.id, teamId: REG.teamId || '', level: REG.level || '' });
  } catch (e) { box.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
  const draw = () => {
    box.innerHTML = purchasePicker(REG.purchase, 'rg');
    wirePurchasePicker(REG.purchase, 'rg', box, (redraw) => { if (redraw) draw(); regQuote(); });
  };
  draw();
  regQuote();
}

async function regQuote() {
  const box = $('rg-quote'); if (!box) return;
  const cat = regCat(), pu = REG.purchase;
  if (!pu.package || !pu.spw) { box.innerHTML = ''; REG.quote = null; renderRegSummary(); return; }
  const qs = purchaseQuery(pu);
  qs.set('dob', REG.child.dateOfBirth); qs.set('firstName', REG.child.firstName); qs.set('lastName', REG.child.lastName);
  if (REG.guardian) qs.set('guardianId', REG.guardian.id);
  if (cat) qs.set('ageGroupId', cat.id);
  if (REG.teamId) qs.set('teamId', REG.teamId);
  box.innerHTML = '<div class="loading">Pricing…</div>';
  try {
    REG.quote = await api('/registration/quote?' + qs);
    box.innerHTML = REG.quote.ok ? quoteTable(REG.quote, cat?.code) : `<div class="note warn">${esc(REG.quote.reason)}</div>`;
  } catch (e) { REG.quote = null; box.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
  await regFamilyQuote();
  planAmounts('rg');
  renderRegSummary();
}

// ---- siblings on one registration ----
const kidSnapshot = () => ({ child: { ...REG.child }, placement: REG.placement, manualAgeGroupId: REG.manualAgeGroupId, cat: regCat(),
  level: REG.level, teamId: REG.teamId, addTerm: REG.addTerm, purchase: REG.purchase, quote: REG.quote, playerId: REG.playerId, playerRef: REG.playerRef });
const familyChild = (k, key) => ({ key, dob: k.child.dateOfBirth, firstName: k.child.firstName, lastName: k.child.lastName,
  ageGroupId: k.cat?.id, package: k.purchase.package || undefined, sessionsPerWeek: k.purchase.spw || undefined, teamId: k.teamId || undefined,
  productIds: k.purchase.productIds.length ? k.purchase.productIds : undefined,
  manualPreset: !k.purchase.manual?.percent ? (k.purchase.manual?.preset || undefined) : undefined, manualPercent: k.purchase.manual?.percent || undefined,
  startDate: k.purchase.startDate || undefined });
/** With brothers or sisters on the registration, price them together: one invoice, the sibling ladder across all of them. */
async function regFamilyQuote() {
  const box = $('rg-family');
  if (!REG.kids.length) { REG.familyQuote = null; if (box) box.innerHTML = ''; return; }
  const all = [...REG.kids.map((k, i) => ({ k, key: 'k' + i })), { k: kidSnapshot(), key: 'now' }].filter((x) => x.k.addTerm);
  if (!all.length) { REG.familyQuote = null; if (box) box.innerHTML = ''; return; }
  try {
    const fq = await api('/registration/family-quote', { method: 'POST', body: JSON.stringify({ guardianId: REG.guardian?.id, children: all.map((x) => familyChild(x.k, x.key)) }) });
    REG.familyQuote = fq;
    const now = fq.children.find((x) => x.key === 'now'); if (now && now.ok) REG.quote = now;
    for (const c of fq.children) { if (c.key !== 'now' && c.ok) { const k = REG.kids[Number(c.key.slice(1))]; if (k) k.quote = c; } }
    if (box) box.innerHTML = familyQuoteTable(fq);
    const q = $('rg-quote'); if (q && now?.ok) q.innerHTML = quoteTable(now, regCat()?.code);
  } catch (e) { REG.familyQuote = null; if (box) box.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
  if ($('reg-sum')) renderRegSummary();
}
/**
 * The family invoice, laid out like the old "Generate Invoice" table: start date,
 * terms, amount, special (sibling) discount, manual discount, kits & league, net.
 * Children already added can be edited here (start date, discount).
 */
function familyQuoteTable(fq) {
  const kidOf = (key) => (key === 'now' ? kidSnapshot() : REG.kids[Number(String(key).slice(1))]);
  const rows = fq.children.map((c) => {
    const k = kidOf(c.key) || {};
    const team = LK.teams.find((t) => t.id === k.teamId);
    const editable = c.key !== 'now';
    const i = editable ? Number(c.key.slice(1)) : -1;
    const start = c.proration?.startDate || k.purchase?.startDate || '';
    const editBtn = editable ? `<a class="lnk2" data-act="famEdit" data-a1="${i}">${REG.editKid === i ? 'Close' : 'Edit'}</a>` : '<span class="mini">edit above</span>';
    const cell = (kk, v) => `<div><div class="k">${kk}</div><div class="v">${v}</div></div>`;
    const head = `<div class="trh"><span><b>${esc(c.name || '')}</b> <span class="mini">${esc(c.position || '—')} child · ${esc(team?.name || 'no team yet')}${c.ok ? ` · ${esc(c.packageLabel || '')}${c.sessionsPerWeek ? ` · ${c.sessionsPerWeek}/wk` : ''}` : ''}</span></span>${editable ? `<button class="btn sm ghost" data-act="famEdit" data-a1="${i}">${REG.editKid === i ? 'Close' : 'Edit'}</button>` : '<span class="mini">edit above</span>'}</div>`;
    const main = c.ok ? `<div class="trc${REG.editKid === i && editable ? ' on' : ''}">${head}<div class="trg">
        ${cell('Start date', `${start ? dmy(start) : '<span class="mini">first day</span>'}${c.proration ? `<div class="mini">${c.proration.sessionsLeft} of ${c.proration.sessionsTotal} sessions</div>` : ''}`)}
        ${cell('Amount', `${money(c.listPriceInclVat ?? c.listPrice)}${c.proration ? `<div class="mini">of ${money(c.proration.fullPriceInclVat ?? c.proration.fullPrice)}</div>` : ''}`)}
        ${cell('Special discount', c.siblingDiscount ? `<b style="color:var(--good)">${c.siblingPercent}%</b> −${money(c.siblingDiscount.amount)}<div class="mini">sibling · excl. VAT</div>` : c.manualDiscount && c.siblingPercent ? '<span class="mini">replaced by the discount</span>' : '<span class="mini">full price</span>')}
        ${cell('Discount', c.manualDiscount ? `−${money(c.manualDiscount.amount)}<div class="mini">${esc(c.manualDiscount.label)}${c.manualDiscount.extra ? ' · extra' : ''}</div>` : '<span class="mini">—</span>')}
        ${cell('Net amount', `<b>${money(c.grandTotal ?? c.total)}</b>${c.extrasTotal ? `<div class="mini">incl. kits &amp; league ${money(c.extrasTotal)}</div>` : ''}`)}
      </div></div>`
      : `<div class="trc">${head}<div class="mini" style="color:var(--warn);margin-top:6px">${esc(c.reason || 'Not priced yet')}</div></div>`;
    return main + (editable && REG.editKid === i ? '@@EDITOR@@' : '');
  }).join('');
  const ek = REG.editKid != null ? REG.kids[REG.editKid] : null;
  const p = ek ? (ek.purchase.options?.packages?.find((x) => x.code === ek.purchase.package) || {}) : {};
  const i = REG.editKid, k = ek;
  const editor = !ek ? '' : `<div class="kidedit">
      <div class="frm"><div><label class="lbl" for="k${i}-start">Start date for ${esc(k.child.firstName)}</label>
        <input class="in" type="date" id="k${i}-start" value="${esc(k.purchase.startDate || '')}" ${p.startDate ? `min="${p.startDate}"` : ''} ${p.endDate ? `max="${p.endDate}"` : ''}>
        <div class="mini">Empty = from the first day (full price). A later date prorates by the sessions left.</div></div></div>
      ${manualDiscountBlock('k' + i, k.purchase, true)}
      <div class="row-end"><button class="btn sm" data-act="famEdit" data-a1="${i}">Done</button></div></div>`;
  return `<div class="card" style="padding:14px;margin-top:14px;box-shadow:none;border-color:var(--good)">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><b>One family invoice</b><span class="mini">oldest child first · discounts on the training fee only</span></div>
    ${rows.replace('@@EDITOR@@', editor)}
    <div class="famtot"><span><b>Family total</b>${fq.siblingSavings ? ` <span class="mini" style="color:var(--good)">· sibling discount saves ${money(fq.siblingSavings)} (excl. VAT)</span>` : ''}${fq.manualSavings ? ` <span class="mini">· manual discounts ${money(fq.manualSavings)}</span>` : ''}</span><b>${money(fq.total)}</b></div>
    </div>`;
}
ACT.famEdit = (i) => { i = Number(i); REG.editKid = REG.editKid === i ? null : i; regFamilyQuote(); };
document.addEventListener('change', (e) => {
  const mm = /^k(\d+)-start$/.exec(e.target?.id || ''); if (!mm) return;
  const k = REG.kids[Number(mm[1])]; if (!k) return;
  k.purchase.startDate = e.target.value || ''; k.purchase.startTouched = true;
  regFamilyQuote();
});
ACT.regAddSibling = () => {
  const errEl = $('rg-err'); if (errEl) errEl.innerHTML = '';
  if (REG.addTerm && !(REG.quote && REG.quote.ok)) { if (errEl) errEl.innerHTML = '<div class="note bad">Finish this child first — choose a term option and sessions a week (or untick "Enrol now").</div>'; return; }
  const r = $('rg-mrsn'); if (r && REG.purchase.manual) REG.purchase.manual.reason = r.value;
  REG.kids.push(kidSnapshot());
  const last = REG.child.lastName;
  Object.assign(REG, { child: { firstName: '', lastName: last, dateOfBirth: '', gender: '', kitSize: '', previousAcademy: '', medicalNotes: '',
      emergencyContactName: REG.child.emergencyContactName, emergencyContactPhone: REG.child.emergencyContactPhone },
    placement: null, manualAgeGroupId: '', level: null, teamId: null, showAllTeams: false, addTerm: true, purchase: newPurchase(),
    quote: null, playerId: null, playerRef: null, step: 2, error: '' });
  toast(`${REG.kids[REG.kids.length - 1].child.firstName} added — now the brother or sister`);
  renderReg();
};
ACT.regRemoveKid = (i) => { REG.kids.splice(Number(i), 1); REG.familyQuote = null; renderReg(); };

ACT.regConfirm = async () => {
  if (REG.busy) return;
  const errEl = $('rg-err'); errEl.innerHTML = '';
  let manual = { ok: true, value: undefined };
  if (REG.addTerm) { manual = readManualDiscount(errEl, REG.purchase); if (!manual.ok) return; }
  const planErr = planCheck(REG.plan); if (planErr) { errEl.innerHTML = `<div class="note bad">${esc(planErr)}</div>`; return; }
  if (REG.addTerm && !(REG.quote && REG.quote.ok)) { errEl.innerHTML = '<div class="note bad">This can\'t be priced yet — choose a term option and sessions a week (or check the price list for this category).</div>'; return; }
  if (REG.kids.length) return regConfirmFamily(manual);
  REG.busy = true; $('rg-go').disabled = true; $('rg-go').textContent = 'Saving…';
  const c = REG.child, cat = regCat(), team = LK.teams.find((t) => t.id === REG.teamId);
  try {
    // Each step remembers what it created, so a retry after an error carries on
    // from where it stopped instead of creating a second parent or child.
    if (!REG.guardian) {
      const g = REG.newGuardian;
      const created = await api('/guardians', { method: 'POST', body: JSON.stringify({
        fullName: g.fullName, relationship: g.relationship, email: g.email, mobile: g.mobile,
        emirate: g.emirate || undefined, city: g.city || undefined }) });
      REG.guardian = { id: created.id, reference: created.reference, fullName: created.fullName, email: created.email, mobile: created.mobile, children: 0 };
    }
    if (!REG.playerId) {
      const body = { guardianId: REG.guardian.id, firstName: c.firstName, lastName: c.lastName, gender: c.gender,
        dateOfBirth: c.dateOfBirth, level: REG.level || undefined };
      for (const k of ['kitSize', 'previousAcademy', 'medicalNotes', 'emergencyContactName', 'emergencyContactPhone']) if ((c[k] || '').trim()) body[k] = c[k].trim();
      if (REG.manualAgeGroupId) body.ageGroupId = REG.manualAgeGroupId;
      const p = await api('/players', { method: 'POST', body: JSON.stringify(body) });
      REG.playerId = p.id; REG.playerRef = p.reference;
    }
    let invoice = null, waitlisted = false, credits = [];
    if (REG.addTerm) {
      const outside = !!(team && cat && !(team.ageCodes || []).includes(cat.code));
      const pu = REG.purchase;
      const r = await api(`/players/${REG.playerId}/terms`, { method: 'POST', body: JSON.stringify({
        package: pu.package, sessionsPerWeek: pu.spw || undefined, productIds: pu.productIds.length ? pu.productIds : undefined,
        teamId: REG.teamId || undefined, allowCategoryOverride: outside || undefined,
        manualDiscount: manual.value, startDate: pu.startDate || undefined, instalments: planBody(REG.plan), issue: REG.issue }) });
      invoice = r.invoice; waitlisted = r.waitlisted; credits = r.siblingCredits || [];
    }
    REG.result = { playerId: REG.playerId, playerRef: REG.playerRef, guardian: REG.guardian, invoice, waitlisted, credits,
      team: team || null, category: cat?.code, package: REG.addTerm ? REG.purchase.package : null, spw: REG.addTerm ? REG.purchase.spw : null,
      extras: (REG.quote?.extras || []).map((x) => x.name) };
    REG.step = 5; REG.busy = false;
    if (REG.leadId) {
      try { await api(`/leads/${REG.leadId}/converted`, { method: 'POST', body: JSON.stringify({ playerId: REG.playerId }) }); REG.result.leadLinked = true; }
      catch { REG.result.leadLinked = false; }
    }
    await loadLookups(true);
    renderReg();
  } catch (e) {
    REG.busy = false;
    const saved = [REG.guardian && !REG.result ? `parent ${REG.guardian.reference}` : null, REG.playerRef ? `child ${REG.playerRef}` : null].filter(Boolean);
    REG.error = e.message + (saved.length ? ` (Already saved: ${saved.join(', ')}. Fix this and confirm again — nothing will be duplicated.)` : '');
    renderReg();
  }
};

/** Siblings together: the parent, every child, then ONE invoice for all of them. */
async function regConfirmFamily(manual) {
  const errEl = $('rg-err');
  REG.busy = true; $('rg-go').disabled = true; $('rg-go').textContent = 'Saving…';
  const cur = kidSnapshot(); cur.purchase = REG.purchase;
  const all = [...REG.kids, cur];
  try {
    if (!REG.guardian) {
      const g = REG.newGuardian;
      const created = await api('/guardians', { method: 'POST', body: JSON.stringify({
        fullName: g.fullName, relationship: g.relationship, email: g.email, mobile: g.mobile, emirate: g.emirate || undefined, city: g.city || undefined }) });
      REG.guardian = { id: created.id, reference: created.reference, fullName: created.fullName, email: created.email, mobile: created.mobile, children: 0 };
    }
    // Every child first (one welcome email, sent with the last), then the invoice.
    const toCreate = all.filter((k) => !k.playerId);
    for (const k of all) {
      if (k.playerId) continue;
      const c = k.child;
      const body = { guardianId: REG.guardian.id, firstName: c.firstName, lastName: c.lastName, gender: c.gender, dateOfBirth: c.dateOfBirth,
        level: k.level || undefined, sendWelcome: k === toCreate[toCreate.length - 1] };
      for (const f of ['kitSize', 'previousAcademy', 'medicalNotes', 'emergencyContactName', 'emergencyContactPhone']) if ((c[f] || '').trim()) body[f] = c[f].trim();
      if (k.manualAgeGroupId) body.ageGroupId = k.manualAgeGroupId;
      const p = await api('/players', { method: 'POST', body: JSON.stringify(body) });
      k.playerId = p.id; k.playerRef = p.reference;
      if (k === cur) { REG.playerId = p.id; REG.playerRef = p.reference; }
    }
    const items = all.filter((k) => k.addTerm).map((k) => {
      const team = LK.teams.find((t) => t.id === k.teamId);
      const outside = !!(team && k.cat && !(team.ageCodes || []).includes(k.cat.code));
      return { playerId: k.playerId, package: k.purchase.package, sessionsPerWeek: k.purchase.spw || undefined,
        productIds: k.purchase.productIds.length ? k.purchase.productIds : undefined, teamId: k.teamId || undefined,
        allowCategoryOverride: outside || undefined, manualDiscount: manualBody(k.purchase.manual), startDate: k.purchase.startDate || undefined };
    });
    let r = { invoice: null, waitlisted: [], siblingCredits: [] };
    if (items.length) r = await api(`/guardians/${REG.guardian.id}/terms`, { method: 'POST', body: JSON.stringify({ items, issue: REG.issue, instalments: planBody(REG.plan) }) });
    REG.result = { family: true, guardian: REG.guardian, invoice: r.invoice, credits: r.siblingCredits || [], waitlisted: r.waitlisted || [], discounts: r.appliedDiscounts || [],
      children: all.map((k) => ({ playerId: k.playerId, playerRef: k.playerRef, name: `${k.child.firstName} ${k.child.lastName}`, category: k.cat?.code,
        team: LK.teams.find((t) => t.id === k.teamId) || null, package: k.addTerm ? k.purchase.package : null, spw: k.addTerm ? k.purchase.spw : null })),
      playerId: all[0].playerId, playerRef: all[0].playerRef };
    if (REG.leadId) {
      try { for (const k of all) await api(`/leads/${REG.leadId}/converted`, { method: 'POST', body: JSON.stringify({ playerId: k.playerId }) }); REG.result.leadLinked = true; }
      catch { REG.result.leadLinked = false; }
    }
    REG.kids = all.slice(0, -1);
    REG.step = 5; REG.busy = false;
    await loadLookups(true);
    renderReg();
  } catch (e) {
    REG.busy = false;
    const saved = [REG.guardian ? `parent ${REG.guardian.reference}` : null, ...all.filter((k) => k.playerRef).map((k) => `child ${k.playerRef}`)].filter(Boolean);
    REG.error = e.message + (saved.length ? ` (Already saved: ${saved.join(', ')}. Fix this and confirm again — nothing will be duplicated.)` : '');
    renderReg();
  }
}

// ---- step 5: done ----
function regStep5() {
  const r = REG.result;
  if (r.family) return regStep5Family(r);
  $('reg-body').innerHTML = `<div class="note good"><b>${esc(REG.child.firstName)} is registered.</b>${r.waitlisted ? ' The team is full, so they are on its waitlist.' : ''}</div>
    <dl class="kv" style="margin-top:16px">
      <dt>Parent</dt><dd>${esc(r.guardian.fullName)} <span class="ref">${esc(r.guardian.reference)}</span></dd>
      <dt>Child</dt><dd>${esc(REG.child.firstName + ' ' + REG.child.lastName)} <span class="ref">${esc(r.playerRef)}</span></dd>
      <dt>Category</dt><dd><span class="chip">${esc(r.category || '—')}</span></dd>
      <dt>Team</dt><dd>${r.team ? `${esc(r.team.name)} <div class="mini">${esc(r.team.schedule)}</div>` : 'to be placed'}</dd>
      ${r.package ? `<dt>Term</dt><dd>${esc(PK_SHORT[r.package])}${r.spw ? ` · ${r.spw} session${r.spw === 1 ? '' : 's'} a week` : ''}</dd>` : ''}
      ${r.extras?.length ? `<dt>Extras</dt><dd>${r.extras.map(esc).join(', ')}</dd>` : ''}
      ${r.invoice ? `<dt>Invoice</dt><dd><span class="ref">${esc(r.invoice.number)}</span> ${statusPill(r.invoice.status)} — <b>${money(r.invoice.total)}</b></dd>` : ''}
    </dl>
    ${creditNote(r.credits)}
    ${REG.leadId ? `<div class="note ${r.leadLinked ? 'good' : 'warn'}" style="margin-top:12px">${r.leadLinked ? `Enquiry ${esc(REG.leadRef)} is now marked <b>Joined</b> and linked to ${esc(r.playerRef)}.` : `Couldn't update enquiry ${esc(REG.leadRef)} — open it in Trials &amp; Leads and mark it Joined.`}
      <a class="lnk2" data-act="openLead" data-a1="${REG.leadId}">Open the enquiry</a></div>` : ''}
    <div class="row-end" style="justify-content:flex-start">
      <button class="btn" data-act="openPlayer" data-a1="${r.playerId}">Open player page</button>
      <button class="btn ghost" data-act="regSibling" title="Same parent; this goes on a separate invoice">Register another child (separate invoice)</button>
      <button class="btn ghost" data-act="regFresh">New family</button>
      ${r.invoice ? `<button class="btn ghost" data-act="showInvoice" data-a1="${r.invoice.id}">View invoice</button>` : ''}
    </div>`;
}

function regStep5Family(r) {
  $('reg-body').innerHTML = `<div class="note good"><b>${r.children.length} children registered</b> under ${esc(r.guardian.fullName)}${r.invoice ? ' on one family invoice' : ''}.</div>
    <div class="card tblwrap" style="margin-top:14px;box-shadow:none"><table><thead><tr><th>Child</th><th>Category</th><th>Team</th><th>Term</th><th></th></tr></thead><tbody>
      ${r.children.map((c) => `<tr><td><b>${esc(c.name)}</b> <span class="ref">${esc(c.playerRef)}</span>${r.waitlisted.includes(c.playerId) ? ' <span class="pill p-warn">waitlist</span>' : ''}</td>
        <td><span class="chip">${esc(c.category || '—')}</span></td><td>${c.team ? esc(c.team.name) : '<span class="mini">to be placed</span>'}</td>
        <td>${c.package ? esc(PK_SHORT[c.package]) + (c.spw ? ` · ${c.spw}/wk` : '') : '<span class="mini">not enrolled</span>'}</td>
        <td><button class="btn sm ghost" data-act="openPlayer" data-a1="${c.playerId}">Open</button></td></tr>`).join('')}</tbody></table></div>
    ${r.invoice ? `<dl class="kv" style="margin-top:14px"><dt>Invoice</dt><dd><span class="ref">${esc(r.invoice.number)}</span> ${statusPill(r.invoice.status)} — <b>${money(r.invoice.total)}</b></dd>
      <dt>Discounts</dt><dd>${(r.discounts || []).map(esc).join('<br>') || 'none'}</dd></dl>` : ''}
    ${creditNote(r.credits)}
    ${REG.leadId ? `<div class="note ${r.leadLinked ? 'good' : 'warn'}" style="margin-top:12px">${r.leadLinked ? `Enquiry ${esc(REG.leadRef)} is now marked <b>Joined</b>.` : `Couldn't update enquiry ${esc(REG.leadRef)}.`} <a class="lnk2" data-act="openLead" data-a1="${REG.leadId}">Open the enquiry</a></div>` : ''}
    <div class="row-end" style="justify-content:flex-start">
      ${r.invoice ? `<button class="btn" data-act="showInvoice" data-a1="${r.invoice.id}">View the family invoice</button>` : ''}
      <button class="btn ghost" data-act="regFresh">New family</button></div>`;
}

// ================= teams: the schedule board =================
// Grouped by training slot — the way the academy describes its week.
VIEWS.teams = async () => {
  await loadLookups(true);
  const dayRank = (s) => (/^Tue & Thu/.test(s) ? 0 : /^Mon, Wed & Fri/.test(s) ? 1 : 2);
  const groups = new Map();
  for (const t of LK.teams) { const k = t.schedule || '—'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const slots = [...groups.entries()].sort(([a], [b]) => dayRank(a) - dayRank(b) || a.localeCompare(b));
  const total = LK.teams.reduce((s, t) => s + t.enrolled, 0), cap = LK.teams.reduce((s, t) => s + t.capacity, 0);
  $('page-acts').innerHTML = can('session.create') ? '<button class="btn sm ghost" data-act="seasonGenerate" title="Creates any missing training sessions from each team\'s days and times">Season sessions</button>' : '';
  const key = (lvl, word) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-left:12px"><i style="width:10px;height:3px;border-radius:2px;background:var(--${{ HPC: 'coral', ADVANCED: 'info', DEVELOPMENT: 'good' }[lvl]})"></i>${word}</span>`;
  $('view').innerHTML = `<div class="mini" style="margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center">${LK.teams.length} teams · ${total} of ${cap} places filled · ${esc(shortLoc(LK.teams[0]?.location))} · click a team for its roster and coach ${key('HPC', 'HPC')}${key('ADVANCED', 'Advanced')}${key('DEVELOPMENT', 'Development')}</div>
    ${slots.map(([slot, teams]) => `<div class="slot"><h3>${esc(slot.split(' · ')[0])} <span class="t">${esc(slot.split(' · ')[1] || '')}</span></h3>
      <div class="tcards">${teams.sort((a, b) => band(a.ageCodes?.[0]) - band(b.ageCodes?.[0]) || a.levelRank - b.levelRank).map((t) => `
        <div class="card tcard lvl-${esc(t.level)}" data-act="showRoster" data-a1="${t.id}" data-a2="${esc(t.name)}">
          <div class="tn">${esc(t.name)}</div>
          <div class="tx">${esc(t.levelExplainer)}</div>
          <div class="tx" style="margin-top:6px">${t.coach ? 'Coach ' + esc(t.coach.name) : '<span style="color:var(--warn)">No coach yet</span>'}</div>
          <div class="bar ${t.isFull ? 'bad' : t.enrolled / t.capacity > .8 ? 'warn' : ''}"><i style="width:${Math.min(100, t.enrolled / t.capacity * 100)}%"></i></div>
          <div class="tx" style="margin-top:4px">${t.enrolled} / ${t.capacity}${t.isFull ? ' · full' : ''}</div>
        </div>`).join('')}</div></div>`).join('')}`;
};

window.showRoster = async (id, name) => {
  openDrawer(name + ' — roster', '<div class="loading">Loading…</div>');
  try {
    const [r] = await Promise.all([api(`/teams/${id}/roster`), loadLookups()]);
    const t = LK.teams.find((x) => x.id === id);
    openDrawer(name + ' — roster', `
      ${t ? `<div class="kv"><dt>Level</dt><dd>${lvlBadge(t.level)} ${esc(t.levelExplainer)}</dd><dt>Training</dt><dd>${esc(t.schedule)}</dd>
        <dt>Takes</dt><dd>${(t.ageCodes || []).map((c) => `<span class="chip">${esc(c)}</span>`).join(' ')}</dd>
        <dt>Coach</dt><dd>${can('team.edit') ? `<select class="sel" id="ro-coach" style="max-width:240px">${opt('', 'No coach')}${LK.coaches.map((c) => opt(c.id, c.name + (c.canLogin ? '' : ' (no login yet)'), t.coach?.id === c.id)).join('')}</select>` : esc(t.coach?.name || 'None yet')}</dd></div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px"><span class="mini">${r.count} of ${r.capacity} places filled${r.isFull ? ' — full, new registrations will waitlist' : ''}</span>
        ${can('attendance.view') ? `<button class="btn sm ghost" data-act="teamAtt" data-a1="${id}">Attendance register</button>` : ''}</div>
      <div class="card tblwrap"><table><tbody>${r.players.map((p) => `<tr class="clickable" data-act="openPlayer" data-a1="${p.id}"><td class="ref">${esc(p.reference)}</td><td><b>${esc(p.firstName + ' ' + p.lastName)}</b></td><td><span class="chip">${esc(p.ageGroup?.code || '')}</span></td><td>${statusPill(p.status)}</td></tr>`).join('') || '<tr><td class="empty">No players on this team yet.</td></tr>'}</tbody></table></div>`);
    const sel = $('ro-coach');
    if (sel) sel.addEventListener('change', async () => {
      try { await api(`/teams/${id}/coach`, { method: 'PATCH', body: JSON.stringify({ coachId: sel.value || null }) });
        toast('Coach updated'); await loadLookups(true); if (CURRENT === 'teams' && $('page-title').textContent === 'Teams') VIEWS.teams(); }
      catch (e) { toast(e.message); }
    });
  } catch (e) { openDrawer(name, `<div class="empty">${esc(e.message)}</div>`); }
};

VIEWS.sessions = async () => {
  const from = new Date(); from.setDate(from.getDate()-7);
  const to = new Date(); to.setDate(to.getDate()+21);
  const d = await api(`/sessions?from=${from.toISOString()}&to=${to.toISOString()}`);
  const byDay = {};
  d.forEach(s => { const k = new Date(s.startsAt).toDateString(); (byDay[k] = byDay[k]||[]).push(s); });
  const today = new Date().toDateString();
  $('view').innerHTML = `<div class="mini" style="margin-bottom:12px">${d.length} sessions from ${dt(from)} to ${dt(to)} · conflicts are blocked automatically when booking</div>
    ${Object.entries(byDay).map(([day,list])=>`
      <div class="sec" style="margin-top:14px"><h3>${day===today?'<span style="color:var(--coral)">Today</span> · ':''}${day}<span class="cnt">${list.length}</span></h3>
      <div class="card tblwrap"><table><tbody>
      ${list.map(s=>`<tr class="clickable" data-act="showRegister" data-a1="${s.id}" data-a2="${esc(s.title||s.team?.name||s.type)}" ${s.isCancelled?'style="opacity:.55"':''}>
        <td style="width:110px" class="ref">${new Date(s.startsAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}–${new Date(s.endsAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td>
        <td><b>${esc(s.title||s.team?.name||s.type)}</b><div class="mini">${esc(s.title?s.team?.name||'—':'')}</div></td>
        <td>${s.isCancelled?'<span class="pill p-mute">Cancelled</span>':statusPill(s.type)}</td>
        <td>${esc(s.venue?.name||'—')}<div class="mini">${esc(s.location?.name||'')}</div></td>
        <td>${esc(s.coach?.user?.fullName||'unassigned')}</td></tr>`).join('')}
      </tbody></table></div></div>`).join('') || '<div class="card empty">No sessions in this window.</div>'}`;
};
VIEWS.attendance = async () => {
  const [issues, unsub] = await Promise.all([
    api('/attendance/issues?threshold=80').catch(()=>[]),
    api('/attendance/unsubmitted?days=14').catch(()=>[]),
  ]);
  let analytics = null; try { analytics = await api('/analytics/attendance'); } catch {}
  $('view').innerHTML = `
    <div class="card" style="margin-bottom:16px"><div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <h3 style="margin:0">Registers</h3><span class="mini" id="ad-label"></span>
      <span style="margin-left:auto;display:flex;gap:6px"><button class="btn sm ghost" data-act="adDay" data-a1="-1">‹ Previous day</button><button class="btn sm ghost" data-act="adToday">Today</button><button class="btn sm ghost" data-act="adDay" data-a1="1">Next day ›</button>
      <button class="btn sm ghost" data-act="go" data-a1="teamAttendance">Team registers</button></span></div>
      <div class="tblwrap" id="ad-box"><div class="loading">Loading…</div></div></div>
    ${analytics?`<div class="grid g4" style="margin-bottom:16px">
      <div class="card kpi"><div class="l">Overall rate</div><div class="n ${analytics.attendanceRate>=80?'good':''}">${analytics.attendanceRate}%</div><div class="s">${analytics.totalMarks} marks recorded</div></div>
      ${Object.entries(analytics.byStatus).map(([k,v])=>`<div class="card kpi"><div class="l">${k.toLowerCase()}</div><div class="n">${v}</div></div>`).join('')}
    </div>`:''}
    <div class="split">
      <div class="card"><div style="padding:13px 16px;border-bottom:1px solid var(--line)"><h3 style="margin:0">Attendance concerns <span class="cnt">below 80%</span></h3></div>
        <div class="tblwrap"><table><tbody>${issues.map(i=>`<tr class="clickable" data-act="showPlayer" data-a1="${i.playerId}"><td><b>${esc(i.name)}</b><div class="mini ref">${esc(i.reference)}</div></td><td class="num"><b style="color:${i.attendanceRate<70?'var(--coral)':'var(--warn)'}">${i.attendanceRate}%</b><div class="mini">${i.sessions} sessions</div></td></tr>`).join('') || '<tr><td class="empty">No concerns.</td></tr>'}</tbody></table></div></div>
      <div class="card"><div style="padding:13px 16px;border-bottom:1px solid var(--line)"><h3 style="margin:0">Registers not submitted</h3></div>
        <div class="tblwrap"><table><tbody>${unsub.map(u=>`<tr class="clickable" data-act="showRegister" data-a1="${u.sessionId}" data-a2="${esc(u.team||'Session')}"><td>${dtm(u.startsAt)}<div class="mini">${esc(u.team||'')}</div></td><td class="num">${u.marked}/${u.roster}</td></tr>`).join('') || '<tr><td class="empty">All registers complete.</td></tr>'}</tbody></table></div></div>
    </div>
    ${analytics?`<div class="sec"><h3>By team</h3><div class="card" style="padding:14px 16px">
      ${analytics.byTeam.map(t=>`<div class="barrow"><span class="bl">${esc(t.team)}</span><span class="bb"><i style="width:${t.rate||0}%"></i></span><span class="bv">${t.rate??'—'}%</span></div>`).join('')}
    </div></div>`:''}`;
  loadDayRegisters();
};

// ================= price list & products =================
const STREAM_WORD = { ACADEMY: 'LALIGA Academy', KITS: 'Kits sales', MAN_CITY_LEAGUE: 'Manchester City League',
  ABU_DHABI_CUP: 'Abu Dhabi Cup', RAMADAN_CUP: 'Ramadan Cup', SALOU_CUP: 'Salou Cup', OTHER: 'Other' };
const KIT_WORD = { HOME: 'Home kit', AWAY: 'Away kit', TOP: 'Top', TRAINING: 'Training kit', GOALKEEPER: 'Goalkeeper kit' };
VIEWS.prices = async () => {
  const [pl, prods] = await Promise.all([api('/price-list'), api('/products')]);
  const edit = can('invoice.manage');
  const tierName = { 1: 'Development squads — 1 session a week', 2: 'Development & Advanced squads — 2 sessions a week', 3: 'Advanced & HPC squads — 3 sessions a week' };
  const cell = (r, code) => edit
    ? `<input class="in pin" type="number" min="0" step="1" value="${r.prices[code] ?? ''}" data-pr="${r.id}" data-pk="${code}" aria-label="${esc(r.category)} ${code}">`
    : (r.prices[code] != null ? Number(r.prices[code]).toLocaleString('en-AE') : '—');
  const warn = (r) => r.prices.T1_2 != null && r.prices.T1 != null && r.prices.T1_2 < r.prices.T1
    ? ` <span class="pill p-warn" title="Terms 1 & 2 costs less than Term 1 alone">check</span>` : '';
  $('page-acts').innerHTML = edit ? `<button class="btn sm" data-act="prodNew">+ New product</button>` : '';
  $('view').innerHTML = `<div class="note info" style="margin-bottom:14px">${esc(pl.season.name)} · all prices include VAT. Changes apply to new invoices only — issued invoices are never changed.</div>
    ${pl.tiers.map((t) => `<div class="sec"><h3>${esc(tierName[t.sessionsPerWeek] || t.sessionsPerWeek + ' sessions a week')}</h3>
      <div class="card tblwrap"><table class="ptab"><thead><tr><th>Category</th><th>Hours</th><th class="num">Rate / session</th>
        ${pl.packages.map((p) => `<th class="num">${esc(p.label)}${p.weeks ? `<div class="mini" style="text-transform:none">${p.weeks} wks</div>` : ''}</th>`).join('')}${edit ? '<th></th>' : ''}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr><td><b>${esc(r.category === 'GIRLS' ? 'Girls' : r.category)}</b>${warn(r)}</td><td>${r.hoursPerSession ? (r.hoursPerSession === 1 ? '1 h' : '1½ h') : '—'}</td>
        <td class="num">${r.sessionRate != null ? r.sessionRate : '—'}</td>${pl.packages.map((p) => `<td class="num">${cell(r, p.code)}</td>`).join('')}
        ${edit ? `<td><button class="btn sm ghost" data-act="priceSave" data-a1="${r.id}">Save</button></td>` : ''}</tr>`).join('')}</tbody></table></div></div>`).join('')
      || '<div class="card empty">No price list for this season yet.</div>'}
    <div class="sec"><h3>Products <span class="cnt">kits, leagues, tournaments</span></h3>
      <div class="card tblwrap"><table><thead><tr><th>Item</th><th>Reported as</th><th>Contents</th><th>For</th><th class="num">Price incl. VAT</th><th>At registration</th><th>Status</th>${edit ? '<th></th>' : ''}</tr></thead>
      <tbody>${prods.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="mini">${esc(p.description || '')}</div></td><td>${esc(STREAM_WORD[p.stream] || p.stream)}</td>
        <td class="mini">${(p.kitItems || []).map((k) => `${k.qty > 1 ? k.qty + ' × ' : ''}${esc(KIT_WORD[k.type] || k.type)}`).join(', ') || '—'}</td>
        <td class="mini">${p.levels?.length ? p.levels.map((l) => LEVEL_WORD[l]).join(', ') : 'Everyone'}</td>
        <td class="num">${money(p.priceInclVat)}</td><td>${p.offerAtRegistration ? 'Offered' : '—'}</td><td>${p.isActive ? statusPill('ACTIVE') : statusPill('CANCELLED')}</td>
        ${edit ? `<td><button class="btn sm ghost" data-act="prodEdit" data-a1="${p.id}">Edit</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="8" class="empty">No products</td></tr>'}</tbody></table></div></div>`;
  window.__prods = prods;
};
ACT.priceSave = async (id) => {
  const prices = {};
  document.querySelectorAll(`[data-pr="${id}"]`).forEach((i) => { prices[i.dataset.pk] = i.value === '' ? null : Number(i.value); });
  try { await api('/price-list/' + id, { method: 'PATCH', body: JSON.stringify({ prices }) }); toast('Prices saved'); go('prices'); }
  catch (e) { toast(e.message); }
};
function productForm(p) {
  p = p || { stream: 'OTHER', levels: [], kitItems: [], offerAtRegistration: false, isActive: true, sortOrder: 100 };
  const kq = (t) => (p.kitItems || []).find((k) => k.type === t)?.qty || 0;
  return `<div class="frm">
    ${p.id ? '' : `<div><label class="lbl" for="pf-code">Code</label><input class="in" id="pf-code" placeholder="e.g. ADC-2027"></div>`}
    <div class="${p.id ? 'full' : ''}"><label class="lbl" for="pf-name">Name</label><input class="in" id="pf-name" value="${esc(p.name || '')}"></div>
    <div class="full"><label class="lbl" for="pf-desc">Description</label><input class="in" id="pf-desc" value="${esc(p.description || '')}"></div>
    <div><label class="lbl" for="pf-price">Price (AED, incl. VAT)</label><input class="in" id="pf-price" type="number" min="0" step="0.01" value="${p.priceInclVat ? Number(p.priceInclVat) : ''}"></div>
    <div><label class="lbl" for="pf-stream">Reported as</label><select class="sel" id="pf-stream">${Object.entries(STREAM_WORD).map(([k, v]) => opt(k, v, p.stream === k)).join('')}</select></div>
    <div class="full"><span class="lbl">Offered to</span>${['DEVELOPMENT', 'ADVANCED', 'HPC'].map((l) => `<label class="chk" style="display:inline-flex;margin-right:14px"><input type="checkbox" data-pfl="${l}" ${p.levels?.includes(l) ? 'checked' : ''}> ${LEVEL_WORD[l]}</label>`).join('')}<div class="hint">None ticked = every level.</div></div>
    <div class="full"><span class="lbl">Kit pieces included (for the kit-sales chart)</span><div style="display:flex;gap:8px;flex-wrap:wrap">${Object.entries(KIT_WORD).map(([k, v]) => `<label class="mini" style="display:flex;gap:4px;align-items:center">${v}<input class="in qty" style="width:54px" type="number" min="0" max="10" value="${kq(k)}" data-pfk="${k}"></label>`).join('')}</div></div>
    <label class="chk full"><input type="checkbox" id="pf-reg" ${p.offerAtRegistration ? 'checked' : ''}> Offer as a tick-box on Register a child</label>
    <label class="chk full"><input type="checkbox" id="pf-act" ${p.isActive ? 'checked' : ''}> Active</label>
  </div><div id="pf-err" style="margin-top:10px"></div>
  <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" data-act="prodSave" data-a1="${p.id || ''}">Save</button></div>`;
}
ACT.prodNew = () => openDrawer('New product', productForm(null));
ACT.prodEdit = (id) => openDrawer('Edit product', productForm((window.__prods || []).find((p) => p.id === id)));
ACT.prodSave = async (id) => {
  const body = {
    name: $('pf-name').value.trim(), description: $('pf-desc').value.trim() || undefined,
    priceInclVat: Number($('pf-price').value), stream: $('pf-stream').value,
    levels: [...document.querySelectorAll('[data-pfl]')].filter((c) => c.checked).map((c) => c.dataset.pfl),
    kitItems: [...document.querySelectorAll('[data-pfk]')].map((i) => ({ type: i.dataset.pfk, qty: Math.floor(Number(i.value) || 0) })).filter((k) => k.qty > 0),
    offerAtRegistration: $('pf-reg').checked, isActive: $('pf-act').checked,
  };
  if (!id) body.code = ($('pf-code').value || '').trim().toUpperCase();
  if (body.name.length < 2 || !(body.priceInclVat > 0) || (!id && body.code.length < 2)) { $('pf-err').innerHTML = '<div class="note bad">Name, code and a price are needed.</div>'; return; }
  try {
    await api(id ? '/products/' + id : '/products', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    closeDrawer(); toast('Saved'); go('prices');
  } catch (e) { $('pf-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

VIEWS.discounts = async () => {
  const d = await api('/discounts');
  const auto = d.filter(x=>x.isAutomatic && x.isActive);
  const manual = d.filter(x=>!x.isAutomatic && x.isActive);
  const sib = auto.find(x=>x.rule==='SIBLING');
  const ladder = sib && sib.params && Array.isArray(sib.params.tiers)
    ? { tiers: sib.params.tiers, beyond: sib.params.beyond ?? sib.params.tiers[sib.params.tiers.length-1] }
    : { tiers: [15,25], beyond: 25 };
  const rungs = [{n:1,p:0,label:'1st child'},
    ...ladder.tiers.map((p,i)=>({n:i+2,p,label:ordinalJs(i+2)+' child'})),
    {n:ladder.tiers.length+2,p:ladder.beyond,label:ordinalJs(ladder.tiers.length+2)+' child and beyond'}];

  $('view').innerHTML = `
    <div class="sec" style="margin-top:0"><h3>Applied automatically <span class="cnt">${auto.length} rule${auto.length===1?'':'s'}</span></h3>
      <div class="mini" style="margin-bottom:12px">Only these apply on their own at invoicing. Everything else is a deliberate choice an admin makes.</div>
      ${sib ? `<div class="card" style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
          <b>${esc(sib.name)}</b><span class="chip">one discount per child — never stacked</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${rungs.map(r=>`<div style="flex:1;min-width:116px;border:1px solid ${r.p>0?'var(--coral)':'var(--line)'};border-radius:10px;padding:11px 12px">
            <div style="font-family:Archivo,system-ui,sans-serif;font-size:21px;font-weight:800;color:${r.p>0?'var(--coral)':'var(--muted)'}">${r.p>0?r.p+'%':'full'}</div>
            <div class="mini">${esc(r.label)}</div></div>`).join('')}
        </div>
        <div class="mini" style="margin-top:11px">The eldest enrolled child pays full price, so the discount falls on the youngest — usually the lower-priced U6/U8 bracket. An admin can move it per family below.</div>
      </div>` : `<div class="card" style="padding:16px"><div class="mini">No automatic discount is configured.</div></div>`}
    </div>

    <div class="sec"><h3>Available to apply by hand <span class="cnt">${manual.length}</span></h3>
      <div class="card tblwrap"><table>
      <thead><tr><th>Rule</th><th>Basis</th><th class="num">Value</th><th>Conditions</th></tr></thead>
      <tbody>${manual.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td><span class="chip">${esc(x.rule)}</span></td>
        <td class="num">${x.kind==='PERCENTAGE'?Number(x.value)+'%':money(x.value)}</td>
        <td class="mini">${esc(JSON.stringify(x.params||{}))}</td></tr>`).join('') || '<tr><td class="empty">None configured.</td></tr>'}</tbody></table></div>
    </div>

    <div class="sec"><h3>Check a family</h3><div class="card" style="padding:16px">
      <div class="mini" style="margin-bottom:10px">See which child is discounted, at what rate, and why.</div>
      <div style="display:flex;gap:8px"><select id="dsc-guardian" style="flex:1;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--ink)"></select>
      <button class="btn sm" data-act="showSiblingPlan">Show ladder</button></div>
      <div id="dsc-fam" style="margin-top:12px"></div>
    </div></div>

    <div class="sec"><h3>Check one player</h3><div class="card" style="padding:16px">
      <div class="mini" style="margin-bottom:10px">What applies on its own, and what an admin could add, against a AED 3,801 term fee.</div>
      <div style="display:flex;gap:8px"><select id="dsc-player" style="flex:1;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--ink)"></select>
      <button class="btn sm" data-act="evalDiscounts">Evaluate</button></div>
      <div id="dsc-out" style="margin-top:12px"></div>
    </div></div>`;

  try{ const p = await api('/players?limit=40&status=ACTIVE');
    $('dsc-player').innerHTML = p.data.map(x=>`<option value="${x.id}">${esc(x.firstName+' '+x.lastName)} (${esc(x.reference)})</option>`).join('');
  }catch{}
  try{ const g = await api('/guardians?limit=60');
    const rows = g.data || g;
    $('dsc-guardian').innerHTML = rows.map(x=>`<option value="${x.id}">${esc(x.fullName)}${x.reference?' ('+esc(x.reference)+')':''}</option>`).join('');
  }catch{}
};

function ordinalJs(n){ const s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }

window.showSiblingPlan = async () => {
  const gid = $('dsc-guardian').value;
  $('dsc-fam').innerHTML = '<div class="loading">Reading the family…</div>';
  try{ const r = await api(`/discounts/sibling-plan?guardianId=${gid}`);
    const n = r.entries.length;
    $('dsc-fam').innerHTML = `
      ${r.isOverridden?'<div class="mini" style="margin-bottom:9px"><span class="pill p-warn">order set by an admin</span></div>':''}
      <div class="tblwrap"><table><thead><tr><th>Position</th><th>Child</th><th class="num">Discount</th><th>Why</th><th></th></tr></thead>
      <tbody>${r.entries.map(e=>`<tr>
        <td><b>${ordinalJs(e.rank)}</b></td>
        <td><b>${esc(e.name)}</b><div class="mini ref">born ${esc(e.dateOfBirth)}</div></td>
        <td class="num"><b style="color:${e.percent>0?'var(--coral)':'var(--muted)'}">${e.percent>0?e.percent+'%':'full price'}</b></td>
        <td class="mini">${esc(e.reason)}</td>
        <td>${e.rank!==1&&can('discount.edit')?`<button class="btn sm ghost" data-act="setFullPrice" data-a1="${gid}" data-a2="${e.playerId}">Make full price</button>`:''}</td>
      </tr>`).join('')}</tbody></table></div>
      ${n>1&&r.isOverridden&&can('discount.edit')?`<button class="btn sm ghost" style="margin-top:10px" data-act="resetSiblingOrder" data-a1="${gid}">Back to default (eldest pays full)</button>`:''}`;
  }catch(e){ $('dsc-fam').innerHTML = `<div class="mini">${esc(e.message)}</div>`; }
};

window.setFullPrice = async (gid, playerId) => {
  try{ const plan = await api(`/discounts/sibling-plan?guardianId=${gid}`);
    const rest = plan.entries.map(e=>e.playerId).filter(id=>id!==playerId);
    await api(`/discounts/sibling-order/${gid}`, {method:'PATCH', body: JSON.stringify({orderedPlayerIds:[playerId, ...rest]})});
    toast('Full-price child changed — recorded in the activity log');
    showSiblingPlan();
  }catch(e){ toast(e.message); }
};

window.resetSiblingOrder = async (gid) => {
  try{ await api(`/discounts/sibling-order/${gid}`, {method:'PATCH', body: JSON.stringify({orderedPlayerIds:[]})});
    toast('Back to the default order'); showSiblingPlan();
  }catch(e){ toast(e.message); }
};

window.evalDiscounts = async () => {
  const pid = $('dsc-player').value;
  $('dsc-out').innerHTML = '<div class="loading">Evaluating…</div>';
  try{ const r = await api(`/discounts/evaluate?playerId=${pid}&amount=3801`);
    $('dsc-out').innerHTML = r.length ? r.map(c=>`<div style="padding:9px 11px;border:1px solid ${c.isAutomatic?'var(--coral)':'var(--line)'};border-radius:9px;margin-bottom:7px">
      <div style="display:flex;justify-content:space-between"><b>${esc(c.label)}</b><b>−${money(c.amount)}</b></div>
      <div class="mini">${esc(c.reason)} ${c.isAutomatic?'<span class="pill p-good" style="margin-left:6px">applies automatically</span>':'<span class="pill" style="margin-left:6px">admin must choose</span>'}</div></div>`).join('')
      : '<div class="mini">Nothing applies to this player.</div>';
  }catch(e){ $('dsc-out').innerHTML = `<div class="mini">${esc(e.message)}</div>`; }
};

VIEWS.comms = async () => {
  const [autos, hist] = await Promise.all([api('/automations').catch(()=>[]), api('/communications').catch(()=>[])]);
  $('view').innerHTML = `
    <div class="sec" style="margin-top:0"><h3>Automations <span class="cnt">preview before sending</span></h3>
      <div class="grid g2">${autos.map(a=>`<div class="card" style="padding:15px">
        <b style="font-family:Archivo">${esc(a.name)}</b><div class="mini" style="margin:3px 0 10px">${esc(a.description)}</div>
        <div style="display:flex;gap:7px"><button class="btn sm ghost" data-act="runAuto" data-a1="${a.key}" data-a2="true">Preview</button>
        ${can('communication.create')?`<button class="btn sm" data-act="runAuto" data-a1="${a.key}" data-a2="false">Run &amp; send</button>`:''}</div>
        <div id="auto-${a.key}" style="margin-top:10px"></div>
      </div>`).join('')}</div>
    </div>
    <div class="sec"><h3>Communication history <span class="cnt">${hist.length}</span></h3>
      <div class="card tblwrap"><table>
      <thead><tr><th>When</th><th>Channel</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
      <tbody>${hist.slice(0,40).map(c=>`<tr><td class="ref">${dtm(c.createdAt)}</td><td><span class="chip">${esc(c.channel)}</span></td>
        <td>${esc(c.toAddress)}</td><td>${esc(c.subject||'—')}</td><td>${statusPill(c.status)}</td></tr>`).join('') || '<tr><td class="empty">Nothing sent yet.</td></tr>'}</tbody></table></div>
    </div>`;
};
window.runAuto = async (key, dryRun) => {
  const out = $('auto-'+key); out.innerHTML = '<div class="loading">Running…</div>';
  try{ const r = await api(`/automations/${key}`, {method:'POST', body: JSON.stringify({dryRun})});
    out.innerHTML = `<div style="font-size:12.5px"><b>${r.candidates}</b> recipient(s)${dryRun?' would be contacted':` — <b style="color:var(--good)">${r.sent} sent</b>`}</div>
      ${(r.details||[]).slice(0,4).map(d=>`<div class="mini">· ${esc(Object.values(d).slice(0,3).join(' — '))}</div>`).join('')}`;
    if(!dryRun) toast(`${r.sent} message(s) sent`);
  }catch(e){ out.innerHTML = `<div class="mini">${esc(e.message)}</div>`; }
};

// ================= player development: term reports =================
// Development squads get the Development report (1–5, pitch, observations);
// Advanced and HPC squads get the Advanced report (0–5 by position, with a
// comment per area). Coaches write and lock them; the office sends them.
const RTYPE_WORD = { DEVELOPMENT: 'Development report', ADVANCED: 'Advanced report' };
const RSTATE = { TODO: ['Not started', 'p-mute'], DRAFT: ['Draft', 'p-warn'], FINAL: ['Final', 'p-info'], SENT: ['Sent to parent', 'p-good'] };
const rstatePill = (s) => `<span class="pill ${(RSTATE[s] || ['', 'p-mute'])[1]}">${esc((RSTATE[s] || [s])[0])}</span>`;
let DV = { termId: '', teamId: '', type: '', status: '', search: '' };
let DTPL = null;

VIEWS.development = async () => {
  await loadLookups();
  if (!DTPL) DTPL = await api('/development/templates');
  const seasonTerms = LK.terms.filter((t) => t.type === 'TERM' && (!LK.activeSeason || t.seasonId === LK.activeSeason.id));
  const sel = (k, opts) => `<select class="sel" id="dv-${k}">${opts.map(([v, t]) => opt(v, t, (DV[k] ?? '') === v)).join('')}</select>`;
  $('page-acts').innerHTML = can('evaluation.approve') ? '<button class="btn sm ghost" data-act="dvSendAll">Send all final reports in this list</button>' : '';
  $('view').innerHTML = `<div class="card filters"><div class="fgrid">
      <div><label class="lbl" for="dv-termId">Term</label>${sel('termId', [['', 'The term in progress'], ...seasonTerms.map((t) => [t.id, t.name])])}</div>
      <div><label class="lbl" for="dv-teamId">Team</label>${sel('teamId', [['', 'Every team'], ...LK.teams.slice().sort((a, b) => band(a.ageCodes?.[0]) - band(b.ageCodes?.[0]) || a.levelRank - b.levelRank).map((t) => [t.id, t.name])])}</div>
      <div><label class="lbl" for="dv-type">Report</label>${sel('type', [['', 'Both reports'], ['DEVELOPMENT', 'Development report'], ['ADVANCED', 'Advanced report']])}</div>
      <div><label class="lbl" for="dv-status">Where it stands</label>${sel('status', [['', 'Any'], ['TODO', 'Not started'], ['DRAFT', 'Draft'], ['FINAL', 'Final, not sent'], ['SENT', 'Sent to parent']])}</div>
      <div class="w2"><label class="lbl" for="dv-search">Child</label><input class="in" id="dv-search" value="${esc(DV.search)}" placeholder="Name"></div></div></div>
    <div id="dv-counts" style="margin:12px 0"></div>
    <div class="card tblwrap" id="dv-tbl"><div class="loading">Loading…</div></div>`;
  $('view').querySelectorAll('.filters select').forEach((s) => s.addEventListener('change', loadDevBoard));
  $('dv-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadDevBoard(); });
  await loadDevBoard();
};
let DROWS = [];
async function loadDevBoard() {
  const FILTERS = ['termId', 'teamId', 'type', 'status', 'search'];
  for (const k of FILTERS) { const el = $('dv-' + k); if (el) DV[k] = el.value.trim(); }
  // Only the filters go to the API (DV also remembers termResolved, which the API would refuse).
  const qs = new URLSearchParams(FILTERS.filter((k) => DV[k]).map((k) => [k, DV[k]]));
  const box = $('dv-tbl'); if (!box) return;
  try {
    const d = await api('/development/board?' + qs);
    DROWS = d.rows; DV.termResolved = d.term?.id;
    const c = d.counts;
    $('dv-counts').innerHTML = d.term ? `<div class="totbar"><span><b>${esc(d.term.name)}</b> ${esc(d.term.season || '')}</span><span><b>${c.total}</b> children</span>
      <span>Development <b>${c.development}</b></span><span>Advanced <b>${c.advanced}</b></span><span>Not started <b class="${c.todo ? 'bad' : ''}">${c.todo}</b></span>
      <span>Draft <b>${c.draft}</b></span><span>Final <b>${c.final}</b></span><span>Sent <b class="good">${c.sent}</b></span></div>` : '';
    const groups = new Map();
    for (const r of d.rows) { const k = r.team || 'No team'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    box.innerHTML = d.rows.length ? `<table class="dir"><thead><tr><th>Child</th><th>Category</th><th>Report</th><th>Where it stands</th><th class="num">Overall</th><th>Written by</th><th>Updated</th><th></th></tr></thead>
      <tbody>${[...groups.entries()].map(([team, list]) => `<tr class="tsday"><td colspan="8"><b>${esc(team)}</b> <span class="mini">· ${list.length} · ${list.filter((r) => r.state !== 'TODO').length} started · coach ${esc(list[0].coach || '—')}</span></td></tr>
        ${list.map((r) => `<tr>
          <td><a class="lnk2" data-act="openPlayer" data-a1="${r.playerId}"><b>${esc(r.name)}</b></a> <span class="mini ref">${esc(r.reference)}</span></td>
          <td><span class="chip">${esc(r.category || '—')}</span></td>
          <td><span class="pill ${r.reportType === 'ADVANCED' ? 'p-info' : 'p-mute'}">${esc(RTYPE_WORD[r.reportType])}</span></td>
          <td>${rstatePill(r.state)}</td>
          <td class="num">${r.overall != null ? `<b>${r.overall.toFixed(1)}</b>` : '—'}</td>
          <td class="mini">${esc(r.writtenBy || '')}</td><td class="mini">${r.updatedAt ? dmy(r.updatedAt) : ''}</td>
          <td><div class="rowacts">${r.reportId ? `<button class="btn sm ${r.state === 'DRAFT' ? '' : 'ghost'}" data-act="rpOpen" data-a1="${r.reportId}">${r.state === 'DRAFT' ? 'Continue' : 'Open'}</button>
              <button class="btn sm ghost" data-act="rpPdf" data-a1="${r.reportId}">PDF</button>`
            : can('evaluation.create') ? `<button class="btn sm" data-act="rpStart" data-a1="${r.playerId}" data-a2="${r.reportType}">Start</button>` : ''}</div></td></tr>`).join('')}`).join('')}</tbody></table>`
      : '<div class="empty">No children enrolled in this term match.</div>';
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
ACT.rpStart = async (playerId, type) => {
  try { const r = await api('/development/reports', { method: 'POST', body: JSON.stringify({ playerId, reportType: type, termId: DV.termId || DV.termResolved || undefined }) }); openReport(r); }
  catch (e) { toast(e.message); }
};
ACT.rpOpen = async (id) => { try { openReport(await api('/development/reports/' + id)); } catch (e) { toast(e.message); } };
ACT.rpPdf = async (id) => { try { await fetchFile(`/development/reports/${id}/pdf`, 'Report.pdf', true); } catch (e) { toast(e.message); } };
ACT.dvSendAll = async () => {
  const todo = DROWS.filter((r) => r.state === 'FINAL');
  if (!todo.length) return toast('No final reports waiting to be sent in this list');
  let ok = 0;
  for (const r of todo) { try { await api(`/development/reports/${r.reportId}/send`, { method: 'POST', body: '{}' }); ok++; } catch {} }
  toast(`${ok} of ${todo.length} report${todo.length === 1 ? '' : 's'} sent`); loadDevBoard();
};

// ---------- the report editor ----------
let RP = null, RP_T = null;
function openReport(r) {
  RP = r;
  CURRENT = 'report';
  $('nav').querySelectorAll('a.nav').forEach((a) => a.classList.toggle('on', a.dataset.k === 'development'));
  renderReport();
}
function renderReport() {
  const r = RP, locked = r.status === 'FINAL' || !can('evaluation.edit');
  const adv = r.reportType === 'ADVANCED';
  $('page-title').textContent = RTYPE_WORD[r.reportType];
  $('page-acts').innerHTML = `<button class="btn sm ghost" data-act="go" data-a1="development">← All reports</button>
    <button class="btn sm ghost" data-act="rpPdf" data-a1="${r.id}">Preview PDF</button>`;
  const scale = [];
  for (let n = r.scale.min; n <= r.scale.max; n++) scale.push(n);
  const area = (a) => `<div class="card rparea" style="padding:14px 16px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h3 style="margin:0;font-size:14px">${esc(a.label)}</h3>
        <span class="mini">average <b id="rp-av-${a.key}" style="color:var(--ink)">${r.averages.areas[a.key] != null ? r.averages.areas[a.key].toFixed(1) : '—'}</b>${r.previous?.averages?.areas?.[a.key] != null ? ` · last time ${r.previous.averages.areas[a.key].toFixed(1)}` : ''}</span></div>
      <div class="rpgrid${adv ? ' adv' : ''}">${a.items.map((i) => { const k = `${a.key}.${i.key}`, v = r.scores[k]; return `<div class="rpitem"><span>${esc(i.label)}</span>
        <span class="attseg rpseg">${scale.map((n) => `<button class="${v === n ? 'on' : ''}" data-act="rpScore" data-a1="${k}" data-a2="${n}" ${locked ? 'disabled' : ''} title="${esc(r.scale.labels?.[n] || String(n))}">${n}</button>`).join('')}</span></div>`; }).join('')}</div>
      ${adv && a.comment ? `<label class="lbl" for="rp-c-${a.key}" style="margin-top:10px">Coach's comment</label><textarea class="in rpc" id="rp-c-${a.key}" data-area="${a.key}" rows="3" ${locked ? 'disabled' : ''} placeholder="Strengths and what to work on in this area">${esc(r.comments?.[a.key] || '')}</textarea>` : ''}
    </div>`;
  const posName = (k) => (DTPL?.DEVELOPMENT.positions.find((p) => p.key === k) || {}).label || '—';
  $('view').innerHTML = `
    ${r.status === 'FINAL' ? `<div class="note ${r.sentAt ? 'good' : 'info'}" style="margin-bottom:12px">Final ${r.finalizedAt ? 'since ' + dmyt(r.finalizedAt) : ''}${r.finalizedBy ? ' by ' + esc(r.finalizedBy) : ''}${r.sentAt ? ` · sent to the parent ${dmyt(r.sentAt)}` : ' · not sent to the parent yet'}.</div>` : ''}
    <div class="card" style="padding:16px;display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
      ${adv ? `<div class="rpphoto">${r.photo ? `<img src="${esc(r.photo)}" alt="Player photo">` : '<span class="mini">No photo</span>'}
        ${locked ? '' : `<label class="btn sm ghost" style="margin-top:6px;cursor:pointer">Photo<input type="file" accept="image/*" id="rp-photo" hidden></label>${r.photo ? ' <a class="lnk2 mini" data-act="rpNoPhoto">remove</a>' : ''}`}</div>` : ''}
      <div style="flex:1;min-width:260px"><div style="font-size:20px;font-weight:800">${esc(r.player?.name || '')}</div>
        <div class="mini">${esc(r.player?.reference || '')} · <span class="chip">${esc(r.player?.category || '')}</span> ${esc(r.player?.team || 'no team')} · ${esc(r.term || '')} ${esc(r.season || '')}</div>
        <div class="mini" style="margin-top:4px">Coach ${esc(r.coach || '—')}${r.attendance ? ` · attendance this term <b style="color:${r.attendance.rate >= 80 ? 'var(--good)' : 'var(--bad)'}">${r.attendance.rate}%</b> (${r.attendance.present}/${r.attendance.marked})` : ''}${r.previous ? ` · last report ${esc(r.previous.term)}: ${r.previous.averages.overall?.toFixed(1) ?? '—'}` : ''}</div>
        ${adv ? `<div class="frm" style="margin-top:10px;max-width:420px">
          <div><label class="lbl" for="rp-pos">Position</label><select class="sel" id="rp-pos" ${locked ? 'disabled' : ''}>${DTPL.ADVANCED.positions.map((p) => opt(p.key, p.label, r.position === p.key)).join('')}</select></div>
          <div><label class="lbl" for="rp-num">Shirt number</label><input class="in" id="rp-num" type="number" min="1" max="99" value="${r.shirtNumber ?? ''}" ${locked ? 'disabled' : ''}></div></div>` : ''}</div>
      <div style="text-align:right;min-width:150px"><div class="mini">Overall</div><div style="font-size:30px;font-weight:800;font-family:Archivo,system-ui,sans-serif" id="rp-overall">${r.averages.overall != null ? r.averages.overall.toFixed(1) : '—'}</div>
        <div class="mini">out of ${r.scale.max}${adv ? ' (0–5)' : ' (1–5)'}</div><div style="margin-top:6px">${rstatePill(r.sentAt ? 'SENT' : r.status)}</div><div class="mini" id="rp-saved" style="margin-top:4px"></div></div>
    </div>
    ${adv ? `<div class="card" style="padding:14px 16px;margin-top:12px"><label class="lbl" for="rp-notes">General comment</label>
      <textarea class="in" id="rp-notes" rows="3" ${locked ? 'disabled' : ''} placeholder="How the term went for the player and for the team">${esc(r.notes || '')}</textarea></div>` : ''}
    ${!adv ? `<div class="note info" style="margin-top:12px">${Object.entries(r.scale.labels).map(([n, l]) => `<b>${n}</b> ${esc(l)}`).join(' · ')}</div>` : '<div class="note info" style="margin-top:12px">0 is not seen yet · 5 is outstanding for the age group</div>'}
    <div class="${adv ? '' : 'rpsplit'}"><div>${r.areas.map(area).join('')}</div>
      ${!adv ? `<div class="card" style="padding:14px 16px;margin-top:12px;align-self:start"><h3 style="margin:0 0 6px;font-size:14px">Positions</h3>
        <div class="mini" style="margin-bottom:8px">Tap up to two: first is position 1 (red), second is position 2 (yellow).</div>
        ${pitchSvg(r.positions || [], locked)}
        <div class="mini" style="margin-top:8px">Position 1: <b>${esc(posName(r.positions?.[0]))}</b> · Position 2: <b>${esc(posName(r.positions?.[1]))}</b></div></div>` : ''}</div>
    ${!adv ? `<div class="card" style="padding:14px 16px;margin-top:12px"><label class="lbl" for="rp-notes">Observations</label>
      <textarea class="in" id="rp-notes" rows="5" ${locked ? 'disabled' : ''} placeholder="How the term went, strengths, what to work on next term">${esc(r.notes || '')}</textarea></div>` : ''}
    <div id="rp-err" style="margin-top:12px"></div>
    <div class="row-end">
      ${r.status === 'DRAFT' && can('evaluation.edit') ? `<button class="btn ghost" data-act="rpDelete">Delete draft</button>
        ${!Object.keys(r.scores).length ? `<button class="btn ghost" data-act="rpSwitch">Use the ${adv ? 'Development' : 'Advanced'} report instead</button>` : ''}
        <button class="btn" data-act="rpFinal">Make final</button>` : ''}
      ${r.status === 'FINAL' && can('evaluation.approve') ? `<button class="btn ghost" data-act="rpReopen">Reopen to edit</button><button class="btn" data-act="rpSend">${r.sentAt ? 'Send to parent again' : 'Send to parent'}</button>` : ''}
    </div>`;
  if (!locked) wireReport();
}
function pitchSvg(picked, locked) {
  const P = DTPL.DEVELOPMENT.positions, w = 220, h = 300;
  return `<svg viewBox="0 0 ${w} ${h}" class="rppitch" role="group" aria-label="Positions on the pitch">
    <rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="#2e8b3a"/>${[1, 3, 5, 7].map((i) => `<rect x="0" y="${i * h / 8}" width="${w}" height="${h / 8}" fill="#329a40"/>`).join('')}
    <g fill="none" stroke="#fff" stroke-width="1.5"><rect x="8" y="8" width="${w - 16}" height="${h - 16}"/><line x1="8" y1="${h / 2}" x2="${w - 8}" y2="${h / 2}"/><circle cx="${w / 2}" cy="${h / 2}" r="24"/>
      <rect x="${w * 0.27}" y="8" width="${w * 0.46}" height="${h * 0.13}"/><rect x="${w * 0.27}" y="${h - 8 - h * 0.13}" width="${w * 0.46}" height="${h * 0.13}"/></g>
    ${P.map((p) => { const i = picked.indexOf(p.key), cx = 8 + p.x * (w - 16), cy = 8 + p.y * (h - 16);
      return `<g ${locked ? '' : `data-act="rpPos" data-a1="${p.key}" style="cursor:pointer"`}><circle cx="${cx}" cy="${cy}" r="11" fill="${i === 0 ? '#e8264b' : i === 1 ? '#f2b705' : 'rgba(255,255,255,.18)'}" stroke="#fff" stroke-width="2"/>
        <text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${esc(p.key.replace(/\d/, ''))}</text><title>${esc(p.label)}</title></g>`; }).join('')}</svg>`;
}
function rpQueue(patch) {
  RP._pending = { ...(RP._pending || {}), ...patch, ...(patch.scores ? { scores: { ...(RP._pending?.scores || {}), ...patch.scores } } : {}),
    ...(patch.comments ? { comments: { ...(RP._pending?.comments || {}), ...patch.comments } } : {}) };
  const s = $('rp-saved'); if (s) s.textContent = 'Saving…';
  clearTimeout(RP_T); RP_T = setTimeout(rpFlush, 700);
}
async function rpFlush() {
  if (!RP?._pending) return;
  const body = RP._pending; RP._pending = null;
  try {
    const r = await api('/development/reports/' + RP.id, { method: 'PATCH', body: JSON.stringify(body) });
    const redraw = body.position !== undefined || body.positions !== undefined || body.photo !== undefined;
    RP = { ...r, _pending: RP._pending };
    if (redraw) renderReport();
    else {
      for (const [k, v] of Object.entries(r.averages.areas)) { const el = $('rp-av-' + k); if (el) el.textContent = v != null ? v.toFixed(1) : '—'; }
      const o = $('rp-overall'); if (o) o.textContent = r.averages.overall != null ? r.averages.overall.toFixed(1) : '—';
    }
    const s = $('rp-saved'); if (s) s.textContent = 'Saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { const s = $('rp-saved'); if (s) s.textContent = ''; toast(e.message); }
}
function wireReport() {
  const n = $('rp-notes'); if (n) n.addEventListener('input', () => rpQueue({ notes: n.value }));
  document.querySelectorAll('.rpc').forEach((t) => t.addEventListener('input', () => rpQueue({ comments: { [t.dataset.area]: t.value } })));
  const num = $('rp-num'); if (num) num.addEventListener('change', () => rpQueue({ shirtNumber: num.value ? Number(num.value) : null }));
  const pos = $('rp-pos'); if (pos) pos.addEventListener('change', () => {
    const scored = Object.keys(RP.scores).some((k) => k.startsWith('technical_tactical.') || k.startsWith('conditional.'));
    if (scored) toast('Position changed — the technical and conditional items are different, so score them again');
    rpQueue({ position: pos.value });
  });
  const ph = $('rp-photo'); if (ph) ph.addEventListener('change', async () => {
    const f = ph.files?.[0]; if (!f) return;
    try { rpQueue({ photo: await shrinkImage(f, 300) }); } catch (e) { toast(e.message); }
  });
}
ACT.rpScore = (k, n) => {
  n = Number(n); RP.scores[k] = n;
  document.querySelectorAll(`[data-act="rpScore"][data-a1="${k}"]`).forEach((b) => b.classList.toggle('on', Number(b.dataset.a2) === n));
  rpQueue({ scores: { [k]: n } });
};
ACT.rpPos = (k) => {
  let p = [...(RP.positions || [])];
  if (p.includes(k)) p = p.filter((x) => x !== k); else if (p.length < 2) p.push(k); else p = [p[0], k];
  RP.positions = p; rpQueue({ positions: p });
  const box = document.querySelector('.rppitch'); if (box) box.outerHTML = pitchSvg(p, false);
};
ACT.rpNoPhoto = () => rpQueue({ photo: null });
ACT.rpFinal = async () => {
  clearTimeout(RP_T); await rpFlush();
  try { RP = await api(`/development/reports/${RP.id}/final`, { method: 'POST', body: '{}' }); toast('Report is final'); renderReport(); }
  catch (e) { $('rp-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};
ACT.rpReopen = async () => { try { RP = await api(`/development/reports/${RP.id}/reopen`, { method: 'POST', body: '{}' }); toast('Reopened — it is a draft again'); renderReport(); } catch (e) { toast(e.message); } };
ACT.rpSend = async () => {
  try { const r = await api(`/development/reports/${RP.id}/send`, { method: 'POST', body: '{}' }); RP = r.report;
    toast(r.simulated ? 'Email isn\'t connected yet — saved in the Email log; the parent can download it from their sign-in page' : `Sent to ${r.to}`); renderReport(); }
  catch (e) { toast(e.message); }
};
ACT.rpDelete = async () => {
  try { await api(`/development/reports/${RP.id}`, { method: 'DELETE' }); toast('Draft deleted'); go('development'); } catch (e) { toast(e.message); }
};
ACT.rpSwitch = async () => {
  if (Object.keys(RP.scores || {}).length) return toast('This report already has scores — delete the draft first if you want the other report');
  const other = RP.reportType === 'ADVANCED' ? 'DEVELOPMENT' : 'ADVANCED';
  try { await api(`/development/reports/${RP.id}`, { method: 'DELETE' });
    openReport(await api('/development/reports', { method: 'POST', body: JSON.stringify({ playerId: RP.playerId, termId: RP.termId, reportType: other }) })); }
  catch (e) { toast(e.message); }
};

VIEWS.analytics = async () => {
  const a = await api('/analytics');
  const r = a.revenue, e = a.enrolment, c = a.capacity, at = a.attendance, cv = a.conversion;
  const maxM = Math.max(1, ...r.monthly.map(m=>m.billed));
  $('view').innerHTML = `
    <div class="grid g4">
      <div class="card kpi"><div class="l">Billed</div><div class="n">${money(r.billed)}</div><div class="s">${r.invoiceCount} invoices</div></div>
      <div class="card kpi"><div class="l">Collected</div><div class="n good">${money(r.collected)}</div><div class="s">${r.collectionRate}% collection rate</div></div>
      <div class="card kpi"><div class="l">Outstanding</div><div class="n bad">${money(r.outstanding)}</div><div class="s">VAT ${money(r.vat)}</div></div>
      <div class="card kpi"><div class="l">Discounts given</div><div class="n">${money(r.discounts)}</div><div class="s">auto-applied by rules</div></div>
    </div>
    <div class="split sec">
      <div class="card" style="padding:16px"><h3 style="font-size:13px;margin-bottom:10px">Billed vs collected by month</h3>
        ${r.monthly.map(m=>`<div class="barrow"><span class="bl">${m.month}</span><span class="bb"><i style="width:${m.billed/maxM*100}%"></i></span><span class="bv">${Math.round(m.billed).toLocaleString()}</span></div>
        <div class="barrow" style="margin-top:-4px"><span class="bl mini" style="opacity:.6">collected</span><span class="bb" style="height:8px"><i style="width:${m.collected/maxM*100}%;background:var(--good)"></i></span><span class="bv mini">${Math.round(m.collected).toLocaleString()}</span></div>`).join('') || '<div class="mini">No invoice history yet.</div>'}
      </div>
      <div class="card" style="padding:16px"><h3 style="font-size:13px;margin-bottom:10px">Players by age group</h3>
        ${(()=>{const mx=Math.max(1,...e.byAgeGroup.map(x=>x.count));return e.byAgeGroup.map(x=>`<div class="barrow"><span class="bl">${esc(x.code)}</span><span class="bb"><i style="width:${x.count/mx*100}%"></i></span><span class="bv">${x.count}</span></div>`).join('')})()}
      </div>
    </div>
    <div class="split sec">
      <div class="card" style="padding:16px"><h3 style="font-size:13px;margin-bottom:10px">Team capacity <span class="cnt" style="color:var(--muted);font-family:IBM Plex Mono">${c.overallUtilisation}% used</span></h3>
        ${c.rows.map(x=>`<div class="barrow"><span class="bl">${esc(x.team)}</span><span class="bb"><i style="width:${x.utilisation}%;${x.isFull?'background:var(--coral)':''}"></i></span><span class="bv">${x.filled}/${x.capacity}</span></div>`).join('')}
      </div>
      <div class="card" style="padding:16px"><h3 style="font-size:13px;margin-bottom:10px">Trial conversion by source <span class="cnt" style="color:var(--muted);font-family:IBM Plex Mono">${cv.conversionRate}% overall</span></h3>
        ${cv.bySource.map(s=>`<div class="barrow"><span class="bl">${esc(s.source)}</span><span class="bb"><i style="width:${s.rate}%"></i></span><span class="bv">${s.converted}/${s.leads}</span></div>`).join('')}
      </div>
    </div>
    <div class="sec"><h3>Coach workload</h3><div class="card tblwrap"><table>
      <thead><tr><th>Coach</th><th class="num">Sessions</th><th class="num">Teams</th><th class="num">Players</th></tr></thead>
      <tbody id="cw"><tr><td class="loading">Loading…</td></tr></tbody></table></div></div>`;
  try{ const cw = await api('/analytics/coach-workload');
    document.getElementById('cw').innerHTML = cw.map(c=>`<tr><td><b>${esc(c.name)}</b><div class="mini">${esc(c.certification||'')}</div></td><td class="num">${c.sessions}</td><td class="num">${c.teams}</td><td class="num">${c.players}</td></tr>`).join('');
  }catch{}
};

VIEWS.audit = async () => {
  const d = await api('/audit-logs');
  $('view').innerHTML = `<div class="mini" style="margin-bottom:12px">Every write is recorded — the old system's audit page redirected to Reports and logged nothing.</div>
    <div class="card tblwrap"><table>
    <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Actor</th><th>IP</th></tr></thead>
    <tbody>${d.map(a=>`<tr><td class="ref">${dtm(a.createdAt)}</td><td><span class="chip">${esc(a.action)}</span></td>
      <td>${esc(a.entity||'—')}<div class="mini ref">${esc((a.entityId||'').slice(0,8))}</div></td>
      <td>${esc(a.actor?.fullName||a.actorType||'system')}</td><td class="mini">${esc(a.ipAddress||'—')}</td></tr>`).join('') || '<tr><td class="empty">No entries.</td></tr>'}</tbody></table></div>`;
};

// ================= resizable tables =================
// Drag a column edge to widen it; double-click the edge to fit the content.
// Widths are remembered per table in this browser.
function resizableTable(table, key) {
  if (!table) return;
  const store = 'll-cols-' + key;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(store) || '{}'); } catch {}
  table.classList.add('rtable');
  const ths = [...table.querySelectorAll('thead th')];
  ths.forEach((th, i) => {
    const id = th.dataset.col || String(i);
    if (saved[id]) th.style.width = saved[id] + 'px';
    const h = document.createElement('span'); h.className = 'rz'; h.title = 'Drag to resize · double-click to fit';
    th.appendChild(h);
    h.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, w0 = th.getBoundingClientRect().width;
      table.classList.add('resizing');
      const move = (ev) => { th.style.width = Math.max(40, w0 + ev.clientX - x0) + 'px'; };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        table.classList.remove('resizing');
        saved[id] = Math.round(th.getBoundingClientRect().width);
        try { localStorage.setItem(store, JSON.stringify(saved)); } catch {}
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    h.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      let w = th.scrollWidth;
      table.querySelectorAll(`tbody tr`).forEach((tr) => { const td = tr.children[i]; if (td) w = Math.max(w, td.scrollWidth + 4); });
      th.style.width = Math.min(600, w + 16) + 'px';
      saved[id] = Math.round(th.getBoundingClientRect().width);
      try { localStorage.setItem(store, JSON.stringify(saved)); } catch {}
    });
  });
}
ACT.resetCols = (key, view) => { try { localStorage.removeItem('ll-cols-' + key); } catch {} go(view); };

const f2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d) => d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai' }) : '—';
const METHOD_OPTS = [['CASH', 'Cash'], ['CARD', 'Credit card'], ['ONLINE', 'Payment link'], ['BANK_TRANSFER', 'Bank transfer'], ['CHEQUE', 'Cheque'], ['WALLET', 'Wallet']];
const METHOD_WORD = Object.fromEntries(METHOD_OPTS);
const playerLinks = (ps) => (ps || []).map((p) => `<a class="lnk2" data-act="openPlayer" data-a1="${p.id}" title="${esc(p.name)}">${esc(p.ref)}</a>`).join(', ') || '—';
const invLink = (inv) => `<a class="lnk2 ref2" data-act="showInvoice" data-a1="${inv.id}">${esc(inv.number)}</a>`;

/** Download a protected file (CSV / PDF) with the sign-in token, then save or open it. */
async function fetchFile(path, fileName, open) {
  const get = () => fetch(API + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  let res = await get();
  if (res.status === 401 && REFRESH && await renewSession()) res = await get();
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).message || m; } catch {} throw new Error(m); }
  const blob = await res.blob(), url = URL.createObjectURL(blob);
  if (open) { window.open(url, '_blank', 'noopener'); }
  else { const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
ACT.invPdf = async (id, number) => { try { await fetchFile(`/invoices/${id}/pdf`, `Invoice-${number}.pdf`, true); } catch (e) { toast(e.message); } };
ACT.invPdfDl = async (id, number) => { try { await fetchFile(`/invoices/${id}/pdf?download=true`, `Invoice-${number}.pdf`); } catch (e) { toast(e.message); } };
ACT.invEmail = async (id) => {
  try {
    const r = await api(`/invoices/${id}/email`, { method: 'POST', body: '{}' });
    toast(r.sent ? `Emailed to ${r.to}` : r.simulated ? 'Recorded — email is not connected yet' : 'Email failed: ' + (r.error || ''));
    if ($('dw-body')) window.showInvoice(id);
  } catch (e) { toast(e.message); }
};

// ================= Payment Report =================
let PRF = null;
VIEWS.paymentReport = async () => {
  await loadLookups();
  const now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (!PRF) PRF = { from: iso(first), to: iso(now), method: '', merchantId: '', locationId: '', search: '', includeWallet: true };
  const merchants = await api('/merchants').catch(() => []);
  $('page-title').textContent = 'Payment Report';
  $('page-acts').innerHTML = `<button class="btn sm ghost" data-act="resetCols" data-a1="payrep" data-a2="paymentReport">Reset column widths</button>
    <button class="btn sm" data-act="prCsv">Export Excel</button>`;
  $('view').innerHTML = `<div class="card filters"><div class="fgrid">
      <div><label class="lbl" for="pr-from">From</label><input class="in" type="date" id="pr-from" value="${esc(PRF.from)}"></div>
      <div><label class="lbl" for="pr-to">To</label><input class="in" type="date" id="pr-to" value="${esc(PRF.to)}"></div>
      <div><label class="lbl" for="pr-method">Payment method</label><select class="sel" id="pr-method">${opt('', 'All methods')}${METHOD_OPTS.map(([k, v]) => opt(k, v, PRF.method === k)).join('')}</select></div>
      <div><label class="lbl" for="pr-merch">Merchant</label><select class="sel" id="pr-merch">${opt('', 'All merchants')}${merchants.map((m) => opt(m.id, `${m.name} (${m.merchantNumber})`, PRF.merchantId === m.id)).join('')}</select></div>
      <div><label class="lbl" for="pr-loc">Location</label><select class="sel" id="pr-loc">${opt('', 'All locations')}${LK.locations.map((l) => opt(l.id, shortLoc(l.name), PRF.locationId === l.id)).join('')}</select></div>
      <div><label class="lbl" for="pr-q">Search</label><input class="in" id="pr-q" placeholder="LA-, PL-, PR-, reference, name" value="${esc(PRF.search)}"></div>
    </div>
    <div class="fbar"><label class="chk"><input type="checkbox" id="pr-wallet" ${PRF.includeWallet ? 'checked' : ''}> Show wallet use as rows</label>
      <span class="mini">Received counts direct money only — cash, credit card, payment link, bank transfer, cheque. Wallet use and write-offs are never in Received.</span>
      <button class="btn sm" data-act="prGo">Search</button></div></div>
    <div id="pr-out"><div class="loading">Loading…</div></div>`;
  $('pr-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') ACT.prGo(); });
  ['pr-from', 'pr-to', 'pr-method', 'pr-merch', 'pr-loc', 'pr-wallet'].forEach((id) => $(id).addEventListener('change', ACT.prGo));
  await loadPaymentReport();
};
function prQuery() {
  PRF = { from: $('pr-from').value, to: $('pr-to').value, method: $('pr-method').value, merchantId: $('pr-merch').value,
    locationId: $('pr-loc').value, search: $('pr-q').value.trim(), includeWallet: $('pr-wallet').checked };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(PRF)) if (v !== '' && v !== true) qs.set(k, String(v));
  return qs;
}
ACT.prGo = () => loadPaymentReport();
ACT.prCsv = async () => { try { await fetchFile('/reports/payments.csv?' + prQuery(), `Payment-Report-${PRF.from || 'all'}-${PRF.to || 'all'}.csv`); } catch (e) { toast(e.message); } };
async function loadPaymentReport() {
  const box = $('pr-out'); if (!box) return;
  try {
    const r = await api('/reports/payments?' + prQuery());
    const t = r.totals;
    const range = PRF.from || PRF.to ? `${PRF.from ? dmy(PRF.from) : '…'} – ${PRF.to ? dmy(PRF.to) : '…'}` : 'All dates';
    box.innerHTML = `<div class="rephead"><h2>Payment Report</h2><span class="mini">${esc(range)} · ${t.count} payment${t.count === 1 ? '' : 's'} on ${t.invoices} invoice${t.invoices === 1 ? '' : 's'}</span></div>
      <div class="grid g4" style="margin-bottom:12px">
        <div class="card kpi"><div class="l">Received</div><div class="n good">${money(t.received)}</div><div class="s">direct money</div></div>
        <div class="card kpi"><div class="l">Wallet applied</div><div class="n">${money(t.wallet)}</div><div class="s">credit used, not money in</div></div>
        <div class="card kpi"><div class="l">Balance still owed</div><div class="n ${t.balance > 0 ? 'bad' : ''}">${money(t.balance)}</div><div class="s">on these invoices, today</div></div>
        <div class="card kpi"><div class="l">Payments</div><div class="n">${t.count}</div><div class="s">${t.invoices} invoices</div></div>
      </div>
      ${r.truncated ? '<div class="note warn" style="margin-bottom:10px">Showing the first 5,000 payments — narrow the dates to see the rest, or export.</div>' : ''}
      <div class="card tblwrap"><table id="pr-tbl" class="dir">
        <thead><tr><th data-col="sl" class="num">SL</th><th data-col="date">Date</th><th data-col="method">Payment Method</th><th data-col="merchant">Merchant</th><th data-col="mid">Merchant ID</th>
          <th data-col="ref">Payment Reference</th><th data-col="loc">Location</th><th data-col="player">Player No.</th><th data-col="inv">Invoice#</th>
          <th data-col="rec" class="num">Received</th><th data-col="wallet" class="num">Wallet</th><th data-col="bal" class="num">Balance</th></tr></thead>
        <tbody>${r.rows.map((x) => `<tr class="${x.direction === 'REFUND' ? 'refund' : ''}">
          <td class="num">${x.sl}</td><td>${dmy(x.date)}</td><td>${esc(x.methodLabel)}</td>
          <td title="${esc(x.merchant || '')}">${esc(x.merchant || '—')}</td><td class="mono">${esc(x.merchantId || '—')}</td>
          <td class="mono" title="${esc(x.reference || '')}">${esc(x.reference || '—')}</td><td title="${esc(x.location || '')}">${esc(x.location || '—')}</td>
          <td>${playerLinks(x.players)}</td><td>${invLink(x.invoice)}</td>
          <td class="num">${x.received ? f2(x.received) : '0.00'}</td><td class="num">${x.wallet ? f2(x.wallet) : '0.00'}</td><td class="num">${f2(x.balance)}</td></tr>`).join('')
          || '<tr><td colspan="12" class="empty">No payments in this range.</td></tr>'}</tbody>
        ${r.rows.length ? `<tfoot><tr><td colspan="9" class="num"><b>Total</b></td><td class="num"><b>${f2(t.received)}</b></td><td class="num"><b>${f2(t.wallet)}</b></td><td class="num"><b>${f2(t.balance)}</b></td></tr></tfoot>` : ''}
      </table></div>`;
    resizableTable($('pr-tbl'), 'payrep');
  } catch (e) { box.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}

// ================= Invoices (same search as the old screen, new table) =================
const INV_STATUS = [['', 'Any payment status'], ['ISSUED', 'Invoice issued (unpaid)'], ['PART_PAID', 'Partial payment'], ['PAID', 'Paid'],
  ['OVERDUE', 'Payment pending (overdue)'], ['DRAFT', 'Draft (not sent)'], ['SPONSORED', 'Sponsored'], ['REFUNDED', 'Refunded'],
  ['WRITTEN_OFF', 'Written off'], ['CANCELLED', 'Cancelled']];
const IF_KEYS = ['keyword', 'invoiceNo', 'playerNo', 'parentNo', 'status', 'method', 'additional', 'custom', 'ageGroupId', 'locationId',
  'termId', 'invoiceFrom', 'invoiceTo', 'paymentFrom', 'paymentTo', 'amountFrom', 'amountTo'];
let IF = { page: 1, wide: false, sort: '', dir: '', quick: '' };
// Selection for bulk actions: ticked ids (kept across pages), or every invoice in the search.
let INV_SEL = new Set(), INV_ALL = null;

// One-click filters, applied on top of the form (their keys win).
const dubaiToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const addDaysIso = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayIso = () => { const t = dubaiToday(), d = new Date(t + 'T00:00:00Z'); return addDaysIso(t, -((d.getUTCDay() + 6) % 7)); };
/** The term in progress, else the next one to start. */
function currentTermLk() {
  const t = dubaiToday(), terms = (LK.terms || []).filter((x) => x.type === 'TERM' && x.startDate && x.endDate);
  return terms.find((x) => x.startDate <= t && x.endDate >= t) || terms.filter((x) => x.startDate > t).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] || null;
}
const INV_QUICK = [
  ['overdue', 'Overdue', () => ({ status: 'OVERDUE' })],
  ['unpaidTerm', 'Unpaid this term', () => { const t = currentTermLk(); return t ? { open: 'true', termId: t.id } : { open: 'true' }; }],
  ['due7', 'Due in the next 7 days', () => ({ open: 'true', dueFrom: dubaiToday(), dueTo: addDaysIso(dubaiToday(), 7) })],
  ['paidWeek', 'Paid this week', () => ({ paymentFrom: mondayIso(), paymentTo: dubaiToday() })],
  ['plan', 'Has instalments', () => ({ hasPlan: 'true' })],
];
// Column → server sort key. Text columns start A→Z, numbers and dates start highest/newest first.
const INV_SORT = { no: 'number', parent: 'parent', players: 'players', pcount: 'players', loc: 'location', tot: 'total', refund: 'refunded',
  wo: 'writeOff', rec: 'received', wal: 'wallet', pend: 'pending', date: 'issueDate', st: 'status', pdate: 'paymentDate', mail: 'emailedAt' };
const INV_SORT_ASC_FIRST = new Set(['parent', 'location', 'status']);

VIEWS.invoices = async () => {
  await loadLookups();
  const v = (k) => esc(IF[k] ?? '');
  const sel = (k, opts) => `<select class="sel" id="if-${k}">${opts.map(([val, t]) => opt(val, t, (IF[k] ?? '') === val)).join('')}</select>`;
  $('page-acts').innerHTML = `<button class="btn sm ghost" data-act="invWide">${IF.wide ? 'Fewer columns' : 'All columns (VAT breakdown)'}</button>
    <button class="btn sm ghost" data-act="resetCols" data-a1="${IF.wide ? 'invwide' : 'inv'}" data-a2="invoices">Reset widths</button>`;
  $('view').innerHTML = `<div class="card filters">
    <div class="fgrid">
      <div class="w2"><label class="lbl" for="if-keyword">Search by keyword</label><input class="in" id="if-keyword" value="${v('keyword')}" placeholder="Name, email, mobile, invoice, description"></div>
      <div><label class="lbl" for="if-invoiceNo">Invoice no.</label><div class="pfx"><span>LA</span><input class="in" id="if-invoiceNo" value="${v('invoiceNo')}" placeholder="xxxxxxxx"></div></div>
      <div><label class="lbl" for="if-playerNo">Player no.</label><div class="pfx"><span>PL</span><input class="in" id="if-playerNo" value="${v('playerNo')}" placeholder="xxxxxxxx"></div></div>
      <div><label class="lbl" for="if-parentNo">Parent no.</label><div class="pfx"><span>PR</span><input class="in" id="if-parentNo" value="${v('parentNo')}" placeholder="xxxxxxxx"></div></div>
      <div><label class="lbl" for="if-status">Payment status</label>${sel('status', INV_STATUS)}</div>
      <div><label class="lbl" for="if-method">Payment method</label>${sel('method', [['', 'Any method'], ...METHOD_OPTS])}</div>
      <div><label class="lbl" for="if-additional">Additional invoices</label>${sel('additional', [['', 'Show all'], ['exclude', "Don't show additional"], ['only', 'Only additional']])}</div>
      <div><label class="lbl" for="if-custom">Custom invoices</label>${sel('custom', [['', 'Show all'], ['exclude', "Don't show custom"], ['only', 'Only custom']])}</div>
      <div><label class="lbl" for="if-ageGroupId">Category</label>${sel('ageGroupId', [['', 'Any category'], ...LK.ageGroups.map((a) => [a.id, a.code])])}</div>
      <div><label class="lbl" for="if-locationId">Location</label>${sel('locationId', [['', 'All locations'], ...LK.locations.map((l) => [l.id, shortLoc(l.name)])])}</div>
      <div><label class="lbl" for="if-termId">Term</label>${sel('termId', [['', 'Any term'], ...LK.terms.map((t) => [t.id, t.name + (LK.seasons.find((s) => s.id === t.seasonId) ? ' · ' + LK.seasons.find((s) => s.id === t.seasonId).name : '')])])}</div>
      <div><label class="lbl" for="if-invoiceFrom">Invoice date from</label><input class="in" type="date" id="if-invoiceFrom" value="${v('invoiceFrom')}"></div>
      <div><label class="lbl" for="if-invoiceTo">Invoice date to</label><input class="in" type="date" id="if-invoiceTo" value="${v('invoiceTo')}"></div>
      <div><label class="lbl" for="if-paymentFrom">Payment date from</label><input class="in" type="date" id="if-paymentFrom" value="${v('paymentFrom')}"></div>
      <div><label class="lbl" for="if-paymentTo">Payment date to</label><input class="in" type="date" id="if-paymentTo" value="${v('paymentTo')}"></div>
      <div><label class="lbl" for="if-amountFrom">Amount from</label><input class="in" type="number" step="0.01" id="if-amountFrom" value="${v('amountFrom')}"></div>
      <div><label class="lbl" for="if-amountTo">Amount up to</label><input class="in" type="number" step="0.01" id="if-amountTo" value="${v('amountTo')}"></div>
    </div>
    <div class="fbar"><div style="display:flex;gap:8px"><button class="btn sm" data-act="invSearch">Search</button><button class="btn sm ghost" data-act="invClear">Clear</button></div>
      <span class="fcount" id="if-count"></span><button class="btn sm ghost" data-act="invCsv">Export Excel</button></div></div>
  <div class="qchips" role="group" aria-label="Quick filters">${INV_QUICK.map(([k, l]) =>
    `<button class="qchip${IF.quick === k ? ' on' : ''}" data-act="invQuick" data-a1="${k}" aria-pressed="${IF.quick === k}">${l}</button>`).join('')}</div>
  <div id="if-tot"></div>
  <div id="if-bulk"></div>
  <div class="card tblwrap" id="if-tbl"><div class="loading">Loading…</div></div>`;
  $('view').querySelectorAll('.filters input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') ACT.invSearch(); }));
  await loadInvoices();
};
function readInvFilters() {
  for (const k of IF_KEYS) { const el = $('if-' + k); if (el) IF[k] = el.value.trim(); }
  const qs = new URLSearchParams();
  for (const k of IF_KEYS) if (IF[k]) qs.set(k, IF[k]);
  const quick = INV_QUICK.find(([k]) => k === IF.quick);
  if (quick) for (const [k, v] of Object.entries(quick[2]())) qs.set(k, v);
  if (IF.sort) { qs.set('sort', IF.sort); qs.set('dir', IF.dir || 'desc'); }
  return qs;
}
/** A new search or filter starts a new selection. */
function invNewSearch() { IF.page = 1; INV_SEL.clear(); INV_ALL = null; }
ACT.invSearch = () => { invNewSearch(); loadInvoices(); };
ACT.invClear = () => { invNewSearch(); IF = { page: 1, wide: IF.wide, sort: '', dir: '', quick: '' }; go('invoices'); };
ACT.invQuick = (k) => {
  IF.quick = IF.quick === k ? '' : k; invNewSearch();
  document.querySelectorAll('.qchip').forEach((b) => { const on = b.dataset.a1 === IF.quick; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  loadInvoices();
};
ACT.invSort = (key) => {
  if (IF.sort === key) IF.dir = IF.dir === 'asc' ? 'desc' : 'asc';
  else { IF.sort = key; IF.dir = INV_SORT_ASC_FIRST.has(key) ? 'asc' : 'desc'; }
  IF.page = 1; loadInvoices();
};
ACT.invWide = () => { IF.wide = !IF.wide; go('invoices'); };
ACT.invPage = (p) => { IF.page = Number(p); loadInvoices(); };
ACT.invCsv = async () => { try { await fetchFile('/invoice-register.csv?' + readInvFilters(), 'Invoices.csv'); } catch (e) { toast(e.message); } };
async function loadInvoices() {
  const qs = readInvFilters(); qs.set('page', IF.page); qs.set('limit', 50);
  const box = $('if-tbl'); if (!box) return;
  try {
    const d = await api('/invoice-register?' + qs);
    const t = d.totals;
    $('if-count').innerHTML = `<b>${t.count}</b> invoice${t.count === 1 ? '' : 's'}`;
    $('if-tot').innerHTML = `<div class="totbar"><span>Total <b>${money(t.total)}</b></span><span>Received <b class="good">${money(t.received)}</b></span>
      <span>Wallet <b>${money(t.wallet)}</b></span><span>Pending <b class="bad">${money(t.pending)}</b></span><span>Written off <b>${money(t.writeOff)}</b></span><span>Refunded <b>${money(t.refunded)}</b></span></div>`;
    const wide = IF.wide;
    INV_ROWS = new Map(d.data.map((i) => [i.id, i]));
    // "All columns" matches the old screen: players count, separate reasons, instalments as three columns.
    const head = [['act', 'Action'], ['no', 'Invoice No'], ['parent', 'Parent'], ['email', 'Email'], ['mobile', 'Mobile'], ['players', 'Players'],
      ...(wide ? [['pcount', 'Players Count']] : []), ['sub', 'Subscription Details'], ['loc', 'Location'],
      ['tot', 'Total incl. VAT'], ...(wide ? [['totx', 'Total excl. VAT'], ['vat', 'VAT Amount'], ['refund', 'Partial Refund incl. VAT'], ['rreason', 'Partial Refund Reason'],
        ['wo', 'Write Off incl. VAT'], ['wreason', 'Write Off Reason']] : []),
      ['rec', 'Received'], ...(wide ? [['vrec', 'VAT on Received'], ['nrec', 'Net Received excl. VAT']] : []), ['wal', 'Wallet'],
      ['pend', 'Pending'], ...(wide ? [['vpend', 'VAT on Pending'], ['npend', 'Net Pending excl. VAT'],
        ['inst', 'Total Installments'], ['instp', 'Paid Installments'], ['instq', 'Pending Installments']] : []),
      ['date', 'Invoice Date'], ['st', 'Payment Status'], ['pdate', 'Payment Date'], ['pm', 'Payment Method'], ['add', 'Additional'], ['mail', 'Emailed']];
    const num = new Set(['pcount', 'tot', 'totx', 'vat', 'refund', 'wo', 'rec', 'vrec', 'nrec', 'wal', 'pend', 'vpend', 'npend', 'inst', 'instp', 'instq']);
    const th = ([k, l]) => {
      const s = INV_SORT[k];
      if (!s) return `<th data-col="${k}" class="${num.has(k) ? 'num' : ''}">${l}</th>`;
      const on = IF.sort === s, arrow = on ? (IF.dir === 'asc' ? '▲' : '▼') : '';
      return `<th data-col="${k}" class="${num.has(k) ? 'num' : ''}" aria-sort="${on ? (IF.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">`
        + `<button class="thsort" data-act="invSort" data-a1="${s}" title="Sort by ${esc(l)}">${l}<span class="sarr">${arrow}</span></button></th>`;
    };
    const pageIds = d.data.map((i) => i.id);
    const allOnPage = pageIds.length > 0 && pageIds.every((id) => INV_ALL || INV_SEL.has(id));
    box.innerHTML = d.data.length ? `<table id="if-table" class="dir">
      <thead><tr><th class="selcol" data-col="sel"><input type="checkbox" data-act="invSelPage" aria-label="Select the invoices on this page"${allOnPage ? ' checked' : ''}></th>${head.map(th).join('')}</tr></thead>
      <tbody>${d.data.map((i) => `<tr>
        <td class="selcol"><input type="checkbox" data-act="invSel" data-a1="${i.id}" aria-label="Select ${esc(i.number)}"${INV_ALL || INV_SEL.has(i.id) ? ' checked' : ''}></td>
        <td><div class="rowacts"><button class="btn sm ghost" data-act="showInvoice" data-a1="${i.id}">Open</button><button class="btn sm ghost" data-act="invPdf" data-a1="${i.id}" data-a2="${esc(i.number)}" title="Preview the PDF">PDF</button><button class="btn sm ghost" data-act="invMenu" data-a1="${i.id}" title="More actions" aria-haspopup="menu">Actions ▾</button></div></td>
        <td>${invLink(i)}</td>
        <td title="${esc(i.parent.name)}">${esc(i.parent.name)} <span class="ref">${esc(i.parent.ref)}</span></td>
        <td title="${esc(i.parent.email || '')}">${esc(i.parent.email || '—')}</td><td>${esc(fmtPhone(i.parent.mobile))}</td>
        <td>${(i.players || []).map((p) => `<a class="lnk2" data-act="openPlayer" data-a1="${p.id}">${esc(p.ref)}</a> <span class="mini">${esc(p.name)}</span>`).join('<br>') || '—'}</td>
        ${wide ? `<td class="num">${i.playersCount}</td>` : ''}
        <td class="cm" title="${esc(i.subscription)}">${esc(i.subscription)}</td><td>${esc(i.location || '—')}</td>
        <td class="num">${f2(i.totalInclVat)}</td>
        ${wide ? `<td class="num">${f2(i.totalExclVat)}</td><td class="num">${f2(i.vat)}</td><td class="num">${f2(i.refunded)}</td><td class="cm" title="${esc(i.refundReason || '')}">${esc(i.refundReason || '—')}</td>
          <td class="num">${f2(i.writeOff)}</td><td class="cm" title="${esc(i.writeOffReason || '')}">${esc(i.writeOffReason || '—')}</td>` : ''}
        <td class="num">${f2(i.received)}</td>${wide ? `<td class="num">${f2(i.vatOnReceived)}</td><td class="num">${f2(i.netReceived)}</td>` : ''}
        <td class="num">${f2(i.wallet)}</td>
        <td class="num"><b class="${i.pending > 0 ? 'bad' : ''}">${f2(i.pending)}</b></td>
        ${wide ? `<td class="num">${f2(i.vatOnPending)}</td><td class="num">${f2(i.netPending)}</td>
          <td class="num">${i.installments.total}</td><td class="num">${i.installments.paid}</td><td class="num">${i.installments.pending}</td>` : ''}
        <td>${dmy(i.issueDate)}</td><td>${i.overdue ? '<span class="pill p-bad">Overdue</span>' : statusPill(i.status)}</td>
        <td>${dmy(i.lastPaymentAt)}</td><td>${esc(i.methods.join(', ') || '—')}</td><td>${i.additional ? 'Yes' : i.custom ? 'Custom' : 'No'}</td>
        <td>${i.emailedAt ? dmy(i.emailedAt) : '<span class="mini">—</span>'}</td></tr>`).join('')}</tbody></table>
      <div class="pager"><span>Page ${d.meta.page} of ${d.meta.pages}</span><span>
        <button class="btn sm ghost" data-act="invPage" data-a1="${d.meta.page - 1}" ${d.meta.page <= 1 ? 'disabled' : ''}>‹ Previous</button>
        <button class="btn sm ghost" data-act="invPage" data-a1="${d.meta.page + 1}" ${d.meta.page >= d.meta.pages ? 'disabled' : ''}>Next ›</button></span></div>`
      : '<div class="empty">No invoices match.</div>';
    resizableTable($('if-table'), wide ? 'invwide' : 'inv');
    IF.count = t.count;
    renderInvBulk();
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// ---------- invoices: selection and bulk actions ----------
const invSelCount = () => (INV_ALL ? INV_ALL.length : INV_SEL.size);
function renderInvBulk(progress) {
  const box = $('if-bulk'); if (!box) return;
  const n = invSelCount();
  if (!n && !progress) { box.innerHTML = ''; return; }
  if (progress) {
    box.innerHTML = `<div class="bulkbar" role="status"><span>${esc(progress.label)} — ${progress.done} of ${progress.total}</span>
      <progress max="${progress.total}" value="${progress.done}"></progress></div>`;
    return;
  }
  const more = !INV_ALL && IF.count > INV_SEL.size;
  box.innerHTML = `<div class="bulkbar"><span><b>${n}</b> invoice${n === 1 ? '' : 's'} selected${INV_ALL ? ' (every invoice in this search)' : ''}</span>
    ${more ? `<button class="btn sm ghost" data-act="invSelAll">Select all ${IF.count} in this search</button>` : ''}
    <span class="grow"></span>
    ${can('invoice.edit') ? '<button class="btn sm" data-act="invBulk" data-a1="email">Email invoices</button>' : ''}
    ${can('payment.create') ? '<button class="btn sm" data-act="invBulk" data-a1="links">Send payment links</button>' : ''}
    <button class="btn sm ghost" data-act="invBulkCsv">Export selected</button>
    <button class="btn sm ghost" data-act="invSelClear">Clear selection</button></div>`;
}
ACT.invSel = (id) => {
  if (INV_ALL) { INV_SEL = new Set(INV_ALL); INV_ALL = null; }   // un-ticking one row leaves an explicit selection
  INV_SEL.has(id) ? INV_SEL.delete(id) : INV_SEL.add(id);
  const head = document.querySelector('#if-table thead input[type=checkbox]');
  if (head) head.checked = [...INV_ROWS.keys()].every((x) => INV_SEL.has(x));
  renderInvBulk();
};
ACT.invSelPage = () => {
  if (INV_ALL) { INV_SEL = new Set(INV_ALL); INV_ALL = null; }
  const ids = [...INV_ROWS.keys()], all = ids.every((x) => INV_SEL.has(x));
  ids.forEach((x) => (all ? INV_SEL.delete(x) : INV_SEL.add(x)));
  document.querySelectorAll('#if-table tbody input[type=checkbox]').forEach((c) => { c.checked = !all; });
  renderInvBulk();
};
ACT.invSelAll = async () => {
  try {
    const qs = readInvFilters(); qs.delete('page'); qs.delete('limit');
    const r = await api('/invoice-register/ids?' + qs);
    INV_ALL = r.ids; INV_SEL.clear();
    if (r.capped) toast(`Selected the first ${r.cap} — narrow the search to act on the rest`);
    document.querySelectorAll('#if-table input[type=checkbox]').forEach((c) => { c.checked = true; });
    renderInvBulk();
  } catch (e) { toast(e.message); }
};
ACT.invSelClear = () => { INV_SEL.clear(); INV_ALL = null; document.querySelectorAll('#if-table input[type=checkbox]').forEach((c) => { c.checked = false; }); renderInvBulk(); };
ACT.invBulkCsv = async () => {
  try {
    // Every invoice in the search: export by the search itself; a hand-picked selection: by id.
    if (INV_ALL) return await fetchFile('/invoice-register.csv?' + readInvFilters(), 'Invoices.csv');
    if (INV_SEL.size > 150) return toast('Export up to 150 hand-picked invoices, or use "Select all in this search"');
    await fetchFile('/invoice-register.csv?ids=' + [...INV_SEL].join(','), 'Invoices-selected.csv');
  } catch (e) { toast(e.message); }
};
const INV_BULK = {
  email: { path: '/invoice-bulk/email', title: 'Email invoices', verb: 'Email', what: 'the invoice PDF to each parent (copied to the additional email)',
    note: 'Draft and cancelled invoices are skipped.' },
  links: { path: '/invoice-bulk/payment-links', title: 'Send payment links', verb: 'Send', what: 'a payment link for what is still owed to each parent',
    note: 'Paid, cancelled and draft invoices are skipped. Past the due date, the email reads as a reminder.' },
};
ACT.invBulk = (kind) => {
  const k = INV_BULK[kind], n = invSelCount(); if (!k || !n) return;
  openDrawer(k.title, `<p>${k.verb} ${esc(k.what)} — <b>${n}</b> invoice${n === 1 ? '' : 's'}.</p>
    <div class="note info">${esc(k.note)} Each one is logged in the Email log and the activity log.</div>
    <div class="row-end" style="margin-top:14px"><button class="btn ghost" data-act="closeDrawer">Cancel</button>
      <button class="btn" data-act="invBulkGo" data-a1="${kind}">${k.verb} ${n}</button></div>`);
};
ACT.invBulkGo = async (kind) => {
  const k = INV_BULK[kind]; if (!k) return;
  const ids = INV_ALL ? [...INV_ALL] : [...INV_SEL];
  closeDrawer();
  const results = [], BATCH = 25;
  try {
    for (let i = 0; i < ids.length; i += BATCH) {
      renderInvBulk({ label: k.title, done: i, total: ids.length });
      const r = await api(k.path, { method: 'POST', body: JSON.stringify({ ids: ids.slice(i, i + BATCH) }) });
      results.push(...r.results);
    }
  } catch (e) { toast(e.message); }
  const by = (o) => results.filter((r) => r.outcome === o);
  const word = { sent: 'Sent', recorded: 'Recorded only', skipped: 'Skipped', failed: 'Failed' };
  const stopped = results.length < ids.length ? `<div class="note bad">Stopped after ${results.length} of ${ids.length}. The rest were not processed.</div>` : '';
  openDrawer(`${k.title} — done`, `${stopped}
    <div class="totbar"><span>Sent <b class="good">${by('sent').length}</b></span><span>Recorded only <b>${by('recorded').length}</b></span>
      <span>Skipped <b>${by('skipped').length}</b></span><span>Failed <b class="bad">${by('failed').length}</b></span></div>
    ${by('recorded').length ? '<div class="note warn">Email is not connected yet, so these are recorded in the Email log but not delivered.</div>' : ''}
    <table class="dir"><thead><tr><th>Invoice</th><th>Result</th><th>Detail</th></tr></thead><tbody>
      ${results.map((r) => `<tr><td>${esc(r.number || '—')}</td><td>${word[r.outcome] || r.outcome}</td><td class="cm">${esc(r.detail)}</td></tr>`).join('')}</tbody></table>`, true);
  renderInvBulk();
  loadInvoices();
};

// ---------- the invoice drawer ----------
window.showInvoice = async (id) => {
  closeActMenu();
  openDrawer('Invoice', '<div class="loading">Loading…</div>');
  try {
    const [i, emails] = await Promise.all([
      api(`/invoices/${id}`),
      can('communication.view') ? api(`/email/log?kind=invoice`).catch(() => []) : Promise.resolve([]),
    ]);
    const mine = emails.filter((e) => (e.attachments || []).some((a) => a.id === i.id));
    const pays = (i.payments || []).filter((p) => p.status === 'COMPLETED');
    const sum = (f) => pays.filter(f).reduce((s, p) => s + (p.direction === 'REFUND' ? -1 : 1) * Number(p.amount), 0);
    const received = sum((p) => p.method !== 'WALLET'), wallet = sum((p) => p.method === 'WALLET');
    const bal = Math.max(0, Number(i.total) - Number(i.amountPaid) + Number(i.amountRefunded) - Number(i.writeOffAmount));
    const open = ['ISSUED', 'PART_PAID'].includes(i.status) && bal > 0.05;
    const row = (k, v, cls) => `<div class="irow ${cls || ''}"><span>${k}</span><span class="num">${v}</span></div>`;
    openDrawer('Invoice ' + i.number, `
      <div class="iacts">
        <button class="btn sm" data-act="invPdf" data-a1="${i.id}" data-a2="${esc(i.number)}">Preview PDF</button>
        <button class="btn sm ghost" data-act="invPdfDl" data-a1="${i.id}" data-a2="${esc(i.number)}">Download</button>
        ${i.status !== 'DRAFT' && can('invoice.edit') ? `<button class="btn sm ghost" data-act="invEmail" data-a1="${i.id}">${mine.length ? 'Resend email' : 'Email to parent'}</button>` : ''}
        ${i.status === 'DRAFT' && can('invoice.edit') ? `<button class="btn sm ghost" data-act="invIssue" data-a1="${i.id}">Issue</button>` : ''}
        ${open && can('payment.create') ? `<button class="btn sm ghost" data-act="invLinkCopy" data-a1="${i.id}">Copy payment link</button><button class="btn sm ghost" data-act="invLinkSend" data-a1="${i.id}">Send payment link</button>` : ''}
      </div>
      <dl class="kv" style="margin-top:12px">
        <dt>Parent</dt><dd>${esc(i.guardian?.fullName || '—')} <span class="ref">${esc(i.guardian?.reference || '')}</span><div class="mini">${esc(i.guardian?.email || '')}</div></dd>
        <dt>Status</dt><dd>${statusPill(i.status)}</dd>
        <dt>Issued</dt><dd>${dt(i.issueDate)}</dd><dt>Due</dt><dd>${dt(i.dueDate)}</dd>
        <dt>Emailed</dt><dd>${mine.length ? mine.map((e) => `${dtm(e.at)} <span class="mini">${e.simulated ? 'recorded (email not connected)' : e.status === 'FAILED' ? 'failed' : 'sent to ' + esc(e.to)}</span>`).join('<br>') : '<span class="mini">not yet</span>'}</dd>
      </dl>
      <h3 class="dh3">Lines</h3>
      <table><tbody>${(i.lineItems || []).map((l) => `<tr><td>${esc(l.description)}${l.player ? ` <a class="lnk2" data-act="openPlayer" data-a1="${l.player.id}">${esc(l.player.reference)}</a>` : ''}</td><td class="num">${money(l.lineTotal)}</td></tr>`).join('')}</tbody></table>
      ${(i.discounts || []).length ? `<div style="margin-top:8px">${i.discounts.map((d) => `<div class="mini">− ${money(d.amount)} · ${esc(d.label)}</div>`).join('')}</div>` : ''}
      <div id="inv-train"></div>
      <div id="inv-plan"></div>
      <div class="ibox">
        ${row('Subtotal (excl. VAT)', money(i.subtotal))}${row('VAT 5%', money(i.vatTotal))}${row('<b>Total</b>', '<b>' + money(i.total) + '</b>', 'tot')}
        ${row('Received (direct money)', money(received), 'good')}${wallet ? row('Paid from wallet', money(wallet)) : ''}
        ${Number(i.writeOffAmount) ? row('Written off', money(i.writeOffAmount)) : ''}
        ${row(bal > 0.05 ? '<b>Balance</b>' : 'Balance', bal > 0.05 ? `<b>${money(bal)}</b>` : 'Settled', bal > 0.05 ? 'bad' : 'good')}
      </div>
      <h3 class="dh3">Payments</h3>
      <table><tbody>${pays.map((p) => `<tr><td>${dmy(p.paidAt)}<div class="mini">${esc(METHOD_WORD[p.method] || p.method)}${p.merchantName ? ' · ' + esc(p.merchantName) + ' ' + esc(p.merchantNumber || '') : ''}${p.reference ? ' · ref ' + esc(p.reference) : ''}</div></td>
        <td>${p.direction === 'REFUND' ? '<span class="pill p-warn">refund</span>' : ''}</td><td class="num">${p.direction === 'REFUND' ? '−' : ''}${money(p.amount)}</td></tr>`).join('') || '<tr><td class="empty">No payments yet.</td></tr>'}</tbody></table>
      ${open && can('payment.create') ? `<h3 class="dh3">Record a payment</h3><div class="frm" id="pay-form">
        <div class="full" id="pay-instwrap" hidden><label class="lbl" for="pay-inst">For instalment</label><select class="sel" id="pay-inst"></select></div>
        <div><label class="lbl" for="pay-amt">Amount (AED)</label><input class="in" id="pay-amt" type="number" step="0.01" min="0.01" value="${bal.toFixed(2)}"></div>
        <div><label class="lbl" for="pay-method">Payment method</label><select class="sel" id="pay-method">${METHOD_OPTS.filter(([k]) => k !== 'WALLET').map(([k, v]) => opt(k, v, k === 'CARD')).join('')}</select></div>
        <div><label class="lbl" for="pay-merch">Merchant</label><select class="sel" id="pay-merch"></select></div>
        <div><label class="lbl" for="pay-ref">Payment reference</label><input class="in" id="pay-ref" placeholder="Authorisation code / transfer ref"></div>
        <div><label class="lbl" for="pay-date">Payment date</label><input class="in" id="pay-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div><label class="lbl" for="pay-notes">Notes</label><input class="in" id="pay-notes"></div>
      </div><div id="pay-err" style="margin-top:8px"></div>
      <div class="row-end"><button class="btn" data-act="recordPayment" data-a1="${i.id}">Record payment</button></div>` : ''}
      ${(open || received + wallet > 0.005) && (can('writeoff.create') || can('refund.create') || can('invoice.edit')) ? `<details id="inv-more" style="margin-top:14px"><summary class="mini" style="cursor:pointer">Write off, refund or cancel</summary>
        <div class="frm" style="margin-top:10px">
          ${open && can('writeoff.create') ? `<div><label class="lbl" for="wo-amt">Write off (AED)</label><input class="in" id="wo-amt" type="number" step="0.01" min="0.01"></div>
          <div><label class="lbl" for="wo-rsn">Reason</label><input class="in" id="wo-rsn" placeholder="Why — kept on the invoice"></div>
          <div class="full"><button class="btn sm ghost" data-act="invWriteOff" data-a1="${i.id}">Write off</button></div>` : ''}
          ${can('refund.create') && Number(i.amountPaid) - Number(i.amountRefunded) > 0.005 ? `<div><label class="lbl" for="rf-amt">Partial refund (AED)</label><input class="in" id="rf-amt" type="number" step="0.01" min="0.01" max="${(Number(i.amountPaid) - Number(i.amountRefunded)).toFixed(2)}"></div>
          <div><label class="lbl" for="rf-rsn">Reason</label><input class="in" id="rf-rsn" placeholder="Why — kept on the invoice"></div>
          <div class="full"><label class="chk"><input type="checkbox" id="rf-wal"> Credit the family wallet instead of paying it back</label> <button class="btn sm ghost" data-act="invRefund" data-a1="${i.id}">Refund</button></div>` : ''}
          ${can('invoice.edit') && Number(i.amountPaid) <= 0.005 && i.status !== 'CANCELLED' ? `<div class="full" id="cx-box"><button class="btn sm ghost" data-act="invCancel" data-a1="${i.id}">Cancel invoice</button> <span class="mini">Only before any payment; it stays on record as cancelled.</span></div>` : ''}
        </div></details>` : ''}`);
    loadInvTraining(i.id);
    loadInvPlan(i.id);
    const ms = $('pay-merch');
    if (ms) {
      const merchants = await api('/merchants?activeOnly=true').catch(() => []);
      const fill = () => {
        const m = $('pay-method').value;
        const fit = merchants.filter((x) => !x.methods?.length || x.methods.includes(m));
        ms.innerHTML = opt('', fit.length ? '— none —' : 'Not used for this method') + fit.map((x) => opt(x.id, `${x.name} · ${x.merchantNumber}`, fit.length === 1)).join('');
      };
      $('pay-method').addEventListener('change', fill); fill();
    }
  } catch (e) { openDrawer('Invoice', `<div class="empty">${esc(e.message)}</div>`); }
};
window.recordPayment = async (id) => {
  const amt = Number($('pay-amt').value);
  if (!(amt > 0)) { $('pay-err').innerHTML = '<div class="note bad">Enter an amount.</div>'; return; }
  const body = { amount: amt, method: $('pay-method').value, merchantId: $('pay-merch').value || undefined, instalmentSeq: $('pay-inst')?.value ? Number($('pay-inst').value) : undefined,
    reference: $('pay-ref').value.trim() || undefined, paidAt: $('pay-date').value || undefined, notes: $('pay-notes').value.trim() || undefined };
  try {
    const r = await api(`/invoices/${id}/payments`, { method: 'POST', body: JSON.stringify(body) });
    toast('Payment recorded — ' + String(r.invoice.status).replace('_', ' ').toLowerCase());
    window.showInvoice(id); if (CURRENT === 'invoices') loadInvoices(); if (CURRENT === 'paymentReport') loadPaymentReport();
  } catch (e) { $('pay-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};
ACT.invWriteOff = async (id) => {
  const amount = Number($('wo-amt').value), reason = $('wo-rsn').value.trim();
  if (!(amount > 0) || reason.length < 3) return toast('Write-off needs an amount and a reason');
  try { await api(`/invoices/${id}/write-off`, { method: 'POST', body: JSON.stringify({ amount, reason }) }); toast('Written off'); window.showInvoice(id); }
  catch (e) { toast(e.message); }
};
ACT.invRefund = async (id) => {
  const amount = Number($('rf-amt').value), reason = $('rf-rsn').value.trim();
  if (!(amount > 0) || reason.length < 3) return toast('A refund needs an amount and a reason');
  try { await api(`/invoices/${id}/refund`, { method: 'POST', body: JSON.stringify({ amount, reason, toWallet: $('rf-wal').checked || undefined }) }); toast('Refund recorded'); window.showInvoice(id); if (CURRENT === 'invoices') loadInvoices(); }
  catch (e) { toast(e.message); }
};
ACT.invCancel = async (id, sure) => {
  if (!sure) { $('cx-box').innerHTML = `<button class="btn sm" data-act="invCancel" data-a1="${id}" data-a2="yes">Yes, cancel this invoice</button> <a class="lnk2" data-act="showInvoice" data-a1="${id}">Keep it</a>`; return; }
  try { await api(`/invoices/${id}/cancel`, { method: 'POST', body: '{}' }); toast('Invoice cancelled'); window.showInvoice(id); if (CURRENT === 'invoices') loadInvoices(); }
  catch (e) { toast(e.message); }
};
ACT.invIssue = async (id) => {
  try { await api(`/invoices/${id}/issue`, { method: 'POST', body: '{}' }); toast('Issued'); window.showInvoice(id); }
  catch (e) { toast(e.message); }
};

// ================= inventory =================
const PROG_WORD = { LALIGA: 'LaLiga', ADSC: 'ADSC' };
const MOVE_WORD = { OPENING: 'Opening', IN: 'In', OUT: 'Out', ADJUST: 'Stock take' };
let INVF = { tab: 'stock', programme: 'LALIGA', category: '', search: '', status: '' };
let INV_ITEMS = [];

VIEWS.inventory = async () => {
  $('page-title').textContent = 'Inventory';
  const edit = can('inventory.edit');
  $('page-acts').innerHTML = `${edit ? `<button class="btn sm" data-act="stkMove" data-a1="IN">Stock in</button>
    <button class="btn sm" data-act="stkMove" data-a1="OUT">Stock out</button>
    <button class="btn sm ghost" data-act="stkMove" data-a1="ADJUST">Stock take</button>` : ''}
    ${can('inventory.create') ? '<button class="btn sm ghost" data-act="stkNew">+ New item</button>' : ''}
    ${(ME?.permissions || []).includes('*') ? '<button class="btn sm ghost" data-act="stkReset" title="Remove every item and movement and start again">Start again…</button>' : ''}`;
  $('view').innerHTML = `<div class="tabs">${[['stock', 'Stock'], ['moves', 'In & out log'], ['summary', 'By item']].map(([k, t]) =>
      `<button class="tab ${INVF.tab === k ? 'on' : ''}" data-act="stkTab" data-a1="${k}">${t}</button>`).join('')}
      <span class="seg">${[['LALIGA', 'LaLiga'], ['ADSC', 'ADSC'], ['', 'Both']].map(([k, t]) =>
      `<button class="${INVF.programme === k ? 'on' : ''}" data-act="stkProg" data-a1="${k}">${t}</button>`).join('')}</span></div>
    <div id="stk-body"><div class="loading">Loading…</div></div>`;
  await ({ stock: stkStock, moves: stkMoves, summary: stkSummary })[INVF.tab]();
};
ACT.stkTab = (t) => { INVF.tab = t; go('inventory'); };
// Super admin only: empty the store (every item and its history) and leave one practice item.
ACT.stkReset = () => openDrawer('Start the inventory again', `
  <div class="note bad">This removes <b>every item and every stock movement</b> (LaLiga and ADSC) and can't be undone. One practice item, <b>LL-TEST-M</b> with 10 pieces, is left so you can try stock in, stock out and a stock take before adding the real stock by hand.</div>
  <div class="frm" style="margin-top:12px"><div class="full"><label class="lbl" for="sr-confirm">Type CLEAR INVENTORY to confirm</label><input class="in" id="sr-confirm" autocomplete="off"></div></div>
  <div id="sr-err" style="margin-top:8px"></div>
  <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" data-act="stkResetGo">Clear the inventory</button></div>`);
ACT.stkResetGo = async () => {
  try {
    const r = await api('/inventory/reset', { method: 'POST', body: JSON.stringify({ confirm: $('sr-confirm').value.trim() }) });
    closeDrawer(); toast(`Inventory cleared — ${r.removedItems} items removed, practice item LL-TEST-M kept`); go('inventory');
  } catch (e) { $('sr-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};
ACT.stkProg = (p) => { INVF.programme = p; go('inventory'); };

async function stkStock() {
  const qs = new URLSearchParams();
  for (const k of ['programme', 'category', 'search', 'status']) if (INVF[k]) qs.set(k, INVF[k]);
  const d = await api('/inventory/items?' + qs);
  INV_ITEMS = d.items;
  const t = d.totals;
  $('stk-body').innerHTML = `<div class="card filters"><div class="fgrid">
      <div class="w2"><label class="lbl" for="stk-q">Search</label><input class="in" id="stk-q" value="${esc(INVF.search)}" placeholder="SKU, item code, name or box"></div>
      <div><label class="lbl" for="stk-cat">Category</label><select class="sel" id="stk-cat">${opt('', 'All categories')}${d.categories.map((c) => opt(c, c, INVF.category === c)).join('')}</select></div>
      <div><label class="lbl" for="stk-st">Stock</label><select class="sel" id="stk-st">${[['', 'Any'], ['LOW', 'Low'], ['OUT', 'Out of stock'], ['OK', 'OK']].map(([k, v]) => opt(k, v, INVF.status === k)).join('')}</select></div>
    </div><div class="fbar"><span class="fcount"><b>${t.skus}</b> SKUs · <b>${t.units.toLocaleString()}</b> units · ${t.low} low · ${t.out} out of stock</span>
      <button class="btn sm ghost" data-act="stkCsv" data-a1="items">Export Excel</button></div></div>
    <div class="card tblwrap"><table id="stk-tbl" class="dir"><thead><tr>
      <th data-col="sku">SKU</th><th data-col="code">Item ID</th><th data-col="name">Item</th><th data-col="prog">Programme</th><th data-col="cat">Category</th>
      <th data-col="size">Size</th><th data-col="stock" class="num">In stock</th><th data-col="min" class="num">Min</th><th data-col="st">Status</th><th data-col="loc">Location</th><th data-col="act"></th></tr></thead>
      <tbody>${d.items.map((i) => `<tr>
        <td class="mono"><b>${esc(i.sku)}</b></td><td class="mono mini" title="${esc(i.itemCode)}">${esc(i.itemCode)}</td><td title="${esc(i.name)}">${esc(i.name)}</td>
        <td>${esc(PROG_WORD[i.programme] || i.programme)}</td><td>${esc(i.category)}</td><td>${esc(i.size || '—')}</td>
        <td class="num"><b>${i.currentStock}</b> <span class="mini">${esc(i.unit)}</span></td><td class="num">${i.minLevel ?? '—'}</td>
        <td>${i.status === 'OUT' ? '<span class="pill p-bad">Out</span>' : i.status === 'LOW' ? '<span class="pill p-warn">Low</span>' : '<span class="pill p-good">OK</span>'}</td>
        <td title="${esc(i.location || '')}">${esc(i.location || '—')}</td>
        <td><button class="btn sm ghost" data-act="stkItem" data-a1="${i.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="11" class="empty">No items match.</td></tr>'}</tbody></table></div>`;
  $('stk-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { INVF.search = e.target.value.trim(); stkStock(); } });
  $('stk-cat').addEventListener('change', (e) => { INVF.category = e.target.value; stkStock(); });
  $('stk-st').addEventListener('change', (e) => { INVF.status = e.target.value; stkStock(); });
  resizableTable($('stk-tbl'), 'stock');
}

async function stkMoves() {
  const qs = new URLSearchParams({ limit: '500' });
  if (INVF.programme) qs.set('programme', INVF.programme);
  if (INVF.mFrom) qs.set('from', INVF.mFrom); if (INVF.mTo) qs.set('to', INVF.mTo);
  if (INVF.mType) qs.set('type', INVF.mType); if (INVF.mSearch) qs.set('search', INVF.mSearch);
  const rows = await api('/inventory/movements?' + qs);
  $('stk-body').innerHTML = `<div class="card filters"><div class="fgrid">
      <div><label class="lbl" for="mv-from">From</label><input class="in" type="date" id="mv-from" value="${esc(INVF.mFrom || '')}"></div>
      <div><label class="lbl" for="mv-to">To</label><input class="in" type="date" id="mv-to" value="${esc(INVF.mTo || '')}"></div>
      <div><label class="lbl" for="mv-type">Type</label><select class="sel" id="mv-type">${opt('', 'All')}${Object.entries(MOVE_WORD).map(([k, v]) => opt(k, v, INVF.mType === k)).join('')}</select></div>
      <div class="w2"><label class="lbl" for="mv-q">Search</label><input class="in" id="mv-q" value="${esc(INVF.mSearch || '')}" placeholder="SKU, item, person, reference or batch"></div>
    </div><div class="fbar"><span class="fcount"><b>${rows.length}</b> movements</span><button class="btn sm ghost" data-act="stkCsv" data-a1="movements">Export Excel</button></div></div>
    <div class="card tblwrap"><table id="mv-tbl" class="dir"><thead><tr><th data-col="d">Date</th><th data-col="t">Type</th><th data-col="sku">SKU</th><th data-col="i">Item</th><th data-col="s">Size</th>
      <th data-col="q" class="num">Qty</th><th data-col="b" class="num">Balance after</th><th data-col="p">Given to / from</th><th data-col="r">Reason</th><th data-col="ref">Reference</th><th data-col="batch">Batch</th></tr></thead>
      <tbody>${rows.map((m) => `<tr><td>${dmy(m.movedOn)}</td><td><span class="pill ${m.quantity < 0 ? 'p-warn' : m.type === 'OPENING' ? 'p-mute' : 'p-good'}">${esc(MOVE_WORD[m.type])}</span></td>
        <td class="mono">${esc(m.item.sku)}</td><td>${esc(m.item.name)}</td><td>${esc(m.item.size || '—')}</td>
        <td class="num"><b>${m.quantity > 0 ? '+' : ''}${m.quantity}</b></td><td class="num">${m.balanceAfter}</td>
        <td title="${esc(m.party || '')}">${esc(m.party || '—')}</td><td class="cm">${esc(m.reason || '—')}</td><td>${esc(m.reference || '—')}</td><td class="mono mini">${esc(m.batch || '')}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">Nothing recorded yet.</td></tr>'}</tbody></table></div>`;
  const re = () => { INVF.mFrom = $('mv-from').value; INVF.mTo = $('mv-to').value; INVF.mType = $('mv-type').value; INVF.mSearch = $('mv-q').value.trim(); stkMoves(); };
  ['mv-from', 'mv-to', 'mv-type'].forEach((id) => $(id).addEventListener('change', re));
  $('mv-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') re(); });
  resizableTable($('mv-tbl'), 'moves');
}

async function stkSummary() {
  const rows = await api('/inventory/summary' + (INVF.programme ? '?programme=' + INVF.programme : ''));
  const tot = rows.reduce((s, r) => s + r.stock, 0);
  $('stk-body').innerHTML = `<div class="card tblwrap"><table id="sum-tbl"><thead><tr><th data-col="c">Item ID</th><th data-col="n">Item</th><th data-col="p">Programme</th><th data-col="cat">Category</th>
    <th data-col="s" class="num">Sizes</th><th data-col="o" class="num">Opening</th><th data-col="in" class="num">Total in</th><th data-col="out" class="num">Total out</th><th data-col="st" class="num">In stock</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="mono">${esc(r.itemCode)}</td><td>${esc(r.name)}</td><td>${esc(PROG_WORD[r.programme] || r.programme)}</td><td>${esc(r.category)}</td>
      <td class="num">${r.sizes}</td><td class="num">${r.opening}</td><td class="num">${r.totalIn}</td><td class="num">${r.totalOut}</td><td class="num"><b>${r.stock}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="8" class="num"><b>Total</b></td><td class="num"><b>${tot.toLocaleString()}</b></td></tr></tfoot></table></div>`;
  resizableTable($('sum-tbl'), 'stocksum');
}

ACT.stkCsv = async (kind) => {
  const qs = new URLSearchParams(); if (INVF.programme) qs.set('programme', INVF.programme);
  try { await fetchFile(`/inventory/${kind}.csv?${qs}`, kind === 'items' ? 'Inventory.csv' : 'Inventory-movements.csv'); } catch (e) { toast(e.message); }
};

ACT.stkItem = async (id) => {
  const d = await api('/inventory/items/' + id);
  const i = d.item, edit = can('inventory.edit');
  openDrawer(`${i.sku} — ${i.name}`, `
    <dl class="kv"><dt>Item ID</dt><dd class="mono">${esc(i.itemCode)}</dd><dt>Programme</dt><dd>${esc(PROG_WORD[i.programme])}</dd>
      <dt>Size</dt><dd>${esc(i.size || '—')}</dd><dt>In stock</dt><dd><b>${i.currentStock}</b> ${esc(i.unit)}</dd></dl>
    <h3 class="dh3">All sizes</h3><div class="chips">${d.sizes.map((s) => `<button class="chipbtn ${s.id === i.id ? 'on' : ''}" data-act="stkItem" data-a1="${s.id}">${esc(s.size || 'One size')} · <b>${s.currentStock}</b></button>`).join('')}</div>
    ${edit ? `<h3 class="dh3">Details</h3><div class="frm">
      <div class="full"><label class="lbl" for="it-name">Name</label><input class="in" id="it-name" value="${esc(i.name)}"></div>
      <div><label class="lbl" for="it-cat">Category</label><input class="in" id="it-cat" value="${esc(i.category)}"></div>
      <div><label class="lbl" for="it-cond">Condition</label><input class="in" id="it-cond" value="${esc(i.condition)}"></div>
      <div><label class="lbl" for="it-min">Low-stock level</label><input class="in" id="it-min" type="number" min="0" value="${i.minLevel ?? ''}"></div>
      <div><label class="lbl" for="it-loc">Location / box</label><input class="in" id="it-loc" value="${esc(i.location || '')}"></div>
      <div class="full"><label class="lbl" for="it-notes">Notes</label><input class="in" id="it-notes" value="${esc(i.notes || '')}"></div>
      <label class="chk full"><input type="checkbox" id="it-act" ${i.isActive ? 'checked' : ''}> In use (untick to hide an item you no longer stock)</label></div>
      <div class="row-end"><button class="btn sm" data-act="stkSave" data-a1="${i.id}">Save</button></div>` : ''}
    <h3 class="dh3">History</h3><table><tbody>${d.history.map((m) => `<tr><td>${dmy(m.movedOn)}<div class="mini">${esc(MOVE_WORD[m.type])}${m.party ? ' · ' + esc(m.party) : ''}${m.reason ? ' · ' + esc(m.reason) : ''}</div></td>
      <td class="num"><b>${m.quantity > 0 ? '+' : ''}${m.quantity}</b></td><td class="num mini">→ ${m.balanceAfter}</td></tr>`).join('')}</tbody></table>`);
};
ACT.stkSave = async (id) => {
  const body = { name: $('it-name').value.trim(), category: $('it-cat').value.trim(), condition: $('it-cond').value.trim(),
    location: $('it-loc').value.trim(), notes: $('it-notes').value.trim(), isActive: $('it-act').checked };
  const min = $('it-min').value; if (min !== '') body.minLevel = Number(min);
  try { await api('/inventory/items/' + id, { method: 'PATCH', body: JSON.stringify(body) }); toast('Saved'); ACT.stkItem(id); if (CURRENT === 'inventory') go('inventory'); }
  catch (e) { toast(e.message); }
};

// ---- stock in / out / take: several lines in one go ----
let MV = null;
ACT.stkMove = async (type) => {
  if (!INV_ITEMS.length) { const d = await api('/inventory/items' + (INVF.programme ? '?programme=' + INVF.programme : '')); INV_ITEMS = d.items; }
  MV = { type, lines: [{ sku: '', qty: '' }] };
  const title = { IN: 'Stock in — items received', OUT: 'Stock out — items given out', ADJUST: 'Stock take — counted quantities' }[type];
  openDrawer(title, `
    <datalist id="sku-list">${INV_ITEMS.map((i) => `<option value="${esc(i.sku)}">${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''} (${i.currentStock})</option>`).join('')}</datalist>
    <div class="frm">
      <div><label class="lbl" for="mv-date">Date</label><input class="in" id="mv-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div><label class="lbl" for="mv-party">${type === 'IN' ? 'Received from' : type === 'OUT' ? 'Given to *' : 'Counted by'}</label><input class="in" id="mv-party" placeholder="${type === 'IN' ? 'Supplier / person' : type === 'OUT' ? 'Coach, team, player or event' : 'Name'}"></div>
      <div><label class="lbl" for="mv-reason">Reason</label><input class="in" id="mv-reason" placeholder="${type === 'OUT' ? 'e.g. Match kits — Abu Dhabi Cup' : type === 'IN' ? 'e.g. Puma delivery' : 'e.g. October stock take'}"></div>
      <div><label class="lbl" for="mv-ref">Reference</label><input class="in" id="mv-ref" placeholder="Delivery note, invoice LA-…"></div>
    </div>
    <h3 class="dh3">${type === 'ADJUST' ? 'Items counted' : 'Items'} <span class="mini">type or scan the SKU</span></h3>
    <div id="mv-lines"></div>
    <button class="btn sm ghost" data-act="mvAdd" style="margin-top:6px">+ Another item</button>
    <div id="mv-err" style="margin-top:10px"></div>
    <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" data-act="mvSave">Save</button></div>`);
  drawMvLines();
};
function drawMvLines() {
  const adj = MV.type === 'ADJUST';
  $('mv-lines').innerHTML = MV.lines.map((l, i) => {
    const item = INV_ITEMS.find((x) => x.sku === l.sku.toUpperCase());
    return `<div class="mvline"><input class="in mono" list="sku-list" data-mvs="${i}" value="${esc(l.sku)}" placeholder="LL-004-M" aria-label="SKU">
      <input class="in qty" type="number" min="${adj ? 0 : 1}" data-mvq="${i}" value="${esc(l.qty)}" placeholder="${adj ? 'Counted' : 'Qty'}" aria-label="Quantity">
      <span class="mini mvinfo">${item ? `${esc(item.name)}${item.size ? ' · ' + esc(item.size) : ''} — ${item.currentStock} in stock` : l.sku ? '<span style="color:var(--bad)">unknown SKU</span>' : ''}</span>
      ${MV.lines.length > 1 ? `<button class="close" data-act="mvDel" data-a1="${i}" aria-label="Remove line">×</button>` : ''}</div>`;
  }).join('');
  document.querySelectorAll('[data-mvs]').forEach((el) => el.addEventListener('change', (e) => { MV.lines[+el.dataset.mvs].sku = e.target.value.trim(); drawMvLines(); }));
  document.querySelectorAll('[data-mvq]').forEach((el) => el.addEventListener('input', (e) => { MV.lines[+el.dataset.mvq].qty = e.target.value; }));
}
ACT.mvAdd = () => { MV.lines.push({ sku: '', qty: '' }); drawMvLines(); const last = document.querySelector(`[data-mvs="${MV.lines.length - 1}"]`); if (last) last.focus(); };
ACT.mvDel = (i) => { MV.lines.splice(Number(i), 1); drawMvLines(); };
ACT.mvSave = async () => {
  const adj = MV.type === 'ADJUST';
  const lines = MV.lines.filter((l) => l.sku && l.qty !== '').map((l) => adj ? { sku: l.sku, countedQty: Number(l.qty) } : { sku: l.sku, quantity: Number(l.qty) });
  if (!lines.length) { $('mv-err').innerHTML = '<div class="note bad">Add at least one SKU and quantity.</div>'; return; }
  const body = { type: MV.type, movedOn: $('mv-date').value, party: $('mv-party').value.trim() || undefined,
    reason: $('mv-reason').value.trim() || undefined, reference: $('mv-ref').value.trim() || undefined, lines };
  try {
    const r = await api('/inventory/movements', { method: 'POST', body: JSON.stringify(body) });
    openDrawer('Saved', `<div class="note good">${r.movements} item${r.movements === 1 ? '' : 's'} recorded · batch <span class="mono">${esc(r.batch)}</span></div>
      <table style="margin-top:12px"><tbody>${r.items.map((i) => `<tr><td class="mono">${esc(i.sku)}</td><td>${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''}</td><td class="num">now <b>${i.stock}</b></td></tr>`).join('')}</tbody></table>
      <div class="row-end"><button class="btn" data-act="closeDrawer">Done</button></div>`);
    INV_ITEMS = []; if (CURRENT === 'inventory') go('inventory');
  } catch (e) {
    const lines2 = e.body?.lines;
    $('mv-err').innerHTML = `<div class="note bad">${lines2 ? lines2.map(esc).join('<br>') : esc(e.message)}</div>`;
  }
};

// ---- new item, any number of sizes ----
ACT.stkNew = () => {
  openDrawer('New item', `<div class="frm">
      <div class="full"><label class="lbl" for="ni-name">Item name *</label><input class="in" id="ni-name" placeholder="e.g. Puma Red Training Top"></div>
      <div><label class="lbl" for="ni-prog">Programme</label><select class="sel" id="ni-prog">${opt('LALIGA', 'LaLiga', INVF.programme !== 'ADSC')}${opt('ADSC', 'ADSC', INVF.programme === 'ADSC')}</select></div>
      <div><label class="lbl" for="ni-cat">Category *</label><input class="in" id="ni-cat" list="cat-list" placeholder="T-shirts, Shorts, Balls…"><datalist id="cat-list">${[...new Set(INV_ITEMS.map((i) => i.category))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div><label class="lbl" for="ni-unit">Unit</label><select class="sel" id="ni-unit">${['Pcs', 'Set', 'Pack', 'Box', 'Pair'].map((u) => opt(u, u)).join('')}</select></div>
      <div><label class="lbl" for="ni-loc">Location / box</label><input class="in" id="ni-loc"></div>
      <div class="full"><label class="lbl" for="ni-sizes">Sizes and opening quantities</label>
        <textarea class="in" id="ni-sizes" placeholder="One per line: size = quantity&#10;8 = 20&#10;10 = 25&#10;S = 12&#10;(leave empty for a one-size item)"></textarea>
        <div class="hint">Each size becomes its own number, e.g. LL-023-8, LL-023-10, LL-023-S.</div></div>
      <div id="ni-one" class="full"><label class="lbl" for="ni-qty">Opening quantity (one-size item)</label><input class="in" id="ni-qty" type="number" min="0" value="0"></div>
    </div><div id="ni-err" style="margin-top:10px"></div>
    <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" data-act="stkNewGo">Add item</button></div>`);
};
ACT.stkNewGo = async () => {
  const raw = $('ni-sizes').value.trim();
  let sizes = [];
  if (raw) {
    for (const line of raw.split(/\n+/)) {
      const m = line.match(/^\s*([^=:]+?)\s*[=:]\s*(\d+)\s*$/) || line.match(/^\s*(\S+)\s*$/);
      if (!m) { $('ni-err').innerHTML = `<div class="note bad">Can't read "${esc(line)}" — use size = quantity.</div>`; return; }
      sizes.push({ size: m[1], openingQty: Number(m[2] || 0) });
    }
  } else sizes = [{ openingQty: Number($('ni-qty').value || 0) }];
  const body = { name: $('ni-name').value.trim(), programme: $('ni-prog').value, category: $('ni-cat').value.trim(),
    unit: $('ni-unit').value, location: $('ni-loc').value.trim() || undefined, sizes };
  if (body.name.length < 2 || body.category.length < 2) { $('ni-err').innerHTML = '<div class="note bad">Name and category are needed.</div>'; return; }
  try {
    const r = await api('/inventory/items', { method: 'POST', body: JSON.stringify(body) });
    openDrawer('Item added', `<div class="note good">${esc(body.name)} added with ${r.length} number${r.length === 1 ? '' : 's'}:</div>
      <table style="margin-top:10px"><tbody>${r.map((i) => `<tr><td class="mono"><b>${esc(i.sku)}</b></td><td>${esc(i.size || 'one size')}</td><td class="num">${i.currentStock}</td></tr>`).join('')}</tbody></table>
      <div class="row-end"><button class="btn" data-act="closeDrawer">Done</button></div>`);
    INV_ITEMS = []; if (CURRENT === 'inventory') go('inventory');
  } catch (e) { $('ni-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

// ================= email log =================
const KIND_WORD = { welcome: 'Welcome + sign-in', registered: 'Child registered', invoice: 'Invoice' };
VIEWS.emails = async () => {
  $('page-title').textContent = 'Email log';
  const [st, rows] = await Promise.all([api('/email/status'), api('/email/log?limit=300')]);
  $('view').innerHTML = `${st.connected
      ? `<div class="note good" style="margin-bottom:12px">Email is connected — sending from <b>${esc(st.from || '')}</b> via ${esc(st.host || '')}.</div>`
      : `<div class="note warn" style="margin-bottom:12px"><b>Email isn't connected yet.</b> Welcome and invoice emails are recorded here but not sent. To connect a mailbox, add MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS and MAIL_FROM to the server's .env file (see RUNNING.md), then restart. Use “Resend” afterwards for anything recorded before.</div>`}
    <div class="card tblwrap"><table id="em-tbl" class="dir"><thead><tr><th data-col="at">When</th><th data-col="k">Type</th><th data-col="to">To</th><th data-col="p">Parent</th>
      <th data-col="s">Subject</th><th data-col="st">Status</th><th data-col="a"></th></tr></thead>
      <tbody>${rows.map((e) => `<tr><td>${dtm(e.at)}</td><td>${esc(KIND_WORD[e.kind] || e.kind || '—')}</td><td title="${esc(e.to)}">${esc(e.to)}</td>
        <td>${e.parent ? `${esc(e.parent.name)} <span class="ref">${esc(e.parent.ref)}</span>` : '—'}</td><td title="${esc(e.subject || '')}">${esc(e.subject || '')}</td>
        <td>${e.simulated ? '<span class="pill p-mute">not sent</span>' : e.status === 'SENT' ? '<span class="pill p-good">sent</span>' : `<span class="pill p-bad" title="${esc(e.error || '')}">failed</span>`}</td>
        <td><button class="btn sm ghost" data-act="emView" data-a1="${e.id}">View</button>${(e.attachments || []).filter((a) => a.type === 'invoice').map((a) =>
          ` <button class="btn sm ghost" data-act="invEmail" data-a1="${a.id}">Resend</button>`).join('')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No emails yet.</td></tr>'}</tbody></table></div>`;
  resizableTable($('em-tbl'), 'emails');
};
ACT.emView = async (id) => {
  const r = await api(`/email/log/${id}/body`);
  openDrawer('Email', `<p class="mini" style="margin-top:0">As the parent receives it (temporary passwords are never kept — they show as dots).</p><iframe class="emframe" sandbox="" title="Email preview"></iframe>`);
  document.querySelector('.emframe').srcdoc = r.html;
};

// ================= settings =================
VIEWS.settings = async () => {
  $('page-title').textContent = 'Settings';
  const [n, p, merchants, st] = await Promise.all([api('/settings/notifications'), api('/settings/invoice-profile'), api('/merchants'), api('/email/status')]);
  const f = (id, label, value, full) => `<div class="${full ? 'full' : ''}"><label class="lbl" for="${id}">${label}</label><input class="in" id="${id}" value="${esc(value ?? '')}"></div>`;
  $('view').innerHTML = `
  <div class="sec"><h3>Email to parents</h3><div class="card" style="padding:16px">
    <div class="note ${st.connected ? 'good' : 'warn'}" style="margin-bottom:12px">${st.connected ? `Connected — sending from ${esc(st.from || '')}.` : 'Not connected yet — emails are recorded in the Email log but not sent. Mailbox details go in the server\'s .env file (MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM).'}</div>
    <label class="chk"><input type="checkbox" id="n-welcome" ${n.autoWelcome ? 'checked' : ''}> When a child is registered, email the parent a welcome with their sign-in details</label>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="n-inv" ${n.autoEmailInvoices ? 'checked' : ''}> When an invoice is issued, email it to the parent with the PDF attached</label>
    <div class="frm" style="margin-top:12px">${f('n-from', 'Sender name', n.fromName)}${f('n-reply', 'Reply-to address', n.replyTo)}${f('n-url', 'Parent sign-in page (link in the welcome email)', n.portalUrl, true)}</div>
    <div class="row-end"><button class="btn sm" data-act="setNotif">Save</button></div></div></div>

  <div class="sec"><h3>Invoice details <span class="cnt">printed on every invoice</span></h3><div class="card" style="padding:16px"><div class="frm">
    ${f('p-co', 'Company name', p.companyName, true)}${f('p-addr', 'Address line (footer)', p.addressLine, true)}
    ${f('p-trn', 'TRN', p.trn)}${f('p-acad', 'Academy name', p.academyName)}${f('p-terms', 'Payment terms', p.paymentTerms)}${f('p-payee', 'Cash / cheque in favour of', p.chequePayee)}
    ${f('p-bank', 'Bank name', p.bank.bankName)}${f('p-accn', 'Account name', p.bank.accountName)}${f('p-branch', 'Branch', p.bank.branch)}${f('p-swift', 'SWIFT code', p.bank.swift)}
    ${f('p-acc', 'AED account number', p.bank.accountNumber)}${f('p-iban', 'AED IBAN', p.bank.iban)}
    <div class="full"><label class="lbl" for="p-tc">Terms and conditions (one per line)</label><textarea class="in" id="p-tc" style="min-height:140px">${esc(p.terms.join('\n'))}</textarea></div>
  </div><div class="row-end"><button class="btn sm" data-act="setProfile">Save</button></div></div></div>

  <div class="sec"><h3>Merchants <span class="cnt">card terminal and payment link</span></h3><div class="card tblwrap"><table><thead><tr><th>Merchant</th><th>Merchant ID</th><th>Used for</th><th>Status</th><th></th></tr></thead>
    <tbody>${merchants.map((m) => `<tr><td><input class="in" data-mn="${m.id}" value="${esc(m.name)}"></td><td><input class="in mono" data-mid="${m.id}" value="${esc(m.merchantNumber)}"></td>
      <td>${METHOD_OPTS.filter(([k]) => k !== 'WALLET').map(([k, v]) => `<label class="mini" style="margin-right:8px"><input type="checkbox" data-mm="${m.id}" value="${k}" ${m.methods?.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</td>
      <td><label class="chk"><input type="checkbox" data-ma="${m.id}" ${m.isActive ? 'checked' : ''}> active</label></td>
      <td><button class="btn sm ghost" data-act="merchSave" data-a1="${m.id}">Save</button></td></tr>`).join('')}
      <tr><td><input class="in" id="nm-name" placeholder="New merchant"></td><td><input class="in mono" id="nm-id" placeholder="MID"></td>
        <td>${METHOD_OPTS.filter(([k]) => k !== 'WALLET').map(([k, v]) => `<label class="mini" style="margin-right:8px"><input type="checkbox" data-nmm value="${k}"> ${v}</label>`).join('')}</td><td></td>
        <td><button class="btn sm" data-act="merchAdd">Add</button></td></tr></tbody></table></div></div>
  ${await staffSection()}`;
};
ACT.setNotif = async () => {
  const body = { autoWelcome: $('n-welcome').checked, autoEmailInvoices: $('n-inv').checked, fromName: $('n-from').value.trim(),
    replyTo: $('n-reply').value.trim(), portalUrl: $('n-url').value.trim() };
  try { await api('/settings/notifications', { method: 'PUT', body: JSON.stringify(body) }); toast('Saved'); } catch (e) { toast(e.message); }
};
ACT.setProfile = async () => {
  const v = (id) => $(id).value.trim();
  const body = { companyName: v('p-co'), addressLine: v('p-addr'), trn: v('p-trn'), academyName: v('p-acad'), paymentTerms: v('p-terms'), chequePayee: v('p-payee'),
    bank: { bankName: v('p-bank'), accountName: v('p-accn'), branch: v('p-branch'), swift: v('p-swift'), accountNumber: v('p-acc'), iban: v('p-iban') },
    terms: $('p-tc').value.split('\n').map((s) => s.trim()).filter(Boolean) };
  try { await api('/settings/invoice-profile', { method: 'PUT', body: JSON.stringify(body) }); toast('Saved — new PDFs use these details'); } catch (e) { toast(e.message); }
};
ACT.merchSave = async (id) => {
  const body = { name: document.querySelector(`[data-mn="${id}"]`).value.trim(), merchantNumber: document.querySelector(`[data-mid="${id}"]`).value.trim(),
    methods: [...document.querySelectorAll(`[data-mm="${id}"]`)].filter((c) => c.checked).map((c) => c.value),
    isActive: document.querySelector(`[data-ma="${id}"]`).checked };
  try { await api('/merchants/' + id, { method: 'PATCH', body: JSON.stringify(body) }); toast('Saved'); } catch (e) { toast(e.message); }
};
ACT.merchAdd = async () => {
  const body = { name: $('nm-name').value.trim(), merchantNumber: $('nm-id').value.trim(), methods: [...document.querySelectorAll('[data-nmm]')].filter((c) => c.checked).map((c) => c.value) };
  if (body.name.length < 2 || !body.merchantNumber) return toast('Name and merchant ID are needed');
  try { await api('/merchants', { method: 'POST', body: JSON.stringify(body) }); toast('Added'); go('settings'); } catch (e) { toast(e.message); }
};

// ---- player page: (re)send sign-in details ----
ACT.pSendLogin = async () => {
  const g = PLAYER.guardian;
  openDrawer('Send sign-in details', `<div class="note info">${esc(g.fullName)} will get a new temporary password at <b>${esc(g.email)}</b> and must choose their own when they first sign in. Any earlier temporary password stops working.</div>
    <div id="sl-err" style="margin-top:10px"></div>
    <div class="row-end"><button class="btn ghost" data-act="closeDrawer">Cancel</button><button class="btn" data-act="pSendLoginGo">Send</button></div>`);
};
ACT.pSendLoginGo = async () => {
  try {
    const r = await api(`/guardians/${PLAYER.guardian.id}/send-login`, { method: 'POST', body: '{}' });
    openDrawer('Sign-in details', r.sent ? `<div class="note good">Sent to ${esc(r.to)}.</div>`
      : r.simulated ? `<div class="note warn">Recorded, but email isn't connected yet, so nothing was sent. Once email is connected, send again.</div>`
      : `<div class="note bad">Sending failed: ${esc(r.error || '')}</div>`);
  } catch (e) { $('sl-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

// ================= attendance: registers and the team grid =================
// Every team's sessions for the season (31 Aug 2026 – 11 Jun 2027) come from
// its training days and times. A coach opens the session, taps "All present",
// changes the few who weren't, and the team grid shows the month at a glance.
const ATT = [['PRESENT', 'P', 'Present'], ['LATE', 'L', 'Late'], ['ABSENT', 'A', 'Absent'], ['EXCUSED', 'E', 'Excused']];
const ATT_LETTER = Object.fromEntries(ATT.map(([k, l]) => [k, l]));
const ATT_CYCLE = { '': 'PRESENT', PRESENT: 'ABSENT', ABSENT: 'LATE', LATE: 'EXCUSED', EXCUSED: 'PRESENT' };
const attCell = (s) => s ? `<span class="att-m att-${s}">${ATT_LETTER[s]}</span>` : '';

let RG = null;   // the open register: { id, title, data, marks: {playerId: status} }
window.showRegister = async (id, title) => {
  if (!can('attendance.view')) return;
  openDrawer((title || 'Session') + ' — register', '<div class="loading">Loading…</div>');
  try {
    const data = await api(`/sessions/${id}/register`);
    RG = { id, title: title || data.session.team?.name || 'Session', data, marks: Object.fromEntries((data.roster || []).map((p) => [p.playerId, p.status || ''])), dirty: false };
    renderRegister();
  } catch (e) { openDrawer(title || 'Session', `<div class="empty">${esc(e.message)}</div>`); }
};
function renderRegister() {
  const { data: r, marks } = RG, s = r.session;
  const future = dubaiDay(s.startsAt) > dubaiDay(new Date());
  const canMark = can('attendance.create') && !s.isCancelled && !future;
  const counts = ATT.map(([k, l, w]) => [w, Object.values(marks).filter((m) => m === k).length]);
  const marked = Object.values(marks).filter(Boolean).length;
  openDrawer(`${RG.title} — register`, `
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
      <div><b>${new Date(s.startsAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })}</b> · ${hhmm(s.startsAt)}–${hhmm(s.endsAt)}
        <div class="mini">${esc(s.team?.name || '')} · ${esc(s.coach?.user?.fullName ? 'Coach ' + s.coach.user.fullName : 'no coach')} · ${esc(shortLoc(s.location?.name || s.venue?.name || ''))}</div></div>
      <div style="text-align:right">${s.isCancelled ? `<span class="pill p-mute">Cancelled</span><div class="mini">${esc(s.cancelReason || '')}</div>` : future ? '<span class="pill p-info">Upcoming</span>' : `<span class="pill ${marked >= r.total && r.total ? 'p-good' : 'p-warn'}">${marked} of ${r.total} marked</span>`}</div></div>
    ${future && !s.isCancelled ? '<div class="note info" style="margin-top:10px">The register opens on the day of the session.</div>' : ''}
    ${canMark && r.total ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 6px;align-items:center">
      <button class="btn sm ghost" data-act="rgAll">Everyone present</button>
      <span class="mini">${counts.filter(([, n]) => n).map(([w, n]) => `${n} ${w.toLowerCase()}`).join(' · ') || 'Tap P, L, A or E for each child'}</span></div>` : ''}
    <div class="card tblwrap" style="box-shadow:none;margin-top:8px"><table><tbody>
      ${(r.roster || []).map((p) => `<tr><td><b>${esc(p.name)}</b> <span class="mini ref">${esc(p.reference)}</span></td>
        <td style="text-align:right;white-space:nowrap">${canMark ? `<span class="attseg">${ATT.map(([k, l, w]) => `<button class="${marks[p.playerId] === k ? 'on att-' + k : ''}" data-act="rgMark" data-a1="${p.playerId}" data-a2="${k}" title="${w}">${l}</button>`).join('')}</span>`
          : marks[p.playerId] ? statusPill(marks[p.playerId]) : '<span class="mini">—</span>'}</td></tr>`).join('') || '<tr><td class="empty">No children on this team yet.</td></tr>'}
    </tbody></table></div>
    ${(r.trials || []).length ? `<div class="sec"><h3>Free trials <span class="cnt">${r.trials.length}</span></h3>
      <div class="card tblwrap" style="box-shadow:none"><table><tbody>${r.trials.map((t) => `<tr><td><b>${esc(t.name)}</b> ${t.category ? `<span class="chip">${esc(t.category)}</span>` : ''}
          <div class="mini">${esc(t.guardianName)} · ${esc(fmtPhone(t.guardianMobile))} · <a class="lnk2" data-act="openLead" data-a1="${t.leadId}">${esc(t.reference)}</a></div></td>
        <td style="text-align:right;white-space:nowrap">${t.outcome ? (t.outcome === 'ATTENDED' ? '<span class="pill p-good">Came</span>' : '<span class="pill p-bad">Didn\'t come</span>')
          : can('lead.edit') && !future && !s.isCancelled ? `<button class="btn sm ghost" data-act="rgTrial" data-a1="${t.leadId}" data-a2="ATTENDED">Came</button> <button class="btn sm ghost" data-act="rgTrial" data-a1="${t.leadId}" data-a2="NO_SHOW">Didn't come</button>` : '<span class="mini">booked</span>'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    ${canMark && r.total ? `<div class="row-end"><button class="btn" id="rg-save" data-act="rgSave" ${RG.dirty ? '' : 'disabled'}>${RG.dirty ? 'Save register' : 'Saved'}</button></div>` : ''}
    ${can('session.edit') ? `<div class="sec" style="margin-top:22px">${s.isCancelled
      ? '<button class="btn sm ghost" data-act="rgCancel" data-a1="false">Reinstate this session</button>'
      : `<details><summary class="mini" style="cursor:pointer">Call this session off</summary><div style="display:flex;gap:8px;margin-top:8px"><input class="in" id="rg-why" placeholder="Reason — weather, pitch unavailable…"><button class="btn sm danger" data-act="rgCancel" data-a1="true">Cancel session</button></div>
         <div class="mini" style="margin-top:4px">A cancelled session doesn't count against anyone's attendance.</div></details>`}</div>` : ''}`);
}
ACT.rgMark = (pid, k) => { RG.marks[pid] = k; RG.dirty = true; renderRegister(); };
ACT.rgAll = () => { for (const p of RG.data.roster) if (!RG.marks[p.playerId]) RG.marks[p.playerId] = 'PRESENT'; RG.dirty = true; renderRegister(); };
ACT.rgSave = async () => {
  const marks = Object.entries(RG.marks).filter(([, v]) => v).map(([playerId, status]) => ({ playerId, status }));
  if (!marks.length) return;
  try { RG.data = { ...RG.data, ...(await api(`/sessions/${RG.id}/register`, { method: 'POST', body: JSON.stringify({ marks }) })) }; RG.dirty = false;
    toast('Register saved'); renderRegister(); attAfterChange(); }
  catch (e) { toast(e.message); }
};
ACT.rgTrial = async (leadId, outcome) => {
  try { await api(`/leads/${leadId}/trial-result`, { method: 'POST', body: JSON.stringify({ outcome }) }); toast(outcome === 'ATTENDED' ? 'Trial marked as came' : 'Marked as no-show');
    const t = RG.data.trials.find((x) => x.leadId === leadId); if (t) t.outcome = outcome; renderRegister(); }
  catch (e) { toast(e.message); }
};
ACT.rgCancel = async (on) => {
  const reason = $('rg-why')?.value.trim();
  if (on && !reason) return toast('Give a reason');
  try { await api(`/sessions/${RG.id}/cancel`, { method: 'PATCH', body: JSON.stringify({ cancelled: on, reason }) });
    toast(on ? 'Session cancelled' : 'Session reinstated'); await window.showRegister(RG.id, RG.title); attAfterChange(); }
  catch (e) { toast(e.message); }
};
function attAfterChange() {
  if (CURRENT === 'teamAttendance') loadTeamGrid();
  else if (CURRENT === 'attendance') loadDayRegisters();
}

// ---------- a team's month: children × sessions ----------
let TA = { teamId: null, month: null };
const seasonMonths = () => { const out = []; const d = new Date(Date.UTC(2026, 7, 1)); while (d <= new Date(Date.UTC(2027, 5, 1))) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); } return out; };
const monthWord = (m) => new Date(m + '-15T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const taDefaultMonth = () => { if (!TA.month) { const now = dubaiDay(new Date()).slice(0, 7); const ms = seasonMonths(); TA.month = ms.includes(now) ? now : now < ms[0] ? ms[0] : ms[ms.length - 1]; } };
ACT.teamAtt = (id) => { TA.teamId = id; closeDrawer(); go('teamAttendance'); };
VIEWS.teamAttendance = async () => {
  await loadLookups();
  if (!TA.teamId) TA.teamId = LK.teams.slice().sort((a, b) => band(a.ageCodes?.[0]) - band(b.ageCodes?.[0]) || a.levelRank - b.levelRank)[0]?.id;
  taDefaultMonth();
  const t = LK.teams.find((x) => x.id === TA.teamId);
  $('page-title').textContent = 'Team attendance';
  $('page-acts').innerHTML = can('session.create') && t ? `<button class="btn sm ghost" data-act="teamSync" data-a1="${t.id}" title="After changing the team's training days or times">Re-plan future sessions</button>` : '';
  const ms = seasonMonths(), i = ms.indexOf(TA.month);
  $('view').innerHTML = `<div class="card filters"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div style="min-width:240px"><label class="lbl" for="ta-team">Team</label><select class="sel" id="ta-team">${LK.teams.slice().sort((a, b) => band(a.ageCodes?.[0]) - band(b.ageCodes?.[0]) || a.levelRank - b.levelRank)
        .map((x) => opt(x.id, `${x.name} · ${x.schedule || ''}`, x.id === TA.teamId)).join('')}</select></div>
      <div style="display:flex;gap:6px;align-items:center"><button class="btn sm ghost" data-act="taMonth" data-a1="${ms[i - 1] || ''}" ${i <= 0 ? 'disabled' : ''}>‹</button>
        <select class="sel" id="ta-month" style="width:170px">${ms.map((m) => opt(m, monthWord(m), m === TA.month)).join('')}</select>
        <button class="btn sm ghost" data-act="taMonth" data-a1="${ms[i + 1] || ''}" ${i >= ms.length - 1 ? 'disabled' : ''}>›</button></div>
      <span class="mini" style="margin-left:auto">${ATT.map(([k, l, w]) => `${attCell(k)} ${w}`).join(' &nbsp; ')} &nbsp; Click a square to change it · click a date for the full register</span></div></div>
    <div id="ta-grid" class="card" style="margin-top:12px"><div class="loading">Loading…</div></div>`;
  $('ta-team').onchange = (e) => { TA.teamId = e.target.value; go('teamAttendance'); };
  $('ta-month').onchange = (e) => { TA.month = e.target.value; go('teamAttendance'); };
  await loadTeamGrid();
};
ACT.taMonth = (m) => { if (m) { TA.month = m; go('teamAttendance'); } };
let TG = null;
async function loadTeamGrid() {
  const box = $('ta-grid'); if (!box) return;
  const from = TA.month + '-01', end = new Date(Date.UTC(+TA.month.slice(0, 4), +TA.month.slice(5, 7), 0)).toISOString().slice(0, 10);
  try {
    TG = await api(`/teams/${TA.teamId}/attendance-grid?from=${from}&to=${end}`);
    const g = TG, canMark = can('attendance.create');
    const done = g.sessions.filter((s) => !s.cancelled && s.when !== 'future');
    box.innerHTML = `<div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:16px;flex-wrap:wrap;align-items:baseline">
        <b style="font-size:15px">${esc(g.team.name)}</b> ${lvlBadge(g.team.level)}<span class="mini">${esc(g.team.coach ? 'Coach ' + g.team.coach : 'No coach')} · ${g.players.length} children · ${g.sessions.length} session${g.sessions.length === 1 ? '' : 's'} in ${monthWord(TA.month)}${g.sessions.some((s) => s.cancelled) ? ` (${g.sessions.filter((s) => s.cancelled).length} cancelled)` : ''}</span>
        ${done.length ? `<span class="mini" style="margin-left:auto">${done.filter((s) => s.complete).length} of ${done.length} registers complete so far</span>` : ''}</div>
      ${g.sessions.length ? `<div class="tblwrap"><table class="attgrid"><thead><tr><th class="nm">Child</th>
        ${g.sessions.map((s) => `<th class="sd ${s.cancelled ? 'cx' : ''} ${s.when}" data-act="showRegister" data-a1="${s.id}" data-a2="${esc(g.team.name)}" title="${s.cancelled ? 'Cancelled: ' + esc(s.cancelReason || '') : s.when === 'future' ? 'Upcoming' : s.complete ? 'Register complete' : s.marked + ' of ' + g.players.length + ' marked'}">
          <span>${new Date(s.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short' })}</span><b>${+s.date.slice(8)}</b>${s.cancelled ? '<i>off</i>' : s.when !== 'future' && !s.complete && g.players.length ? '<i class="todo">•</i>' : ''}</th>`).join('')}
        <th class="num">Month</th><th class="num">Season</th></tr></thead>
      <tbody>${g.players.map((p) => {
        const mk = g.sessions.filter((s) => !s.cancelled && p.marks[s.id]); const pres = mk.filter((s) => ['PRESENT', 'LATE'].includes(p.marks[s.id])).length;
        return `<tr><td class="nm"><a class="lnk2" data-act="openPlayer" data-a1="${p.id}">${esc(p.name)}</a></td>
        ${g.sessions.map((s) => s.cancelled ? '<td class="ac cx"></td>' : s.when === 'future' ? '<td class="ac fu"></td>'
          : `<td class="ac ${canMark ? 'tap' : ''}" ${canMark ? `data-act="taTap" data-a1="${s.id}" data-a2="${p.id}"` : ''}>${attCell(p.marks[s.id])}</td>`).join('')}
        <td class="num">${mk.length ? Math.round(pres / mk.length * 100) + '%' : '—'}</td>
        <td class="num"><b style="color:${p.seasonRate == null ? 'inherit' : p.seasonRate < 70 ? 'var(--bad)' : p.seasonRate < 80 ? 'var(--warn)' : 'var(--good)'}">${p.seasonRate == null ? '—' : p.seasonRate + '%'}</b></td></tr>`; }).join('')
        || `<tr><td colspan="${g.sessions.length + 3}" class="empty">No children on this team yet.</td></tr>`}</tbody></table></div>`
      : `<div class="empty">No sessions for this team in ${monthWord(TA.month)}${['2026-08', '2026-12', '2027-01', '2027-03', '2027-04', '2027-06'].includes(TA.month) ? ' outside term dates and holidays' : ''}.</div>`}`;
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
ACT.taTap = async (sid, pid) => {
  const p = TG.players.find((x) => x.id === pid); const next = ATT_CYCLE[p.marks[sid] || ''];
  p.marks[sid] = next;
  const cell = document.querySelector(`[data-act="taTap"][data-a1="${sid}"][data-a2="${pid}"]`); if (cell) cell.innerHTML = attCell(next);
  try { await api(`/sessions/${sid}/register`, { method: 'POST', body: JSON.stringify({ marks: [{ playerId: pid, status: next }] }) }); }
  catch (e) { toast(e.message); loadTeamGrid(); }
};
ACT.teamSync = async (id) => {
  try { const r = await api(`/teams/${id}/sessions/sync`, { method: 'POST', body: '{}' });
    toast(`Re-planned: ${r.created} added, ${r.removed} removed`); loadTeamGrid(); }
  catch (e) { toast(e.message); }
};
ACT.seasonGenerate = async () => {
  try { const r = await api('/schedule/season/generate', { method: 'POST', body: '{}' });
    openDrawer('Season sessions', `<div class="note ${r.created ? 'good' : 'info'}">${r.created ? `<b>${r.created} sessions added.</b>` : '<b>Every team already has its sessions.</b>'} ${r.total} training sessions across ${r.teams} teams for ${esc(r.season)}.</div>
      <div class="sec"><h3>No training on</h3>${r.closures.map((c) => `<div class="mini">${esc(c.title)} · ${dmy(c.from)}${c.to !== c.from ? ' – ' + dmy(c.to) : ''}</div>`).join('')}</div>
      <div class="sec"><h3>By team</h3><div class="card tblwrap" style="box-shadow:none"><table><tbody>${r.byTeam.map((t) => `<tr><td>${esc(t.team)}</td><td class="num">${t.planned}</td><td class="num mini">${t.created ? '+' + t.created : ''}</td></tr>`).join('')}</tbody></table></div></div>`); }
  catch (e) { toast(e.message); }
};

// ---------- today's registers (Attendance page) ----------
let AD = { date: null };
async function loadDayRegisters() {
  const box = $('ad-box'); if (!box) return;
  try {
    const d = await api('/attendance/day' + (AD.date ? '?date=' + AD.date : ''));
    AD.date = d.date;
    const label = $('ad-label'); if (label) label.textContent = new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (d.date === dubaiDay(new Date()) ? ' · today' : '');
    const todo = d.sessions.filter((s) => !s.isCancelled && !s.complete && new Date(s.startsAt) <= new Date());
    box.innerHTML = d.sessions.length ? `<table><tbody>${d.sessions.map((s) => `<tr class="clickable" data-act="showRegister" data-a1="${s.id}" data-a2="${esc(s.team || s.title || 'Session')}">
        <td style="width:110px" class="ref">${hhmm(s.startsAt)}–${hhmm(s.endsAt)}</td>
        <td><b>${esc(s.team || s.title || s.type)}</b> ${s.level ? lvlBadge(s.level) : ''}<div class="mini">${esc(s.coach ? 'Coach ' + s.coach : 'no coach')}</div></td>
        <td class="num">${s.isCancelled ? '<span class="pill p-mute">Cancelled</span>' : `${s.marked} / ${s.roster}`}</td>
        <td style="width:130px;text-align:right">${s.isCancelled ? '' : s.complete ? '<span class="pill p-good">Complete</span>' : new Date(s.startsAt) > new Date() ? '<span class="pill p-info">Later</span>' : '<span class="pill p-warn">To take</span>'}</td></tr>`).join('')}</tbody></table>
      ${todo.length ? `<div class="mini" style="padding:10px 14px">${todo.length} register${todo.length === 1 ? '' : 's'} still to take.</div>` : ''}`
      : '<div class="empty">No sessions on this day.</div>';
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
ACT.adDay = (n) => { const d = new Date((AD.date || dubaiDay(new Date())) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(n)); AD.date = d.toISOString().slice(0, 10); loadDayRegisters(); };
ACT.adToday = () => { AD.date = null; loadDayRegisters(); };


// ================= trials sheet =================
// The academy's trials sheet as a screen: every trial by date, with the parent's
// confirmation, the coach, whether the child came, the coach's evaluation, who
// follows up and where that stands. Changes save as you make them.
const TRIAL_TYPE_WORD = { DEVELOPMENT: 'Development trial', ADVANCED: 'Advanced trial' };
const ATTENDED_OPTS = [['PENDING', '—'], ['YES', 'Yes'], ['NO', 'No'], ['ANOTHER', 'Another trial']];
const OUTCOME_TO_ATT = { ATTENDED: 'YES', NO_SHOW: 'NO', ANOTHER_TRIAL: 'ANOTHER' };
const EVAL_OPTS = [['', '—'], ['DEVELOPMENT', 'Development'], ['ADVANCED', 'Advanced'], ['HPC', 'HPC'], ['ADV_INVITE', 'Advanced invitation'], ['NOT_READY', 'Not ready yet']];
let TS = { range: 'week' };
const TS_KEYS = ['from', 'to', 'type', 'coachId', 'assignedToId', 'attended', 'followUp', 'search'];
const weekBounds = (offset = 0) => {
  const t = new Date(dubaiDay(new Date()) + 'T12:00:00Z'); const dow = (t.getUTCDay() + 6) % 7;   // Monday first
  const a = new Date(t); a.setUTCDate(t.getUTCDate() - dow + offset * 7); const b = new Date(a); b.setUTCDate(a.getUTCDate() + 6);
  return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)];
};
VIEWS.trials = async () => {
  await loadLookups();
  if (!LEADS_OWNERS) LEADS_OWNERS = await api('/leads/owners').catch(() => []);
  if (!LEAD_OUTCOMES) LEAD_OUTCOMES = (await api('/leads/outcomes').catch(() => ({ outcomes: [] }))).outcomes;
  if (!TS.from) [TS.from, TS.to] = weekBounds(0);
  const v = (k) => esc(TS[k] ?? '');
  const sel = (k, opts) => `<select class="sel" id="ts-${k}">${opts.map(([val, t]) => opt(val, t, (TS[k] ?? '') === val)).join('')}</select>`;
  $('page-acts').innerHTML = `<button class="btn sm ghost" data-act="go" data-a1="leads">Trials &amp; Leads</button>${can('lead.export') ? '<button class="btn sm ghost" data-act="tsCsv">Export Excel</button>' : ''}`;
  $('view').innerHTML = `<div class="card filters">
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      ${[['last', 'Last week', -1], ['week', 'This week', 0], ['next', 'Next week', 1]].map(([k, w, o]) => `<button class="tab ${TS.range === k ? 'on' : ''}" data-act="tsWeek" data-a1="${k}" data-a2="${o}">${w}</button>`).join('')}
      <button class="tab ${TS.range === 'custom' ? 'on' : ''}" data-act="tsWeek" data-a1="custom">Dates…</button></div>
    <div class="fgrid">
      <div><label class="lbl" for="ts-from">From</label><input class="in" type="date" id="ts-from" value="${v('from')}"></div>
      <div><label class="lbl" for="ts-to">To</label><input class="in" type="date" id="ts-to" value="${v('to')}"></div>
      <div><label class="lbl" for="ts-type">Trial</label>${sel('type', [['', 'Development and Advanced'], ['DEVELOPMENT', 'Development trials'], ['ADVANCED', 'Advanced trials']])}</div>
      <div><label class="lbl" for="ts-coachId">Coach</label>${sel('coachId', [['', 'Any coach'], ...LK.coaches.map((c) => [c.id, c.name])])}</div>
      <div><label class="lbl" for="ts-attended">Attended</label>${sel('attended', [['', 'Any'], ['YES', 'Came'], ['NO', 'Didn\'t come'], ['ANOTHER', 'Another trial'], ['PENDING', 'Not recorded yet']])}</div>
      <div><label class="lbl" for="ts-followUp">To do</label>${sel('followUp', [['', 'Everything'], ['evaluation', 'Came — needs the coach\'s evaluation'], ['needed', 'Came — needs a follow-up']])}</div>
      <div><label class="lbl" for="ts-assignedToId">Follow-up by</label>${sel('assignedToId', [['', 'Anyone'], ...(LEADS_OWNERS || []).map((o) => [o.id, o.fullName])])}</div>
      <div><label class="lbl" for="ts-search">Search</label><input class="in" id="ts-search" value="${v('search')}" placeholder="Child, parent, mobile, TR"></div>
    </div></div>
    <div id="ts-counts" style="margin:12px 0"></div>
    <div class="card tblwrap" id="ts-tbl"><div class="loading">Loading…</div></div>`;
  $('view').querySelectorAll('.filters select, .filters input[type=date]').forEach((i) => i.addEventListener('change', () => { if (i.type === 'date') TS.range = 'custom'; loadTrials(); }));
  $('ts-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadTrials(); });
  await loadTrials();
};
ACT.tsWeek = (k, o) => { TS.range = k; if (k !== 'custom') [TS.from, TS.to] = weekBounds(Number(o)); go('trials'); };
const tsQuery = () => { for (const k of TS_KEYS) { const el = $('ts-' + k); if (el) TS[k] = el.value.trim(); } const qs = new URLSearchParams(); for (const k of TS_KEYS) if (TS[k]) qs.set(k, TS[k]); return qs; };
let TROWS = [];
async function loadTrials() {
  const box = $('ts-tbl'); if (!box) return;
  try {
    const d = await api('/leads/trials?' + tsQuery());
    TROWS = d.rows;
    const c = d.counts;
    $('ts-counts').innerHTML = `<div class="totbar"><span><b>${c.total}</b> trial${c.total === 1 ? '' : 's'}</span><span>Confirmed <b>${c.confirmed}</b></span><span>Came <b class="good">${c.attended}</b></span>
      <span>Didn't come <b class="bad">${c.noShow}</b></span><span>Not recorded <b>${c.pending}</b></span>
      <a class="lnk2" data-act="tsTodo" data-a1="evaluation">To evaluate <b>${c.needEvaluation}</b></a><a class="lnk2" data-act="tsTodo" data-a1="needed">To follow up <b>${c.needFollowUp}</b></a><span>Joined <b class="good">${c.joined}</b></span></div>`;
    box.innerHTML = d.rows.length ? trialsTable(d.rows, d.today) : `<div class="empty">No trials between ${dmy(d.from)} and ${dmy(d.to)}${tsQuery().toString().replace(/from=[^&]*&?|to=[^&]*&?/g, '') ? ' that match' : ''}. Trials appear here when they are booked from a lead.</div>`;
    wireTrials();
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
ACT.tsTodo = (k) => { TS.followUp = k; const el = $('ts-followUp'); if (el) el.value = k; loadTrials(); };
ACT.tsCsv = async () => {
  // The same rows as on screen, as a sheet.
  const head = ['Date', 'Trial', 'Track No', 'Child', 'DOB', 'Category', 'Confirmed', 'Coach', 'Parent', 'Parent contact', 'Attended', 'Evaluation', 'Follow-up by', 'Follow-up', 'Last comment', 'Stage'];
  const coach = (id) => LK.coaches.find((c) => c.id === id)?.name || '';
  const rows = TROWS.map((r) => [dmyt(r.trialDate), TRIAL_TYPE_WORD[r.trialType] || '', r.reference, r.playerName, r.playerDob ? dmy(r.playerDob) : '', r.category || '',
    r.trialConfirmed ? 'Yes' : 'No', coach(r.coachId), r.guardianName, r.guardianMobile, (ATTENDED_OPTS.find((a) => a[0] === (OUTCOME_TO_ATT[r.trialOutcome] || 'PENDING')) || [])[1] || '',
    EVAL_WORD[r.trialEvaluation] || '', r.assignedToName || '', r.followUpOutcome || '', r.lastNote ? `${dmyt(r.lastNote.at)} ${r.lastNote.by || ''}: ${r.lastNote.body}` : '', STAGE_WORD[r.status] || r.status]);
  const csvCell = (x) => { let s1 = String(x ?? ''); if (/^[=+\-@]/.test(s1)) s1 = "'" + s1; return /[",\n]/.test(s1) ? `"${s1.replace(/"/g, '""')}"` : s1; };
  const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Trials-${TS.from}-to-${TS.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

function trialsTable(rows, today) {
  const edit = can('lead.edit'), canEval = can('evaluation.create');
  const days = new Map();
  for (const r of rows) { const k = dubaiDay(r.trialDate); if (!days.has(k)) days.set(k, []); days.get(k).push(r); }
  const cs = (id, opts, cur, field, extra = '') => `<select class="sel tsel" data-ts="${field}" data-id="${id}" ${edit ? '' : 'disabled'} ${extra}>${opts.map(([v, t]) => opt(v, t, (cur ?? '') === v)).join('')}</select>`;
  const coachOpts = [['', '—'], ...LK.coaches.map((c) => [c.id, c.name])];
  const ownerOpts = [['', '—'], ...(LEADS_OWNERS || []).map((o) => [o.id, o.fullName.split(' ')[0]])];
  const outOpts = (cur) => [['', '— choose —'], ...(cur && !LEAD_OUTCOMES.includes(cur) ? [[cur, cur]] : []), ...LEAD_OUTCOMES.map((o) => [o, o])];
  return `<table class="dir tsheet" id="ts-table"><thead><tr><th data-col="child">Child</th><th data-col="age">Category · DOB</th><th data-col="conf">Confirmed</th><th data-col="coach">Coach</th>
      <th data-col="contact">Parent contact</th><th data-col="att">Attended</th><th data-col="eval">Evaluation</th><th data-col="poc">Follow-up by</th><th data-col="out">Follow-up</th><th data-col="note">Last comment</th></tr></thead>
    <tbody>${[...days.entries()].map(([day, list]) => `<tr class="tsday"><td colspan="10"><b>${new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</b>${day === today ? ' <span class="pill p-info">today</span>' : ''}
        <span class="mini"> · ${list.length} trial${list.length === 1 ? '' : 's'} · ${['DEVELOPMENT', 'ADVANCED'].map((t) => { const n = list.filter((r) => r.trialType === t).length; return n ? `${n} ${t === 'DEVELOPMENT' ? 'Development' : 'Advanced'}` : ''; }).filter(Boolean).join(', ')}</span></td></tr>
      ${list.map((r) => {
        const past = day <= today, att = OUTCOME_TO_ATT[r.trialOutcome] || 'PENDING';
        return `<tr data-row="${r.id}" class="${r.status === 'REGISTERED' ? 'ts-joined' : r.status === 'LOST' ? 'ts-lost' : ''}">
        <td><a class="lnk2" data-act="openLead" data-a1="${r.id}"><b>${esc(r.playerName)}</b></a><div class="mini">${esc(r.reference)} · ${hhmm(r.trialDate)} · ${esc(r.team || '')}
          <span class="pill ${r.trialType === 'ADVANCED' ? 'p-info' : 'p-mute'}" style="margin-left:2px">${r.trialType === 'ADVANCED' ? 'ADV' : 'DEV'}</span>${r.status === 'REGISTERED' ? ' <span class="pill p-good">joined</span>' : r.status === 'LOST' ? ' <span class="pill p-mute">not joining</span>' : ''}</div></td>
        <td>${r.category ? `<span class="chip">${esc(r.category)}</span>` : '—'}<div class="mini">${r.playerDob ? dmy(r.playerDob) : ''}</div></td>
        <td style="text-align:center"><input type="checkbox" class="tsck" data-ts="trialConfirmed" data-id="${r.id}" ${r.trialConfirmed ? 'checked' : ''} ${edit ? '' : 'disabled'} aria-label="Parent confirmed"></td>
        <td>${cs(r.id, coachOpts, r.coachId, 'trialCoachId')}${r.coachFromTeam ? '<div class="mini">team coach</div>' : ''}</td>
        <td class="mono">${esc(fmtPhone(r.guardianMobile))}<div class="mini">${esc(r.guardianName)} · <a class="lnk2" href="${esc(waLink(r.guardianMobile, ''))}" target="_blank" rel="noopener">WhatsApp</a></div></td>
        <td>${cs(r.id, ATTENDED_OPTS, att, 'attended', past ? '' : 'title="After the trial"')}</td>
        <td>${cs(r.id, EVAL_OPTS, r.trialEvaluation, 'trialEvaluation')}
          ${r.evaluation ? `<div class="mini"><a class="lnk2" data-act="openLead" data-a1="${r.id}">by ${esc((r.evaluation.by || 'coach').split(' ')[0])}${r.evaluation.ratings ? ' · ' + RATING_KEYS.filter(([k]) => r.evaluation.ratings[k]).map(([k]) => r.evaluation.ratings[k]).join('/') : ''}</a></div>`
            : canEval && att !== 'NO' && past ? `<button class="btn sm ghost" style="margin-top:4px" data-act="evalOpen" data-a1="${r.id}">Evaluate</button>` : ''}</td>
        <td>${cs(r.id, ownerOpts, r.assignedToId, 'assignedToId')}</td>
        <td>${cs(r.id, outOpts(r.followUpOutcome), r.followUpOutcome, 'followUpOutcome', 'style="min-width:200px;max-width:260px"')}</td>
        <td class="cm">${r.lastNote ? `<span class="mini"><b style="color:var(--ink)">${dmy(r.lastNote.at)}</b> ${esc((r.lastNote.by || '').split(' ')[0])}</span><div>${esc(trunc(r.lastNote.body, 90))}</div>` : '<span class="mini">—</span>'}
          ${edit ? `<a class="lnk2 mini" data-act="tsNote" data-a1="${r.id}">+ comment</a>` : ''}</td></tr>`; }).join('')}`).join('')}</tbody></table>`;
}
function wireTrials() {
  const save = async (el, body) => {
    const id = el.dataset.id; el.disabled = true;
    try { const row = await api(`/leads/${id}/trial-sheet`, { method: 'PATCH', body: JSON.stringify(body) });
      const i = TROWS.findIndex((r) => r.id === id); if (i >= 0 && row && row.id) TROWS[i] = row;
      el.classList.remove('saved'); void el.offsetWidth; el.classList.add('saved'); toast('Saved');
      if ('attended' in body || 'followUpOutcome' in body) loadTrials(); }
    catch (e) { toast(e.message); loadTrials(); }
    finally { el.disabled = !can('lead.edit'); }
  };
  document.querySelectorAll('#ts-table [data-ts]').forEach((el) => el.addEventListener('change', () => {
    const f = el.dataset.ts;
    const v = el.type === 'checkbox' ? el.checked : (el.value || null);
    save(el, { [f]: f === 'attended' ? (v || 'PENDING') : v });
  }));
  resizableTable($('ts-table'), 'trials');
}
ACT.tsNote = (id) => {
  const r = TROWS.find((x) => x.id === id);
  openDrawer(`Comment — ${r?.playerName || ''}`, `<p class="mini" style="margin-bottom:8px">Saved with today's date and your name.</p>
    <textarea class="in" id="tn-body" rows="4" placeholder="e.g. Called, interested — will confirm on Monday"></textarea>
    <div class="row-end"><button class="btn" data-act="tsNoteSave" data-a1="${id}">Save comment</button></div>`);
  $('tn-body').focus();
};
ACT.tsNoteSave = async (id) => {
  const body = $('tn-body').value.trim(); if (!body) return toast('Write the comment');
  try { await api(`/leads/${id}/activities`, { method: 'POST', body: JSON.stringify({ type: 'COMMENT', body }) }); closeDrawer(); toast('Comment saved'); loadTrials(); }
  catch (e) { toast(e.message); }
};

// ---------- the coach's evaluation ----------
let EV = null;
ACT.evalOpen = async (id) => {
  const r = TROWS.find((x) => x.id === id) || (LD && LD.d.lead.id === id ? { id, playerName: LD.d.lead.playerName, category: LD.d.lead.ageGroupLabel, reference: LD.d.lead.reference } : { id });
  EV = { id, rec: '', ratings: {}, back: CURRENT };
  await loadLookups();
  const teams = LK.teams.filter((t) => !r.category || (t.ageCodes || []).includes(r.category));
  openDrawer(`Trial evaluation — ${r.playerName || ''}`, `<div class="mini" style="margin-bottom:10px">${esc(r.reference || '')}${r.category ? ` · <span class="chip">${esc(r.category)}</span>` : ''}${r.trialDate ? ' · trial ' + dayTime(r.trialDate) : ''}</div>
    <span class="lbl">Where should they play?</span>
    <div class="opts c3">${EVAL_OPTS.filter(([k]) => k).map(([k, w]) => `<button class="opt" data-act="evalRec" data-a1="${k}"><span class="t">${esc(w)}</span></button>`).join('')}</div>
    ${RATING_KEYS.map(([k, w]) => `<div style="display:flex;align-items:center;gap:10px;margin-top:12px"><span class="lbl" style="margin:0;width:90px">${w}</span>
      <span class="attseg">${[1, 2, 3, 4, 5].map((n) => `<button data-act="evalRate" data-a1="${k}" data-a2="${n}" data-rate="${k}">${n}</button>`).join('')}</span></div>`).join('')}
    <div class="frm" style="margin-top:12px">
      <div class="full"><label class="lbl" for="ev-str">Strengths</label><textarea class="in" id="ev-str" rows="2" placeholder="e.g. Quick feet, good first touch, brave in 1v1"></textarea></div>
      <div class="full"><label class="lbl" for="ev-imp">To work on</label><textarea class="in" id="ev-imp" rows="2" placeholder="e.g. Weak foot, positioning off the ball"></textarea></div>
      <div class="full"><label class="lbl" for="ev-team">Recommended team <span style="text-transform:none;letter-spacing:0;font-weight:400">(optional)</span></label><select class="sel" id="ev-team">${opt('', '—')}${teams.map((t) => opt(t.id, `${t.name} · ${t.schedule}`)).join('')}</select></div></div>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="ev-again"> I'd like to see them at another trial before deciding</label>
    <div id="ev-err" style="margin-top:10px"></div>
    <div class="row-end"><button class="btn" data-act="evalSave">Save evaluation</button></div>`);
};
ACT.evalRec = (k) => { EV.rec = k; document.querySelectorAll('[data-act="evalRec"]').forEach((b) => b.classList.toggle('on', b.dataset.a1 === k)); };
ACT.evalRate = (k, n) => { EV.ratings[k] = Number(n); document.querySelectorAll(`[data-rate="${k}"]`).forEach((b) => { const on = Number(b.dataset.a2) === Number(n); b.classList.toggle('on', on); b.classList.toggle('att-PRESENT', on); }); };
ACT.evalSave = async () => {
  if (!EV.rec) { $('ev-err').innerHTML = '<div class="note bad">Choose where they should play.</div>'; return; }
  const body = { recommendation: EV.rec, ratings: Object.keys(EV.ratings).length ? EV.ratings : undefined,
    strengths: $('ev-str').value.trim() || undefined, toImprove: $('ev-imp').value.trim() || undefined,
    recommendedTeamId: $('ev-team').value || undefined, anotherTrial: $('ev-again').checked || undefined };
  try { await api(`/leads/${EV.id}/evaluations`, { method: 'POST', body: JSON.stringify(body) }); toast('Evaluation saved');
    if (CURRENT === 'trials') { closeDrawer(); loadTrials(); } else window.openLead(EV.id); }
  catch (e) { $('ev-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

// ---------- the invoice drawer: training fees per child (start date, discounts) ----------
// Laid out like the old "Generate Invoice" table. Before any payment, a child's
// start date (prorated by sessions left) or manual discount can be changed and
// the invoice is re-priced in place, keeping its number.
let INVT = { id: null, data: null, edit: null, draft: null };
async function loadInvTraining(id) {
  INVT = { id, data: null, edit: null, draft: null };
  try { INVT.data = await api(`/invoices/${id}/training`); } catch { INVT.data = null; }
  renderInvTraining();
}
function renderInvTraining() {
  const box = $('inv-train'); if (!box) return;
  const d = INVT.data; if (!d || !d.children?.length) { box.innerHTML = ''; return; }
  const canEdit = d.editable && can('invoice.edit');
  const rows = d.children.map((c) => {
    const cell = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const main = `<div class="trc${INVT.edit === c.playerId ? ' on' : ''}">
      <div class="trh"><span><b>${esc(c.name)}</b> <span class="mini">${esc([c.team, ...(c.terms || [])].filter(Boolean).join(' · '))}</span></span>
        ${canEdit ? `<button class="btn sm ghost" data-act="invTrEdit" data-a1="${c.playerId}">${INVT.edit === c.playerId ? 'Close' : 'Adjust'}</button>` : ''}</div>
      <div class="trg">
        ${cell('Start date', c.startDate ? `${dmy(c.startDate)}${c.proration ? `<div class="mini">${c.proration.sessionsLeft} of ${c.proration.sessionsTotal} sessions</div>` : ''}` : `<span class="mini">first day${c.firstDay ? '<br>' + dmy(c.firstDay) : ''}</span>`)}
        ${cell('Amount <span class="mini">excl. VAT</span>', c.amount != null ? money(c.amount) : '—')}
        ${cell('Special discount', c.siblingDiscount ? `−${money(c.siblingDiscount.amount)}<div class="mini">${esc(c.siblingDiscount.label.replace(/^Sibling discount — /, 'Sibling '))}</div>` : '<span class="mini">—</span>')}
        ${cell('Discount', c.manualDiscount ? `−${money(c.manualDiscount.amount)}<div class="mini">${esc(c.manualDiscount.label)}</div>` : '<span class="mini">—</span>')}
        ${cell('Net', `<b>${c.net != null ? money(c.net) : '—'}</b>`)}
      </div></div>`;
    return main;
  }).join('');
  const ec = INVT.edit ? d.children.find((x) => x.playerId === INVT.edit) : null;
  const editor = !ec ? '' : ((c) => `<div class="kidedit"><b>${esc(c.name)}</b>
      <div class="frm" style="margin-top:8px"><div><label class="lbl" for="ia-start">Start date</label>
        <input class="in" type="date" id="ia-start" value="${esc(INVT.draft.startDate || '')}" ${c.firstDay ? `min="${c.firstDay}"` : ''} ${c.lastDay ? `max="${c.lastDay}"` : ''}>
        <div class="mini">Empty = from the first day (full price). A later date prorates the training fee by the sessions left.</div></div></div>
      ${manualDiscountBlock('ia', INVT.draft, true)}
      <div id="ia-err" style="margin-top:8px"></div>
      <div class="row-end"><button class="btn sm ghost" data-act="invTrEdit" data-a1="${c.playerId}">Cancel</button><button class="btn sm" data-act="invTrSave" data-a1="${c.playerId}">Re-price the invoice</button></div></div>`)(ec);
  box.innerHTML = `<h3 class="dh3">Training fees</h3>
    ${rows}${editor}
    ${!d.editable ? `<div class="mini" style="margin-top:6px">${esc(d.why || '')} Start dates and discounts can only be changed before any money is recorded.</div>`
      : '<div class="mini" style="margin-top:6px">Adjust a child to change the start date or give a discount of any percentage. On the full-price child it is an extra discount; on a brother or sister it replaces the sibling discount.</div>'}`;
  const sd = $('ia-start'); if (sd) sd.addEventListener('change', () => { INVT.draft.startDate = sd.value || ''; });
}
ACT.invTrEdit = (pid) => {
  if (INVT.edit === pid) { INVT.edit = null; INVT.draft = null; return renderInvTraining(); }
  const c = INVT.data.children.find((x) => x.playerId === pid); if (!c) return;
  const m = c.manualDiscount;
  const preset = m ? (MANUAL_PRESETS.find(([, w, p]) => `${w} ${p}%` === m.label)?.[0] || '') : '';
  INVT.edit = pid;
  INVT.draft = { startDate: c.startDate || '', manual: { preset, percent: preset ? null : (m?.percent ?? null), reason: m?.reason || '' }, fixed: !!m && m.percent == null };
  renderInvTraining();
};
ACT.invTrSave = async (pid) => {
  const err = $('ia-err'); if (err) err.innerHTML = '';
  const dr = INVT.draft; const r = $('ia-mrsn'); if (r) dr.manual.reason = r.value.trim();
  const discount = manualBody(dr.manual) ?? (dr.fixed ? undefined : null);
  try {
    const res = await api(`/invoices/${INVT.id}/adjust`, { method: 'POST', body: JSON.stringify({ children: [{ playerId: pid, startDate: dr.startDate || null, ...(discount !== undefined ? { discount } : {}) }] }) });
    const was = res.previousTotal, now = Number(res.invoice.total);
    toast(`Invoice ${res.invoice.number} re-priced: ${money(was)} → ${money(now)}${res.invoice.status !== 'DRAFT' ? ' — resend the email so the parent has the new copy' : ''}`);
    window.showInvoice(INVT.id); if (CURRENT === 'invoices') loadInvoices();
  } catch (e) { if (err) err.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

// ---------- instalment plans (manual, set by the academy) ----------
// 2 to 5 instalments: staff type each one's % of the invoice total and its due
// date. Used when registering, in Add term and in the invoice drawer.
const PLAN_MAX = 5;
function evenSplit(n) {
  const base = Math.floor(10000 / n) / 100;
  const out = Array.from({ length: n }, () => base);
  out[n - 1] = Math.round((100 - base * (n - 1)) * 100) / 100;
  return out;
}
const planState = (ctx) => (ctx === 'at' ? ATP.plan : ctx === 'rg' ? REG.plan : ctx === 'iv' ? INVP.draft : null);
function planTotal(ctx) {
  if (ctx === 'at') { const q = ATP.lastQuote; return q && q.ok !== false ? Number(q.grandTotal ?? q.total ?? 0) : 0; }
  if (ctx === 'rg') return REG.kids.length && REG.familyQuote?.ok ? Number(REG.familyQuote.total) : Number(REG.quote?.grandTotal ?? REG.quote?.total ?? 0);
  if (ctx === 'iv') return Number(INVP.data?.total ?? 0);
  return 0;
}
function planSplit(total, rows) {
  const out = rows.map((r) => Math.round(total * (Number(r.percent) || 0)) / 100);
  if (out.length) out[out.length - 1] = Math.round((total - out.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100;
  return out;
}
function planBox(ctx) {
  const st = planState(ctx); if (!st) return '';
  const toggle = ctx === 'iv' ? '' : `<label class="chk" style="margin-top:12px"><input type="checkbox" data-planon="${ctx}" ${st.on ? 'checked' : ''}> Pay in instalments <span class="mini">(2 to ${PLAN_MAX}, set by the academy)</span></label>`;
  if (!st.on) return toggle;
  const n = st.rows.length;
  const amounts = planSplit(planTotal(ctx), st.rows);
  return `${toggle}<div class="planbox">
    <div class="sdrow"><span class="lbl" style="margin:0">Instalments</span>${[2, 3, 4, 5].map((k) => `<button class="btn sm ${k === n ? '' : 'ghost'}" data-act="planN" data-a1="${ctx}" data-a2="${k}">${k}</button>`).join('')}
      <a class="lnk2" data-act="planEven" data-a1="${ctx}">Split evenly</a></div>
    <table class="plantbl"><thead><tr><th>#</th><th>Percentage</th><th class="num">Amount</th><th>Due date</th></tr></thead><tbody>
      ${st.rows.map((r, i) => `<tr><td>${i + 1}</td>
        <td><div class="sdrow"><input class="in plan-pct" data-ctx="${ctx}" data-i="${i}" type="number" min="0.01" max="99.99" step="0.01" value="${r.percent ?? ''}" style="max-width:96px"><span>%</span></div></td>
        <td class="num" id="${ctx}-pa-${i}">${money(amounts[i])}</td>
        <td><input class="in plan-due" data-ctx="${ctx}" data-i="${i}" type="date" value="${esc(r.dueDate || '')}"></td></tr>`).join('')}
    </tbody></table>
    <div id="${ctx}-plansum" class="mini" style="margin-top:6px">${planSumText(ctx)}</div></div>`;
}
function planSumText(ctx) {
  const st = planState(ctx); if (!st?.on) return '';
  const sum = Math.round(st.rows.reduce((a, r) => a + (Number(r.percent) || 0), 0) * 100) / 100;
  const total = planTotal(ctx);
  return Math.abs(sum - 100) < 0.001
    ? `<span style="color:var(--good)">100% · ${money(total)}</span> — the parent doesn't see this schedule; send a payment link for each instalment.`
    : `<span style="color:var(--bad)">${sum}% — the percentages must add up to 100%</span>`;
}
function planAmounts(ctx) {
  const st = planState(ctx); if (!st?.on) return;
  const amounts = planSplit(planTotal(ctx), st.rows);
  amounts.forEach((a, i) => { const c = $(`${ctx}-pa-${i}`); if (c) c.textContent = money(a); });
  const sum = $(`${ctx}-plansum`); if (sum) sum.innerHTML = planSumText(ctx);
}
function planRedraw(ctx) {
  const box = $(ctx === 'iv' ? 'iv-planedit' : `${ctx}-planbox`);
  if (box) box.innerHTML = ctx === 'iv' ? invPlanEditor() : planBox(ctx);
}
ACT.planN = (ctx, n) => {
  const st = planState(ctx); n = Math.min(PLAN_MAX, Math.max(2, Number(n)));
  const keep = st.rows.slice(0, n);
  while (keep.length < n) keep.push({ percent: null, dueDate: '' });
  const even = evenSplit(n); keep.forEach((r, i) => { r.percent = even[i]; });
  st.rows = keep; planRedraw(ctx);
};
ACT.planEven = (ctx) => { const st = planState(ctx); const even = evenSplit(st.rows.length); st.rows.forEach((r, i) => { r.percent = even[i]; }); planRedraw(ctx); };
document.addEventListener('change', (e) => {
  const ctx = e.target?.dataset?.planon; if (!ctx) return;
  const st = planState(ctx); st.on = e.target.checked;
  if (st.on && !st.rows.length) st.rows = evenSplit(3).map((p) => ({ percent: p, dueDate: '' }));
  planRedraw(ctx);
});
document.addEventListener('input', (e) => {
  const t = e.target; if (!t?.classList) return;
  if (!t.classList.contains('plan-pct') && !t.classList.contains('plan-due')) return;
  const st = planState(t.dataset.ctx); const row = st?.rows[Number(t.dataset.i)]; if (!row) return;
  if (t.classList.contains('plan-pct')) row.percent = t.value === '' ? null : Number(t.value); else row.dueDate = t.value;
  planAmounts(t.dataset.ctx);
  const errBox = $({ rg: 'rg-err', at: 'at-err', iv: 'ip-err' }[t.dataset.ctx]); if (errBox && /instalment/i.test(errBox.textContent)) errBox.innerHTML = '';
});
/** What's wrong with a plan typed on screen, or null. */
function planCheck(st) {
  if (!st?.on) return null;
  if (st.rows.length < 2 || st.rows.length > PLAN_MAX) return `Choose 2 to ${PLAN_MAX} instalments.`;
  for (const [i, r] of st.rows.entries()) {
    if (!(Number(r.percent) > 0)) return `Instalment ${i + 1}: type its percentage.`;
    if (!r.dueDate) return `Instalment ${i + 1}: choose its due date.`;
    if (i && r.dueDate < st.rows[i - 1].dueDate) return `Instalment ${i + 1} is due before instalment ${i}.`;
  }
  const sum = Math.round(st.rows.reduce((a, r) => a + Number(r.percent), 0) * 100) / 100;
  if (Math.abs(sum - 100) > 0.001) return `The instalments add up to ${sum}% — they must make 100%.`;
  return null;
}
const planBody = (st) => (st?.on ? st.rows.map((r) => ({ percent: Number(r.percent), dueDate: r.dueDate })) : undefined);

// ---------- the invoice drawer: instalments and payment links ----------
let INVP = { id: null, data: null, draft: null, links: [], waive: null, confirmRemove: false };
const IST = { PAID: 'p-good', WAIVED: 'p-mute', PART_PAID: 'p-warn', OVERDUE: 'p-bad', READY: 'p-info', DUE: 'p-warn', UPCOMING: 'p-mute' };
async function loadInvPlan(id) {
  INVP = { id, data: null, draft: null, links: [], waive: null, confirmRemove: false };
  try {
    const [d, links] = await Promise.all([api(`/invoices/${id}/instalments`), api(`/invoices/${id}/payment-links`).catch(() => [])]);
    INVP.data = d; INVP.links = links;
  } catch { INVP.data = null; }
  renderInvPlan(); fillPayInstalments();
}
function renderInvPlan() {
  const box = $('inv-plan'); if (!box) return;
  const d = INVP.data; if (!d) { box.innerHTML = ''; return; }
  const edit = can('invoice.edit') && d.editable;
  const open = ['ISSUED', 'PART_PAID'].includes(d.status) && d.balance > 0.05;
  const payer = can('payment.create');
  if (INVP.draft) { box.innerHTML = `<h3 class="dh3">Instalments</h3><div id="iv-planedit">${invPlanEditor()}</div>`; return; }
  if (!d.hasPlan) {
    box.innerHTML = edit ? `<h3 class="dh3">Instalments</h3><div class="mini">Paid in one go.</div><div style="margin-top:8px"><button class="btn sm ghost" data-act="ipEdit">Pay in instalments…</button></div>` : '';
    return;
  }
  const rows = d.instalments.map((v) => {
    const owe = v.remaining > 0.005 && v.state !== 'WAIVED';
    const acts = [
      owe && open && payer ? `<button class="btn sm ghost" data-act="ipPay" data-a1="${v.seq}">Pay</button>` : '',
      owe && open && payer ? `<button class="btn sm ghost" data-act="ipLink" data-a1="${v.seq}" title="Copy the payment link">Copy link</button>` : '',
      owe && open && payer ? `<button class="btn sm ghost" data-act="ipSend" data-a1="${v.seq}" title="Email the payment link to the parent">Send link</button>` : '',
      owe && edit ? `<button class="btn sm ghost" data-act="ipReady" data-a1="${v.seq}" data-a2="${v.flag === 'READY' ? 'false' : 'true'}">${v.flag === 'READY' ? 'Not ready' : 'Ready to pay'}</button>` : '',
      owe && edit && can('writeoff.create') ? `<button class="btn sm ghost" data-act="ipWaive" data-a1="${v.seq}">Waive</button>` : '',
      v.state === 'WAIVED' && can('writeoff.create') ? `<button class="btn sm ghost" data-act="ipUnwaive" data-a1="${v.seq}">Undo waiver</button>` : '',
    ].filter(Boolean).join('');
    const waiveRow = INVP.waive === v.seq ? `<div class="sdrow" style="margin-top:8px"><input class="in" id="ip-wr" placeholder="Reason / approved by" style="max-width:260px"><button class="btn sm" data-act="ipWaiveGo" data-a1="${v.seq}">Waive AED ${v.remaining.toFixed(2)}</button><a class="lnk2" data-act="ipWaive" data-a1="">Cancel</a></div>` : '';
    return `<div class="trc"><div class="trh"><span><b>Instalment ${v.seq}</b> <span class="mini">${v.percent}% · due ${dmy(v.dueDate)}</span> <span class="pill ${IST[v.state] || 'p-mute'}">${esc(v.label)}</span></span></div>
      <div class="trg">
        <div><div class="k">Amount</div><div class="v">${money(v.amount)}</div></div>
        <div><div class="k">Received</div><div class="v">${money(v.paid)}</div></div>
        <div><div class="k">${v.state === 'WAIVED' ? 'Waived' : 'Left to pay'}</div><div class="v"><b>${money(v.state === 'WAIVED' ? v.waivedAmount : v.remaining)}</b>${v.waivedReason ? `<div class="mini">${esc(v.waivedReason)}</div>` : ''}</div></div>
      </div>${acts ? `<div class="rowacts" style="margin-top:8px;flex-wrap:wrap">${acts}</div>` : ''}${waiveRow}</div>`;
  }).join('');
  const sentLinks = INVP.links.filter((l) => l.sentAt).slice(0, 3);
  box.innerHTML = `<h3 class="dh3">Instalments <span class="mini">${d.counts.paid} of ${d.counts.total} paid · staff only — the parent doesn't see this schedule</span></h3>${rows}
    ${edit ? `<div class="row-end" style="justify-content:flex-start;margin-top:8px"><button class="btn sm ghost" data-act="ipEdit">Change plan</button>
      ${INVP.confirmRemove ? `<button class="btn sm" data-act="ipRemove" data-a1="yes">Confirm: pay in one go</button><a class="lnk2" data-act="ipRemove" data-a1="no">Keep it</a>` : `<button class="btn sm ghost" data-act="ipRemove">Remove plan</button>`}</div>` : ''}
    ${sentLinks.length ? `<div class="mini" style="margin-top:8px">Links sent: ${sentLinks.map((l) => `${dmy(l.sentAt)} · ${l.instalmentSeq ? 'instalment ' + l.instalmentSeq : 'balance'} · ${money(l.amount)}${l.openedAt ? ' · opened' : ''}`).join('<br>')}</div>` : ''}`;
}
function invPlanEditor() {
  return `${planBox('iv')}<div id="ip-err" style="margin-top:8px"></div>
    <div class="row-end"><button class="btn sm ghost" data-act="ipCancel">Cancel</button><button class="btn sm" data-act="ipSave">Save instalments</button></div>`;
}
/** The payment form's "for instalment" list, defaulting to the next one owed. */
function fillPayInstalments() {
  const sel = $('pay-inst'), wrap = $('pay-instwrap'); if (!sel || !wrap) return;
  const d = INVP.data;
  if (!d?.hasPlan) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const owed = d.instalments.filter((v) => v.remaining > 0.005 && v.state !== 'WAIVED');
  sel.innerHTML = opt('', 'Not for a specific instalment') + owed.map((v) => opt(String(v.seq), `Instalment ${v.seq} — ${money(v.remaining)} left, due ${dmy(v.dueDate)}`, d.next?.seq === v.seq)).join('');
  if (d.next) { const a = $('pay-amt'); if (a && !a.dataset.touched) a.value = d.next.remaining.toFixed(2); }
}
document.addEventListener('change', (e) => {
  if (e.target?.id === 'pay-inst') {
    const v = INVP.data?.instalments.find((x) => String(x.seq) === e.target.value);
    const a = $('pay-amt'); if (a && v) a.value = v.remaining.toFixed(2);
  }
  if (e.target?.id === 'pay-amt') e.target.dataset.touched = '1';
});
ACT.ipEdit = () => {
  const d = INVP.data;
  INVP.draft = { on: true, rows: d.hasPlan ? d.instalments.map((v) => ({ percent: v.percent, dueDate: v.dueDate })) : evenSplit(3).map((p) => ({ percent: p, dueDate: '' })) };
  renderInvPlan();
};
ACT.ipCancel = () => { INVP.draft = null; renderInvPlan(); };
ACT.ipSave = async () => {
  const err = planCheck(INVP.draft); if (err) { $('ip-err').innerHTML = `<div class="note bad">${esc(err)}</div>`; return; }
  try {
    await api(`/invoices/${INVP.id}/instalments`, { method: 'PUT', body: JSON.stringify({ items: planBody(INVP.draft) }) });
    toast('Instalments saved'); window.showInvoice(INVP.id); if (CURRENT === 'invoices') loadInvoices();
  } catch (e) { $('ip-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};
ACT.ipRemove = async (step) => {
  if (step === 'no') { INVP.confirmRemove = false; return renderInvPlan(); }
  if (step !== 'yes') { INVP.confirmRemove = true; return renderInvPlan(); }
  try { await api(`/invoices/${INVP.id}/instalments`, { method: 'PUT', body: JSON.stringify({ items: [] }) }); toast('Back to paying in one go'); window.showInvoice(INVP.id); }
  catch (e) { toast(e.message); }
};
ACT.ipReady = async (seq, ready) => {
  try { INVP.data = await api(`/invoices/${INVP.id}/instalments/${seq}/ready`, { method: 'POST', body: JSON.stringify({ ready: ready === true || ready === 'true' }) }); renderInvPlan(); }
  catch (e) { toast(e.message); }
};
ACT.ipWaive = (seq) => { INVP.waive = seq ? Number(seq) : null; renderInvPlan(); const r = $('ip-wr'); if (r) r.focus(); };
ACT.ipWaiveGo = async (seq) => {
  const reason = ($('ip-wr')?.value || '').trim(); if (reason.length < 3) return toast('Write why it is waived (and who approved it)');
  try { await api(`/invoices/${INVP.id}/instalments/${seq}/waive`, { method: 'POST', body: JSON.stringify({ reason }) }); toast(`Instalment ${seq} waived`); window.showInvoice(INVP.id); }
  catch (e) { toast(e.message); }
};
ACT.ipUnwaive = async (seq) => {
  try { await api(`/invoices/${INVP.id}/instalments/${seq}/unwaive`, { method: 'POST', body: '{}' }); toast('Waiver taken back'); window.showInvoice(INVP.id); }
  catch (e) { toast(e.message); }
};
ACT.ipPay = (seq) => {
  const sel = $('pay-inst'); if (sel) { sel.value = String(seq); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  const f = $('pay-form'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('pay-amt')?.focus(); }
};
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
/** Copy or send a payment link; `seq` empty = the next instalment on a plan, or the balance. */
async function payLink(id, seq, send) {
  try {
    const body = seq ? { instalmentSeq: Number(seq) } : {};
    const r = await api(`/invoices/${id}/payment-link${send ? '/send' : ''}`, { method: 'POST', body: JSON.stringify(body) });
    const what = r.instalmentSeq ? `instalment ${r.instalmentSeq}` : 'the balance';
    if (send) toast(r.email?.sent ? `Payment link for ${what} (${money(r.amount)}) emailed to ${r.email.to}` : r.email?.simulated ? `Payment link recorded — email is not connected yet` : `Email failed: ${r.email?.error || ''}`);
    else if (await copyText(r.url)) toast(`Payment link for ${what} (${money(r.amount)}) copied${r.online ? '' : ' — the page shows bank details until card payment is connected'}`);
    else openDrawer('Payment link', `<p class="mini">Copy this link for ${esc(what)} (${money(r.amount)}):</p><input class="in" readonly value="${esc(r.url)}" id="pl-url"><div class="mini" style="margin-top:8px">Valid until ${dmy(r.expiresAt)}.</div>`);
    if (INVP.id === id && $('inv-plan')) loadInvPlan(id);
    if (CURRENT === 'invoices') loadInvoices();
  } catch (e) { toast(e.message); }
}
ACT.ipLink = (seq) => payLink(INVP.id, seq, false);
ACT.ipSend = (seq) => payLink(INVP.id, seq, true);
ACT.invLinkCopy = (id) => payLink(id, '', false);
ACT.invLinkSend = (id) => payLink(id, '', true);

// ---------- the invoice list: Action menu ----------
// Kept from the old list: preview/download, record a payment (Pay invoice),
// instalments, copy / send the payment link, resend the invoice, write off /
// refund / cancel. Left out: Delete (invoices are never deleted — cancel
// instead), Edit payment method (each payment keeps its own), and the separate
// payment reminder (the payment-link email reads as a reminder once past due).
let INV_ROWS = new Map();
function closeActMenu() { const m = $('actmenu'); if (m) m.remove(); }
document.addEventListener('click', (e) => { if (!e.target.closest('#actmenu') && !e.target.closest('[data-act="invMenu"]')) closeActMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeActMenu(); });
ACT.invMenu = (id) => {
  const was = $('actmenu')?.dataset.id; closeActMenu(); if (was === id) return;
  const i = INV_ROWS.get(id); if (!i) return;
  const open = ['ISSUED', 'PART_PAID'].includes(i.status) && i.pending > 0.05;
  const item = (act, label, extra = '') => `<button class="ami" data-act="${act}" data-a1="${i.id}"${extra}>${label}</button>`;
  const items = [
    item('invMenuGo', 'Open invoice', ' data-a2="top"'),
    open && can('payment.create') ? item('invMenuGo', 'Record a payment', ' data-a2="pay"') : '',
    item('invMenuGo', i.hasPlan ? `Instalments (${i.installments.paid}/${i.installments.total} paid)` : 'Instalments', ' data-a2="plan"'),
    open && can('payment.create') ? item('invLinkCopy', 'Copy payment link') : '',
    open && can('payment.create') ? item('invLinkSend', 'Send payment link') : '',
    '<hr>',
    item('invPdf', 'Preview PDF', ` data-a2="${esc(i.number)}"`),
    item('invPdfDl', 'Download PDF', ` data-a2="${esc(i.number)}"`),
    i.status !== 'DRAFT' && can('invoice.edit') ? item('invEmail', i.emailedAt ? 'Resend invoice' : 'Email invoice') : '',
    i.status === 'DRAFT' && can('invoice.edit') ? item('invIssue', 'Issue invoice') : '',
    open && (can('writeoff.create') || can('refund.create') || can('invoice.edit')) ? item('invMenuGo', 'Write off, refund or cancel', ' data-a2="more"') : '',
  ].filter(Boolean).join('');
  const m = document.createElement('div');
  m.id = 'actmenu'; m.className = 'actmenu'; m.dataset.id = id; m.innerHTML = items;
  document.body.appendChild(m);
  const r = window.ACT_EL.getBoundingClientRect();
  const top = Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4);
  m.style.top = `${Math.max(8, top)}px`; m.style.left = `${Math.min(window.innerWidth - m.offsetWidth - 8, r.left)}px`;
};
ACT.invMenuGo = async (id, where) => {
  closeActMenu();
  await window.showInvoice(id);
  const target = { pay: 'pay-form', plan: 'inv-plan', more: 'inv-more' }[where];
  if (!target) return;
  setTimeout(() => {
    const el = $(target); if (!el) return;
    if (where === 'more') el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (where === 'pay') $('pay-amt')?.focus();
  }, 350);
};

// ---------- staff accounts (Settings) and my password ----------
async function staffSection() {
  if (!can('user.view')) return '';
  const [u, roles] = await Promise.all([api('/users?limit=100'), api('/roles').catch(() => [])]);
  STAFF_ROLES = roles;
  const rows = u.data || u;
  const roleSel = (id, cur) => `<select class="sel" id="${id}" ${can('user.edit') ? '' : 'disabled'}>${roles.map((r) => opt(r.id, r.name, r.id === cur)).join('')}</select>`;
  return `<div class="sec"><h3>Staff accounts <span class="cnt">who can sign in to this admin</span></h3>
    <div class="note info" style="margin-bottom:10px">Super admins see everything. Coaches see players, trials &amp; leads, attendance, schedule and teams — never fees, invoices or payments. Set a password here and share it with the person; they can change it from "Password" under their name.</div>
    <div class="card tblwrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th>Active</th><th>Password</th><th></th></tr></thead><tbody>
    ${rows.map((x) => `<tr><td><b>${esc(x.fullName)}</b></td><td class="mini">${esc(x.email)}</td><td>${roleSel('su-role-' + x.id, x.roleId)}</td>
      <td class="mini">${x.lastLoginAt ? dmyt(x.lastLoginAt) : 'never'}</td>
      <td><label class="chk"><input type="checkbox" id="su-act-${x.id}" ${x.isActive ? 'checked' : ''} ${can('user.edit') && x.id !== ME.id ? '' : 'disabled'}></label></td>
      <td>${can('user.edit') ? `<input class="in" type="password" autocomplete="new-password" id="su-pw-${x.id}" placeholder="New password (10+ characters)" style="min-width:190px">` : ''}</td>
      <td>${can('user.edit') ? `<button class="btn sm ghost" data-act="staffSave" data-a1="${x.id}">Save</button>` : ''}</td></tr>`).join('')}
    ${can('user.create') ? `<tr><td><input class="in" id="ns-name" placeholder="Full name"></td><td><input class="in" id="ns-email" type="email" placeholder="email@…"></td>
      <td>${roleSel('ns-role', (roles.find((r) => r.slug === 'coach') || roles[0] || {}).id)}</td><td></td><td></td>
      <td><input class="in" type="password" autocomplete="new-password" id="ns-pw" placeholder="Password (10+ characters)"></td><td><button class="btn sm" data-act="staffAdd">Add</button></td></tr>` : ''}
    </tbody></table></div></div>`;
}
let STAFF_ROLES = [];
ACT.staffSave = async (id) => {
  const body = { roleId: $('su-role-' + id).value, isActive: $('su-act-' + id).checked };
  const pw = $('su-pw-' + id).value;
  if (pw) { if (pw.length < 10) return toast('Use at least 10 characters'); body.password = pw; }
  try { await api('/users/' + id, { method: 'PATCH', body: JSON.stringify(body) }); $('su-pw-' + id).value = ''; toast(pw ? 'Saved — new password set' : 'Saved'); }
  catch (e) { toast(e.message); }
};
ACT.staffAdd = async () => {
  const body = { fullName: $('ns-name').value.trim(), email: $('ns-email').value.trim(), roleId: $('ns-role').value, password: $('ns-pw').value };
  if (!body.fullName || !body.email) return toast('Name and email are needed');
  if (body.password.length < 10) return toast('Use a password of at least 10 characters');
  try { await api('/users', { method: 'POST', body: JSON.stringify(body) }); toast('Account added'); go('settings'); }
  catch (e) { toast(e.message); }
};
ACT.myPassword = () => {
  openDrawer('Change my password', `<div class="frm">
    <div class="full"><label class="lbl" for="mp-cur">Current password</label><input class="in" type="password" autocomplete="current-password" id="mp-cur"></div>
    <div class="full"><label class="lbl" for="mp-new">New password <span style="text-transform:none;letter-spacing:0;font-weight:400">(at least 10 characters)</span></label><input class="in" type="password" autocomplete="new-password" id="mp-new"></div>
    <div class="full"><label class="lbl" for="mp-new2">New password again</label><input class="in" type="password" autocomplete="new-password" id="mp-new2"></div></div>
    <div id="mp-err" style="margin-top:10px"></div><div class="row-end"><button class="btn" data-act="myPasswordSave">Change password</button></div>`);
};
ACT.myPasswordSave = async () => {
  const cur = $('mp-cur').value, n1 = $('mp-new').value, n2 = $('mp-new2').value, err = $('mp-err');
  if (n1.length < 10) { err.innerHTML = '<div class="note bad">Use at least 10 characters.</div>'; return; }
  if (n1 !== n2) { err.innerHTML = '<div class="note bad">The two new passwords don\'t match.</div>'; return; }
  try { await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: n1 }) }); closeDrawer(); toast('Password changed'); }
  catch (e) { err.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
};

// ---------- auth ----------
async function doLogin(){
  $('li-err').textContent=''; $('li-go').disabled=true;
  try{
    const r = await api('/auth/login', {method:'POST', body: JSON.stringify({email:$('li-email').value.trim(), password:$('li-pass').value})});
    keepSession(r);
    await boot();
  }catch(e){ $('li-err').textContent = e.status===401 ? 'Invalid email or password.' : e.message; }
  finally{ $('li-go').disabled=false; }
}
$('li-go').onclick = doLogin;
$('li-pass').onkeydown = e => { if(e.key==='Enter') doLogin(); };
$('logout').onclick = () => {
  // End the session on the server too, so the refresh token can't be reused.
  if(REFRESH) fetch(API+'/auth/logout', { method:'POST', headers:{'Content-Type':'application/json', ...(TOKEN?{Authorization:'Bearer '+TOKEN}:{})}, body: JSON.stringify({ refreshToken: REFRESH }) }).catch(()=>{});
  endSession('');
};

async function boot(){
  ME = await api('/auth/me');
  $('login').style.display='none'; $('app').classList.add('on');
  $('who-name').textContent = ME.fullName; $('who-role').textContent = ME.roleName || ME.role;
  renderNav();
  const first = PAGES.find(p=>p.k && (!p.perm || can(p.perm)));
  await go(first ? first.k : 'dashboard');
}

(async () => {
  try{ const t = sessionStorage.getItem('ll-token'); if(t){ TOKEN=t; REFRESH=sessionStorage.getItem('ll-refresh'); await boot(); } }
  catch{ endSession('Your session has ended. Please sign in again.'); }
})();


// ---------- CSP-safe event delegation ----------
// Inline onclick handlers are blocked by the Content-Security-Policy, so all
// actions are declared as data-act/data-aN attributes and dispatched here.
const ACTIONS = {
  go, closeDrawer,
  ...ACT,
  showPlayer: (...a) => window.showPlayer(...a),
  showWallet: (...a) => window.showWallet(...a),
  showRoster: (...a) => window.showRoster(...a),
  showRegister: (...a) => window.showRegister(...a),
  showInvoice: (...a) => window.showInvoice(...a),
  recordPayment: (...a) => window.recordPayment(...a),
  evalDiscounts: (...a) => window.evalDiscounts(...a),
  showSiblingPlan: (...a) => window.showSiblingPlan(...a),
  setFullPrice: (...a) => window.setFullPrice(...a),
  resetSiblingOrder: (...a) => window.resetSiblingOrder(...a),
  runAuto: (...a) => window.runAuto(...a),
};
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  ev.stopPropagation();
  window.ACT_EL = el;
  const args = [];
  for (let i = 1; i <= 4; i++) {
    const v = el.dataset['a' + i];
    if (v === undefined) break;
    args.push(v === 'true' ? true : v === 'false' ? false : v);
  }
  fn(...args);
});
