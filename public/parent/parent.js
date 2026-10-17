// Parent account (Karim, 17 Oct 2026): Home, Children, Payments, Profile — view only, English and
// Arabic. Staff can open it acting as the parent (account switch): a banner says so, and the
// password can't be changed that way. Talks only to /api/v1/parent/*.
const API = '/api/v1/parent';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let TOKEN = null, MUST = false, ACTING = false, LANG = 'en', TAB = 'home', DATA = null;
try {
  TOKEN = sessionStorage.getItem('ll-parent'); MUST = sessionStorage.getItem('ll-parent-mcp') === '1';
  ACTING = sessionStorage.getItem('ll-parent-act') === '1'; LANG = localStorage.getItem('ll-lang') === 'ar' ? 'ar' : 'en';
} catch {}

// ------------------------------------------------------------------ words
// Arabic wording to be checked by a native speaker before parents are told about the portal.
const W = {
  en: {
    signin: 'Parent sign-in', signinHint: 'Use the email and password from your welcome email.', email: 'Email', password: 'Password', signinBtn: 'Sign in',
    forgot: 'Forgot your password?', forgotHint: "Enter the email you sign in with. We'll email you a link to choose a new password.", sendLink: 'Email me a link',
    checkEmail: 'Check your email', linkInfo: 'The link works for 60 minutes. Nothing arrived? Check your junk folder, or call the academy.', backSignin: 'Back to sign-in',
    newPw: 'Choose a new password', pwRule: 'At least 8 characters, with letters and a number.', newPassword: 'New password', again: 'New password again', savePw: 'Save password',
    pwDiffer: 'The two passwords are different.', pwSaved: 'Password saved', pwSavedSign: 'Password saved — sign in with it now',
    choosePw: 'Choose your password', tempHint: 'You signed in with a temporary password. Choose your own to continue.', changePw: 'Change password',
    tempPw: 'Temporary password', curPw: 'Current password', back: 'Back', signout: 'Sign out', lang: 'العربية',
    home: 'Home', children: 'Children', payments: 'Payments', profile: 'Profile',
    hello: 'Hello, {name}', stillToPay: 'Still to pay', allPaid: 'All paid — thank you', nothingOwed: 'Nothing is owed at the moment.',
    dueBy: 'Due by {date}', overdueSince: 'Overdue since {date}', instOf: 'Instalment {seq} of {of}', yourChildren: 'Your children', news: 'Updates',
    noNews: 'No updates right now.', nextTraining: 'Next training', trains: 'Trains', ownDays: 'own days', noTeam: 'Not placed on a team yet',
    notEnrolled: 'No term booked', pay_PAID: 'Paid', pay_DUE: 'Payment due', pay_OVERDUE: 'Overdue', pay_PART_PAID: 'Part paid',
    n_OVERDUE: '{what} of {invoice} was due on {date}', n_DUE_SOON: '{what} of {invoice} is due on {date}', n_REPORT: "{child}'s {term} report is ready", n_EMAIL: 'We emailed you: {text}',
    payment: 'Payment', born: 'Date of birth', category: 'Category', team: 'Team', coach: 'Coach', place: 'Place', schedule: 'Schedule', package: 'Package',
    sessions: '{n}× a week', reports: 'Term reports', noReports: 'No report yet.', download: 'Download', documents: 'Documents', upload: 'Upload', replace: 'Replace', view: 'View',
    doc_PHOTO: 'Photo', doc_EMIRATES_ID_FRONT: 'Emirates ID (front)', doc_EMIRATES_ID_BACK: 'Emirates ID (back)', doc_MEDICAL_INSURANCE: 'Medical insurance',
    missing: 'Missing', uploaded: 'Uploaded {date}', uploadedOk: 'Document uploaded', docHint: 'Photo or PDF, 1.5 MB at most. Photos are made smaller before they are sent.',
    walletCredit: 'Wallet credit', invoices: 'Invoices', noInvoices: 'No invoices yet.', total: 'Total', paid: 'Paid', balance: 'Balance', paidOn: 'Paid {date}',
    inst: 'Instalment {seq}', st_PAID: 'Paid', st_WAIVED: 'Waived', st_PART_PAID: 'Part paid', st_OVERDUE: 'Overdue', st_READY: 'Due', st_DUE: 'Due today', st_UPCOMING: 'Not paid yet',
    walletHistory: 'Wallet history', noWallet: 'No wallet activity.', payInfo: 'To pay, use the bank details on the invoice, or call the academy.',
    details: 'Your details', fullName: 'Full name', mobile: 'Mobile', extraEmail: 'Additional email', whose: 'Whose email is it?', nationality: 'Nationality', area: 'Area', address: 'Address',
    signinEmail: 'Sign-in email', emailNote: 'To change your sign-in email, contact the academy.', save: 'Save', saved: 'Saved', parentNo: 'Parent no.',
    acting: 'Staff view: {staff} is acting as {parent} ({ref}). Everything here is recorded.', closeView: 'Close this view',
    actPwNo: 'The password cannot be changed in staff view.', wrong: 'Something went wrong.', again2: 'Please sign in again.',
  },
  ar: {
    signin: 'دخول أولياء الأمور', signinHint: 'استخدم البريد الإلكتروني وكلمة المرور الواردة في رسالة الترحيب.', email: 'البريد الإلكتروني', password: 'كلمة المرور', signinBtn: 'تسجيل الدخول',
    forgot: 'نسيت كلمة المرور؟', forgotHint: 'أدخل البريد الإلكتروني الذي تسجل الدخول به، وسنرسل لك رابطاً لاختيار كلمة مرور جديدة.', sendLink: 'أرسل لي الرابط',
    checkEmail: 'تحقق من بريدك الإلكتروني', linkInfo: 'الرابط صالح لمدة 60 دقيقة. لم يصلك شيء؟ تحقق من مجلد البريد غير المرغوب فيه أو اتصل بالأكاديمية.', backSignin: 'العودة لتسجيل الدخول',
    newPw: 'اختر كلمة مرور جديدة', pwRule: '8 أحرف على الأقل، تتضمن حروفاً ورقماً واحداً على الأقل.', newPassword: 'كلمة المرور الجديدة', again: 'أعد كتابة كلمة المرور', savePw: 'حفظ كلمة المرور',
    pwDiffer: 'كلمتا المرور غير متطابقتين.', pwSaved: 'تم حفظ كلمة المرور', pwSavedSign: 'تم حفظ كلمة المرور — سجّل الدخول بها الآن',
    choosePw: 'اختر كلمة المرور', tempHint: 'لقد سجلت الدخول بكلمة مرور مؤقتة. اختر كلمة مرورك للمتابعة.', changePw: 'تغيير كلمة المرور',
    tempPw: 'كلمة المرور المؤقتة', curPw: 'كلمة المرور الحالية', back: 'رجوع', signout: 'تسجيل الخروج', lang: 'English',
    home: 'الرئيسية', children: 'الأبناء', payments: 'المدفوعات', profile: 'الملف الشخصي',
    hello: 'مرحباً، {name}', stillToPay: 'المبلغ المستحق', allPaid: 'تم السداد بالكامل — شكراً لك', nothingOwed: 'لا توجد مبالغ مستحقة حالياً.',
    dueBy: 'مستحق بتاريخ {date}', overdueSince: 'متأخر منذ {date}', instOf: 'القسط {seq} من {of}', yourChildren: 'أبناؤك', news: 'آخر المستجدات',
    noNews: 'لا توجد مستجدات حالياً.', nextTraining: 'التمرين القادم', trains: 'أيام التدريب', ownDays: 'أيام خاصة', noTeam: 'لم يُحدد الفريق بعد',
    notEnrolled: 'لا يوجد فصل محجوز', pay_PAID: 'مدفوع', pay_DUE: 'دفعة مستحقة', pay_OVERDUE: 'متأخر', pay_PART_PAID: 'مدفوع جزئياً',
    n_OVERDUE: '{what} من {invoice} كان مستحقاً بتاريخ {date}', n_DUE_SOON: '{what} من {invoice} مستحق بتاريخ {date}', n_REPORT: 'تقرير {term} الخاص بـ {child} جاهز', n_EMAIL: 'أرسلنا إليك: {text}',
    payment: 'الدفعة', born: 'تاريخ الميلاد', category: 'الفئة العمرية', team: 'الفريق', coach: 'المدرب', place: 'المكان', schedule: 'المواعيد', package: 'الباقة',
    sessions: '{n} مرات أسبوعياً', reports: 'تقارير الفصل', noReports: 'لا يوجد تقرير بعد.', download: 'تحميل', documents: 'المستندات', upload: 'رفع', replace: 'استبدال', view: 'عرض',
    doc_PHOTO: 'الصورة الشخصية', doc_EMIRATES_ID_FRONT: 'الهوية الإماراتية (الوجه الأمامي)', doc_EMIRATES_ID_BACK: 'الهوية الإماراتية (الوجه الخلفي)', doc_MEDICAL_INSURANCE: 'التأمين الصحي',
    missing: 'غير مرفوع', uploaded: 'تم الرفع {date}', uploadedOk: 'تم رفع المستند', docHint: 'صورة أو ملف PDF، بحد أقصى 1.5 ميغابايت. يتم تصغير الصور قبل إرسالها.',
    walletCredit: 'رصيد المحفظة', invoices: 'الفواتير', noInvoices: 'لا توجد فواتير بعد.', total: 'الإجمالي', paid: 'المدفوع', balance: 'المتبقي', paidOn: 'دُفعت بتاريخ {date}',
    inst: 'القسط {seq}', st_PAID: 'مدفوع', st_WAIVED: 'معفى', st_PART_PAID: 'مدفوع جزئياً', st_OVERDUE: 'متأخر', st_READY: 'مستحق', st_DUE: 'مستحق اليوم', st_UPCOMING: 'لم يُدفع بعد',
    walletHistory: 'سجل المحفظة', noWallet: 'لا توجد حركات في المحفظة.', payInfo: 'للدفع، استخدم بيانات الحساب البنكي الواردة في الفاتورة أو اتصل بالأكاديمية.',
    details: 'بياناتك', fullName: 'الاسم الكامل', mobile: 'رقم الهاتف المتحرك', extraEmail: 'بريد إلكتروني إضافي', whose: 'لمن هذا البريد؟', nationality: 'الجنسية', area: 'المنطقة', address: 'العنوان',
    signinEmail: 'بريد تسجيل الدخول', emailNote: 'لتغيير بريد تسجيل الدخول، يرجى التواصل مع الأكاديمية.', save: 'حفظ', saved: 'تم الحفظ', parentNo: 'رقم ولي الأمر',
    acting: 'عرض الموظفين: {staff} يتصفح حساب {parent} ({ref}). يتم تسجيل كل ما يحدث هنا.', closeView: 'إغلاق هذا العرض',
    actPwNo: 'لا يمكن تغيير كلمة المرور من عرض الموظفين.', wrong: 'حدث خطأ ما.', again2: 'يرجى تسجيل الدخول مرة أخرى.',
  },
};
/** Words the server sends in English (packages, invoice purposes, wallet) — Arabic where we have it. */
const AR_TERMS = {
  'Full season': 'الموسم الكامل', 'Term 1': 'الفصل الأول', 'Term 2': 'الفصل الثاني', 'Term 3': 'الفصل الثالث', 'Terms 1 & 2': 'الفصلان الأول والثاني',
  'Terms 2 & 3': 'الفصلان الثاني والثالث', 'Camp': 'المخيم', 'Kit': 'الطقم الرياضي', 'League': 'الدوري', 'Squad move-up': 'الانتقال إلى مستوى أعلى',
  'Balance from earlier seasons': 'رصيد من مواسم سابقة', 'Refund into your wallet': 'استرداد إلى محفظتك', 'Overpayment kept as credit': 'مبلغ زائد محفوظ كرصيد',
  'Sibling discount credit': 'رصيد خصم الإخوة', 'Credit from the academy': 'رصيد من الأكاديمية', 'Adjustment': 'تسوية', 'Used to pay an invoice': 'استُخدم لدفع فاتورة',
  'Credit cancelled': 'إلغاء رصيد', 'Wallet payment returned': 'إرجاع دفعة المحفظة',
};
/** '1× a week' — Arabic counts differently for 1 and 2. */
const perWeek = (n) => (LANG === 'ar' ? (n === 1 ? 'مرة واحدة أسبوعياً' : n === 2 ? 'مرتان أسبوعياً' : n + ' مرات أسبوعياً') : n + '× a week');
const t = (k, v = {}) => String((W[LANG] && W[LANG][k]) ?? W.en[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => (x in v ? v[x] : m));
const tr = (s) => (LANG === 'ar' && s ? String(s).split(' + ').map((x) => AR_TERMS[x] ?? x).join(' + ') : s);
const loc = () => (LANG === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB');
const money = (n) => { const v = Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return LANG === 'ar' ? `${v} درهم` : `AED ${v}`; };
const dmy = (d) => (d ? new Date(String(d).length === 10 ? d + 'T00:00:00' : d).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const when = (d) => new Date(d).toLocaleString(loc(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' });

function toast(m) { const x = $('toast'); x.textContent = m; x.classList.add('on'); setTimeout(() => x.classList.remove('on'), 2600); }
function save(tok, must, acting) {
  TOKEN = tok; MUST = !!must; ACTING = !!acting;
  try {
    if (tok) { sessionStorage.setItem('ll-parent', tok); sessionStorage.setItem('ll-parent-mcp', must ? '1' : '0'); sessionStorage.setItem('ll-parent-act', acting ? '1' : '0'); }
    else { ['ll-parent', 'll-parent-mcp', 'll-parent-act', 'll-parent-tab'].forEach((k) => sessionStorage.removeItem(k)); }
  } catch {}
}
async function api(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) } });
  const txt = await res.text(); let body; try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  if (!res.ok) { const e = new Error((Array.isArray(body?.message) ? body.message.join(' ') : body?.message) || res.statusText); e.status = res.status; e.body = body; throw e; }
  return body;
}
/** Open a file the API serves (invoice PDF, report, document) — the sign-in goes in the header, never in a link. */
async function openFile(path) {
  const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!res.ok) { toast(t('wrong')); return; }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function applyLang() {
  document.documentElement.lang = LANG; document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  $('p-lang').textContent = t('lang'); $('p-out').textContent = t('signout');
  document.querySelectorAll('[data-tab]').forEach((b) => { b.querySelector('span').textContent = t(b.dataset.tab); });
}
function chrome(signedIn) {
  $('p-out').hidden = !signedIn || ACTING; $('p-tabs').hidden = !signedIn;
  document.body.classList.toggle('with-tabs', signedIn);
  if (!signedIn) $('p-act').hidden = true;
}

// ------------------------------------------------------------------ sign-in, forgot, reset, change
function loginView(msg) {
  chrome(false);
  $('p-view').innerHTML = `<div class="pcard narrow"><h1>${t('signin')}</h1><p>${t('signinHint')}</p>
    <div class="fld"><label for="l-email">${t('email')}</label><input id="l-email" type="email" autocomplete="username"></div>
    <div class="fld"><label for="l-pass">${t('password')}</label><input id="l-pass" type="password" autocomplete="current-password"></div>
    <button class="btn" id="l-go" style="width:100%">${t('signinBtn')}</button><div class="err" id="l-err">${esc(msg || '')}</div>
    <p style="margin:14px 0 0;font-size:12px"><a href="#" id="l-forgot">${t('forgot')}</a></p></div>`;
  const go = async () => {
    $('l-err').textContent = ''; $('l-go').disabled = true;
    try { const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: $('l-email').value.trim(), password: $('l-pass').value }) }); save(r.accessToken, r.mustChangePassword, false); route(); }
    catch (e) { $('l-err').textContent = e.message; } finally { if ($('l-go')) $('l-go').disabled = false; }
  };
  $('l-go').onclick = go; $('l-pass').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('l-forgot').onclick = (e) => { e.preventDefault(); forgotView($('l-email').value.trim()); };
  $('l-email').focus();
}

function forgotView(email) {
  chrome(false);
  $('p-view').innerHTML = `<div class="pcard narrow"><h1>${t('forgot')}</h1><p>${t('forgotHint')}</p>
    <div class="fld"><label for="f-email">${t('email')}</label><input id="f-email" type="email" autocomplete="username" value="${esc(email || '')}"></div>
    <button class="btn" id="f-go" style="width:100%">${t('sendLink')}</button><div class="err" id="f-err"></div>
    <p style="margin:14px 0 0;font-size:12px"><a href="#" id="f-back">${t('backSignin')}</a></p></div>`;
  const back = () => { $('f-back').onclick = (e) => { e.preventDefault(); loginView(); }; };
  const go = async () => {
    const em = $('f-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) { $('f-err').textContent = t('email'); return; }
    $('f-err').textContent = ''; $('f-go').disabled = true;
    try {
      const r = await api('/auth/forgot', { method: 'POST', body: JSON.stringify({ email: em }) });
      $('p-view').innerHTML = `<div class="pcard narrow"><h1>${t('checkEmail')}</h1><p>${esc(LANG === 'ar' ? 'إذا كان لهذا البريد حساب ولي أمر، فقد أرسلنا إليه رابطاً لاختيار كلمة مرور جديدة.' : r.message)}</p>
        <p style="font-size:13px">${t('linkInfo')}</p><p style="margin:14px 0 0;font-size:12px"><a href="#" id="f-back">${t('backSignin')}</a></p></div>`;
      back();
    } catch (e) { $('f-err').textContent = e.message; if ($('f-go')) $('f-go').disabled = false; }
  };
  $('f-go').onclick = go; $('f-email').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  back(); $('f-email').focus();
}

function resetView(token) {
  chrome(false);
  $('p-view').innerHTML = `<div class="pcard narrow"><h1>${t('newPw')}</h1><p>${t('pwRule')}</p>
    <div class="fld"><label for="r-new">${t('newPassword')}</label><input id="r-new" type="password" autocomplete="new-password"></div>
    <div class="fld"><label for="r-new2">${t('again')}</label><input id="r-new2" type="password" autocomplete="new-password"></div>
    <button class="btn" id="r-go" style="width:100%">${t('savePw')}</button><div class="err" id="r-err"></div></div>`;
  $('r-go').onclick = async () => {
    const n1 = $('r-new').value, n2 = $('r-new2').value;
    if (n1 !== n2) { $('r-err').textContent = t('pwDiffer'); return; }
    $('r-go').disabled = true;
    try {
      const r = await api('/auth/reset', { method: 'POST', body: JSON.stringify({ token, newPassword: n1 }) });
      loginView(); $('l-email').value = r.email || ''; $('l-pass').focus(); toast(t('pwSavedSign'));
    } catch (e) { $('r-err').textContent = e.message; $('r-go').disabled = false; }
  };
  $('r-new').focus();
}

function changeView(first) {
  chrome(!first);
  if (ACTING) { $('p-view').innerHTML = `<div class="pcard narrow"><p>${t('actPwNo')}</p></div>`; return; }
  $('p-view').innerHTML = `<div class="pcard narrow"><h1>${first ? t('choosePw') : t('changePw')}</h1>
    <p>${first ? t('tempHint') + ' ' : ''}${t('pwRule')}</p>
    <div class="fld"><label for="c-cur">${first ? t('tempPw') : t('curPw')}</label><input id="c-cur" type="password" autocomplete="current-password"></div>
    <div class="fld"><label for="c-new">${t('newPassword')}</label><input id="c-new" type="password" autocomplete="new-password"></div>
    <div class="fld"><label for="c-new2">${t('again')}</label><input id="c-new2" type="password" autocomplete="new-password"></div>
    <button class="btn" id="c-go" style="width:100%">${t('savePw')}</button><div class="err" id="c-err"></div>
    ${first ? '' : `<p style="margin:12px 0 0"><a href="#" id="c-back">${t('back')}</a></p>`}</div>`;
  $('c-go').onclick = async () => {
    const n1 = $('c-new').value, n2 = $('c-new2').value;
    if (n1 !== n2) { $('c-err').textContent = t('pwDiffer'); return; }
    try { const r = await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: $('c-cur').value, newPassword: n1 }) }); save(r.accessToken, false, false); toast(t('pwSaved')); route(); }
    catch (e) { $('c-err').textContent = e.message; }
  };
  const b = $('c-back'); if (b) b.onclick = (e) => { e.preventDefault(); show('profile'); };
}

// ------------------------------------------------------------------ the four tabs
const pill = (cls, text) => `<span class="ppill ${cls}">${esc(text)}</span>`;
const payPill = (s) => (s ? pill(s === 'PAID' ? 'good' : s === 'OVERDUE' ? 'bad' : 'warn', t('pay_' + s)) : '');

function homeTab(d) {
  const o = d.owed, n = o.next;
  const owed = o.total > 0.005
    ? `<div class="powed ${o.overdue ? 'bad' : ''}"><div class="l">${t('stillToPay')}</div><div class="n">${money(o.total)}</div>
        ${n ? `<div class="s">${n.of ? t('instOf', { seq: n.seq, of: n.of }) + ' · ' : ''}${esc(n.invoiceNumber)} · ${money(n.amount)} — ${n.overdue ? t('overdueSince', { date: dmy(n.dueDate) }) : t('dueBy', { date: dmy(n.dueDate) })}</div>` : ''}
        <div class="s muted">${t('payInfo')}</div></div>`
    : `<div class="powed good"><div class="n" style="font-size:18px">${t('allPaid')}</div><div class="s">${t('nothingOwed')}</div></div>`;
  const kids = d.children.map((k) => `<button class="pkid" data-kid="${k.id}">
      <div class="row"><b>${esc(k.firstName)}</b>${payPill(k.payment)}</div>
      <div class="muted">${esc([k.team || t('noTeam'), k.category].filter(Boolean).join(' · '))}</div>
      <div class="muted">${k.package ? esc(tr(k.package.label)) + (k.package.sessionsPerWeek ? ' · ' + perWeek(k.package.sessionsPerWeek) : '') : t('notEnrolled')}</div>
      ${k.nextSession ? `<div class="next">${t('nextTraining')}: <b>${esc(when(k.nextSession.startsAt))}</b>${k.nextSession.place ? ' · ' + esc(k.nextSession.place) : ''}</div>`
        : k.schedule ? `<div class="next">${t('trains')}: <b>${esc(k.ownDays || k.schedule)}</b></div>` : ''}
    </button>`).join('');
  const what = (x) => (x.of ? t('instOf', { seq: x.seq, of: x.of }) : t('payment'));
  const notes = d.notifications.map((x) => {
    const text = x.kind === 'OVERDUE' || x.kind === 'DUE_SOON' ? t('n_' + x.kind, { what: what(x), invoice: x.invoice, date: dmy(x.dueDate) })
      : x.kind === 'REPORT' ? t('n_REPORT', { child: x.child, term: tr(x.term) }) : t('n_EMAIL', { text: x.text });
    return `<li class="${x.kind === 'OVERDUE' ? 'bad' : ''}"><span>${esc(text)}</span><small>${dmy(x.at)}</small></li>`;
  }).join('');
  return `<h1 class="phello">${esc(t('hello', { name: d.parent.name.split(' ')[0] }))}</h1>${owed}
    <h2 class="ph2">${t('yourChildren')}</h2><div class="pkids">${kids}</div>
    <h2 class="ph2">${t('news')}</h2>${notes ? `<ul class="pnews">${notes}</ul>` : `<p class="muted">${t('noNews')}</p>`}`;
}

function childrenTab(d) {
  return d.children.map((k) => `<section class="pcard pchild" id="kid-${k.id}">
    <div class="row"><h2>${esc(k.name)}</h2>${payPill(k.payment)}</div>
    <dl class="pkv">
      <dt>${t('born')}</dt><dd>${dmy(k.dob)}</dd>
      <dt>${t('category')}</dt><dd>${esc(k.category || '—')}</dd>
      <dt>${t('team')}</dt><dd>${esc(k.team || t('noTeam'))}</dd>
      ${k.coach ? `<dt>${t('coach')}</dt><dd>${esc(k.coach)}</dd>` : ''}
      ${k.location ? `<dt>${t('place')}</dt><dd>${esc(k.location)}</dd>` : ''}
      ${k.schedule ? `<dt>${t('schedule')}</dt><dd>${esc(k.schedule)}${k.ownDays ? ` <span class="muted">(${t('ownDays')}: ${esc(k.ownDays)})</span>` : ''}</dd>` : ''}
      <dt>${t('package')}</dt><dd>${k.package ? `${esc(tr(k.package.label))} · ${esc(k.package.season || '')}${k.package.sessionsPerWeek ? ' · ' + perWeek(k.package.sessionsPerWeek) : ''}` : t('notEnrolled')}</dd>
      ${k.nextSession ? `<dt>${t('nextTraining')}</dt><dd>${esc(when(k.nextSession.startsAt))}${k.nextSession.place ? ' · ' + esc(k.nextSession.place) : ''}</dd>` : ''}
    </dl>
    <h3>${t('reports')}</h3>
    ${k.reports.length ? `<ul class="plist">${k.reports.map((r) => `<li><span>${esc(tr(r.term || ''))} ${esc(r.season || '')}</span><button class="btn sm ghost" data-rep="${r.id}">${t('download')}</button></li>`).join('')}</ul>` : `<p class="muted">${t('noReports')}</p>`}
    <h3>${t('documents')}</h3><p class="muted small">${t('docHint')}</p>
    <ul class="plist">${k.documents.map((x) => `<li><span>${t('doc_' + x.type)} — ${x.id ? `<span class="muted">${t('uploaded', { date: dmy(x.at) })}</span>` : `<span class="warnt">${t('missing')}</span>`}</span>
      <span class="acts">${x.id ? `<button class="btn sm ghost" data-doc="${x.id}">${t('view')}</button>` : ''}
      <label class="btn sm ${x.id ? 'ghost' : ''}">${x.id ? t('replace') : t('upload')}<input type="file" hidden accept="${x.type === 'PHOTO' ? 'image/*' : 'image/*,application/pdf'}" data-up="${k.id}" data-type="${x.type}"></label></span></li>`).join('')}</ul>
  </section>`).join('') || `<div class="pcard"><p class="muted">—</p></div>`;
}

function paymentsTab(d) {
  const inv = d.invoices.map((i) => `<div class="pinv ${i.state === 'OVERDUE' ? 'bad' : ''}">
    <div class="row"><b>${esc(i.number)}</b><span>${money(i.total)}</span></div>
    <div class="muted">${esc(tr(i.what))}${i.children.length ? ' · ' + esc(i.children.join(', ')) : ''} · ${dmy(i.date)}</div>
    ${i.instalments.length ? `<ul class="pinst">${i.instalments.map((v) => `<li class="${v.state === 'OVERDUE' ? 'bad' : v.state === 'PAID' || v.state === 'WAIVED' ? 'good' : ''}">
        <span>${t('inst', { seq: v.seq })} · ${dmy(v.dueDate)}</span><span>${v.state === 'PAID' || v.state === 'WAIVED' ? t('st_' + v.state) : `${money(v.remaining)} · ${t('st_' + v.state)}`}</span></li>`).join('')}</ul>` : ''}
    <div class="row foot"><span>${i.balance > 0.005 ? `${t('balance')}: <b>${money(i.balance)}</b>` : pill('good', t('pay_PAID')) + (i.lastPaidAt ? ` <span class="muted small">${t('paidOn', { date: dmy(i.lastPaidAt) })}</span>` : '')}</span>
      <button class="btn sm ghost" data-pdf="${i.id}">${t('download')}</button></div>
  </div>`).join('');
  const w = d.wallet.entries.map((e) => `<li><span>${esc(tr(e.what))}${e.invoice ? ' · ' + esc(e.invoice) : ''}<small>${dmy(e.at)}</small></span><b class="${e.type === 'CREDIT' ? 'goodt' : ''}">${e.type === 'CREDIT' ? '+' : '−'}${money(e.amount)}</b></li>`).join('');
  return `<div class="ptiles"><div class="ptile"><div class="l">${t('stillToPay')}</div><div class="n">${money(d.owed.total)}</div></div>
      <div class="ptile"><div class="l">${t('walletCredit')}</div><div class="n">${money(d.wallet.balance)}</div></div></div>
    <p class="muted small">${t('payInfo')}</p>
    <h2 class="ph2">${t('invoices')}</h2>${inv || `<p class="muted">${t('noInvoices')}</p>`}
    <h2 class="ph2">${t('walletHistory')}</h2>${w ? `<ul class="plist">${w}</ul>` : `<p class="muted">${t('noWallet')}</p>`}`;
}

function profileTab(d) {
  const p = d.parent;
  const f = (id, label, v, attrs = '') => `<div class="fld"><label for="${id}">${label}</label><input id="${id}" value="${esc(v || '')}" ${attrs}></div>`;
  return `<section class="pcard"><h2>${t('details')}</h2><p class="muted small">${t('parentNo')}: ${esc(p.reference)}</p>
    ${f('pf-name', t('fullName'), p.name, 'autocomplete="name"')}
    <div class="fld"><label>${t('signinEmail')}</label><input value="${esc(p.email)}" disabled><small class="muted">${t('emailNote')}</small></div>
    ${f('pf-mob', t('mobile'), p.mobile, 'type="tel" autocomplete="tel"')}
    ${f('pf-x', t('extraEmail'), p.secondaryEmail, 'type="email"')}${f('pf-xn', t('whose'), p.secondaryEmailName)}
    ${f('pf-nat', t('nationality'), p.nationality)}${f('pf-area', t('area'), p.area)}${f('pf-addr', t('address'), p.address)}
    <button class="btn" id="pf-go">${t('save')}</button><div class="err" id="pf-err"></div></section>
    ${ACTING ? '' : `<section class="pcard"><h2>${t('password')}</h2><button class="btn ghost" id="pf-pw">${t('changePw')}</button></section>`}`;
}

function render() {
  const d = DATA;
  banner();
  $('p-view').innerHTML = TAB === 'children' ? childrenTab(d) : TAB === 'payments' ? paymentsTab(d) : TAB === 'profile' ? profileTab(d) : homeTab(d);
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === TAB));
  wire();
}
function wire() {
  document.querySelectorAll('[data-kid]').forEach((b) => b.addEventListener('click', () => { show('children'); const el = $('kid-' + b.dataset.kid); if (el) el.scrollIntoView({ behavior: 'smooth' }); }));
  document.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', () => openFile(`/invoices/${b.dataset.pdf}/pdf`)));
  document.querySelectorAll('[data-rep]').forEach((b) => b.addEventListener('click', () => openFile(`/reports/${b.dataset.rep}/pdf`)));
  document.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => openFile(`/documents/${b.dataset.doc}`)));
  document.querySelectorAll('[data-up]').forEach((inp) => inp.addEventListener('change', () => upload(inp)));
  const go = $('pf-go'); if (go) go.addEventListener('click', saveProfile);
  const pw = $('pf-pw'); if (pw) pw.addEventListener('click', () => changeView(false));
}
function show(tab) { TAB = tab; try { sessionStorage.setItem('ll-parent-tab', tab); } catch {} render(); window.scrollTo(0, 0); }

async function saveProfile() {
  const v = (id) => $(id).value.trim();
  const body = { fullName: v('pf-name'), mobile: v('pf-mob'), secondaryEmail: v('pf-x') || null, secondaryEmailName: v('pf-xn') || null,
    nationality: v('pf-nat') || null, area: v('pf-area') || null, address: v('pf-addr') || null };
  $('pf-go').disabled = true; $('pf-err').textContent = '';
  try { await api('/profile', { method: 'PATCH', body: JSON.stringify(body) }); toast(t('saved')); await load(); }
  catch (e) { $('pf-err').textContent = e.message; } finally { if ($('pf-go')) $('pf-go').disabled = false; }
}

/** Photos are shrunk in the browser (longest side 1600 px, about 250 KB) before they are sent. */
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return null;
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file); });
  const s = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let q = 0.85, out = c.toDataURL('image/jpeg', q);
  while (out.length > 340000 && q > 0.4) { q -= 0.15; out = c.toDataURL('image/jpeg', q); }
  return out;
}
async function upload(inp) {
  const file = inp.files && inp.files[0]; if (!file) return;
  try {
    let dataUrl = await shrink(file);
    if (!dataUrl) {
      if (file.size > 1500000) { toast(t('docHint')); return; }
      dataUrl = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
    }
    await api('/documents', { method: 'POST', body: JSON.stringify({ playerId: inp.dataset.up, type: inp.dataset.type, fileName: file.name, dataUrl }) });
    toast(t('uploadedOk')); await load();
  } catch (e) { toast(e.message); }
}

/** The staff banner (account switch), in the language chosen. */
function banner() {
  const a = DATA && DATA.actingAs;
  $('p-act').hidden = !a;
  if (!a) return;
  $('p-act').innerHTML = `<span>${esc(t('acting', { staff: a.name, parent: DATA.parent.name, ref: DATA.parent.reference }))}</span> <button class="btn sm ghost" id="p-close">${t('closeView')}</button>`;
  $('p-close').addEventListener('click', () => { save(null); window.close(); loginView(); });
}

async function load() {
  DATA = await api('/home');
  ACTING = !!DATA.actingAs;
  chrome(true); render();
}

async function route() {
  // The emailed reset link: take the code out of the address bar straight away, then show the form.
  const m = /^#reset=([A-Za-z0-9_-]{20,100})$/.exec(location.hash);
  if (m) { history.replaceState(null, '', location.pathname); save(null); return resetView(m[1]); }
  // Staff account switch: the admin opens #act=<30-minute sign-in>, taken out of the address bar at once.
  const a = /^#act=([A-Za-z0-9._-]{20,2000})$/.exec(location.hash);
  if (a) { history.replaceState(null, '', location.pathname); save(a[1], false, true); TAB = 'home'; try { sessionStorage.removeItem('ll-parent-tab'); } catch {} }
  if (!TOKEN) return loginView();
  if (MUST) return changeView(true);
  try { TAB = sessionStorage.getItem('ll-parent-tab') || TAB; } catch {}
  try { await load(); }
  catch (e) {
    if (e.status === 401) { save(null); return loginView(t('again2')); }
    if (e.status === 403 && e.body?.error === 'PasswordChangeRequired') { MUST = true; return changeView(true); }
    $('p-view').innerHTML = `<div class="pcard"><b>${t('wrong')}</b><p>${esc(e.message)}</p></div>`;
  }
}

$('p-out').addEventListener('click', () => { save(null); loginView(); });
$('p-lang').addEventListener('click', () => {
  LANG = LANG === 'ar' ? 'en' : 'ar'; try { localStorage.setItem('ll-lang', LANG); } catch {}
  applyLang(); if (DATA && TOKEN && !MUST) render(); else route();
});
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
applyLang();
route();
