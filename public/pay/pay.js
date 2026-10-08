// The parent's payment page. The token sits after "#", so it never leaves this
// browser except in the API call that reads this one link.
(function () {
  const box = document.getElementById('pay-view');
  const token = (location.hash || '').replace(/^#/, '').trim();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'AED ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const show = (html) => { box.innerHTML = html; };
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) { show('<h1>Payment link not valid</h1><p>Please use the link from the academy\'s email, or ask the academy for a new one.</p>'); return; }
  const api = (path, opts) => fetch('/api/v1/pay/' + encodeURIComponent(token) + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}))
    .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.message || 'Something went wrong'); return b; });
  api('').then((v) => {
    const head = `<div class="mini">${esc(v.academy)} · invoice ${esc(v.number)}</div>`;
    if (v.status === 'PAID') return show(`${head}<h1>Paid — thank you</h1><p>This payment has been received.</p>`);
    if (v.status !== 'ACTIVE') return show(`${head}<h1>This link is no longer active</h1><p>Please ask the academy for a new payment link.</p>`);
    show(`${head}<h1>${esc(v.what)}</h1>
      <div class="payamt">${money(v.amount)}</div>
      <dl class="paykv"><dt>For</dt><dd>${esc((v.children || []).join(', ') || '—')}</dd><dt>Invoice</dt><dd>${esc(v.number)}</dd>
        <dt>Link valid until</dt><dd>${new Date(v.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></dl>
      ${v.online ? '<button class="btn" id="pay-go" style="width:100%">Pay by card</button><div id="pay-err" style="margin-top:10px"></div>'
        : `<div class="note info">Online card payment is being set up. Please pay by bank transfer for now:</div>
          <div class="paybank"><dl class="paykv" style="margin:0"><dt>Account name</dt><dd>${esc(v.bank.accountName)}</dd><dt>Bank</dt><dd>${esc(v.bank.bankName)}</dd>
            <dt>IBAN</dt><dd class="mono">${esc(v.bank.iban)}</dd>${v.bank.swift ? `<dt>SWIFT</dt><dd class="mono">${esc(v.bank.swift)}</dd>` : ''}
            <dt>Amount</dt><dd>${money(v.amount)}</dd><dt>Payment details</dt><dd>${esc(v.bank.reference)}</dd></dl></div>
          <p class="mini" style="margin-top:12px">Please share the transfer confirmation with the academy so we can match your payment.</p>`}`);
    const go = document.getElementById('pay-go');
    if (go) go.addEventListener('click', () => {
      go.disabled = true; go.textContent = 'Opening the secure payment page…';
      api('/checkout', { method: 'POST', body: '{}' }).then((r) => { location.href = r.paymentUrl; })
        .catch((e) => { go.disabled = false; go.textContent = 'Pay by card'; document.getElementById('pay-err').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; });
    });
  }).catch((e) => show(`<h1>Payment link not valid</h1><p>${esc(e.message)}</p>`));
})();
