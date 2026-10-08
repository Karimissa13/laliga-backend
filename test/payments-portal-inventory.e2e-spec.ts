import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { MailerService, MailMessage } from '../src/modules/notifications/mailer.service';

/**
 * Payment Report, invoice register, invoice PDF + email, parent sign-in, inventory.
 * The mailer is replaced with a recorder so the welcome email's temporary
 * password and the invoice attachment can be checked.
 */
describe('Payment report, invoice email, parent portal, inventory (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  const sent: MailMessage[] = [];
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mailer = {
    live: true,
    status: () => ({ connected: true, host: 'test', from: 'test@example.com' }),
    send: async (m: MailMessage) => { sent.push(m); return { ok: true, simulated: false, messageId: `t-${sent.length}` }; },
  };
  let teams: any[];
  let g: any, child: any, invoice: any, network: any;
  let otherInvoiceId: string;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailerService).useValue(mailer).compile();
    app = m.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    teams = (await request(http).get('/api/v1/team-board').set(auth())).body;
    network = (await request(http).get('/api/v1/merchants').set(auth()).expect(200)).body.find((x: any) => x.name === 'Network');
  }, 60000);
  afterAll(async () => { await app.close(); });

  describe('registration emails', () => {
    it('a new family gets a welcome email with a temporary password, and the invoice with its PDF', async () => {
      g = (await request(http).post('/api/v1/guardians').set(auth()).send({
        fullName: `Report Family ${uniq}`, email: `report${uniq}@example.com`, mobile: `+97150${String(uniq).slice(-7)}`,
      }).expect(201)).body;
      child = (await request(http).post('/api/v1/players').set(auth()).send({
        guardianId: g.id, firstName: 'Omar', lastName: `Report${uniq}`, dateOfBirth: '2015-05-05', gender: 'MALE',
      }).expect(201)).body;
      const welcome = sent.find((x) => x.to === g.email && /sign-in details/.test(x.subject));
      expect(welcome).toBeTruthy();
      expect(welcome!.text).toMatch(/Temporary password: \S+/);

      const team = teams.find((t) => t.level === 'DEVELOPMENT' && t.ageCodes.includes('U12'));
      const r = (await request(http).post(`/api/v1/players/${child.id}/terms`).set(auth()).send({ package: 'T1', teamId: team.id }).expect(201)).body;
      invoice = r.invoice;
      const mail = sent.find((x) => x.to === g.email && /tax invoice/.test(x.subject));
      expect(mail).toBeTruthy();
      expect(mail!.attachments![0].filename).toBe(`Invoice-${invoice.number}.pdf`);
      expect(mail!.attachments![0].content.subarray(0, 4).toString()).toBe('%PDF');

      const log = (await request(http).get(`/api/v1/email/log?guardianId=${g.id}`).set(auth()).expect(200)).body;
      expect(log.map((l: any) => l.kind).sort()).toEqual(['invoice', 'welcome']);
      const body = (await request(http).get(`/api/v1/email/log/${log.find((l: any) => l.kind === 'welcome').id}/body`).set(auth()).expect(200)).body.html;
      const temp = welcome!.text.match(/Temporary password: (\S+)/)![1];
      expect(body).not.toContain(temp);              // never stored readable
    });

    it('serves the designed PDF to staff', async () => {
      const res = await request(http).get(`/api/v1/invoices/${invoice.id}/pdf`).set(auth()).buffer(true)
        .parse((r, cb) => { const d: Buffer[] = []; r.on('data', (c) => d.push(c)); r.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  describe('Payment Report', () => {
    it('records the merchant and reference on a card payment', async () => {
      const r = (await request(http).post(`/api/v1/invoices/${invoice.id}/payments`).set(auth()).send({
        amount: 2000, method: 'CARD', merchantId: network.id, reference: `AUTH-${uniq}`,
      }).expect(201)).body;
      const p = r.payment;
      expect(p.merchantName).toBe('Network');
      expect(p.merchantNumber).toBe('13435');
    });

    it('wallet use is a separate column and never in Received', async () => {
      await request(http).post(`/api/v1/guardians/${g.id}/wallet/credit`).set(auth()).send({ amount: 500, reason: 'Goodwill' }).expect(201);
      await request(http).post(`/api/v1/invoices/${invoice.id}/pay-from-wallet`).set(auth()).send({ amount: 500 }).expect(201);
      await request(http).post(`/api/v1/invoices/${invoice.id}/write-off`).set(auth()).send({ amount: 10, reason: 'Rounding agreed' }).expect(201);

      const r = (await request(http).get(`/api/v1/reports/payments?search=${invoice.number}`).set(auth()).expect(200)).body;
      expect(r.rows).toHaveLength(2);
      const card = r.rows.find((x: any) => x.method === 'CARD');
      const wal = r.rows.find((x: any) => x.method === 'WALLET');
      expect(card).toMatchObject({ methodLabel: 'Credit card', merchant: 'Network', merchantId: '13435', reference: `AUTH-${uniq}`, received: 2000, wallet: 0 });
      expect(wal).toMatchObject({ received: 0, wallet: 500 });
      expect(card.invoice.number).toBe(invoice.number);
      expect(card.players[0].ref).toBe(child.reference);
      expect(card.location).toMatch(/Al Maryah/);
      // 5,610 − 2,000 − 500 wallet − 10 written off
      expect(card.balance).toBe(3100);
      expect(r.totals).toMatchObject({ count: 2, received: 2000, wallet: 500, balance: 3100, invoices: 1 });

      const noWallet = (await request(http).get(`/api/v1/reports/payments?search=${invoice.number}&includeWallet=false`).set(auth())).body;
      expect(noWallet.rows).toHaveLength(1);
      const byMerchant = (await request(http).get(`/api/v1/reports/payments?merchantId=${network.id}&search=${invoice.number}`).set(auth())).body;
      expect(byMerchant.rows).toHaveLength(1);
    });

    it('exports with the report\'s columns and DD/MM/YYYY dates', async () => {
      const res = await request(http).get(`/api/v1/reports/payments.csv?search=${invoice.number}`).set(auth()).expect(200);
      const lines = res.text.replace(/^﻿/, '').split('\r\n');
      expect(lines[0]).toBe('SL,Date,Payment Method,Merchant,Merchant ID,Payment Reference,Location,Player No.,Invoice#,Received,Wallet,Balance');
      expect(lines[1]).toMatch(/^1,\d{2}\/\d{2}\/\d{4},Credit card,Network,13435,AUTH-/);
      expect(lines[lines.length - 1]).toMatch(/Total,2000\.00,500\.00,3100\.00$/);
    });
  });

  describe('invoice register (the old screen\'s search)', () => {
    it('finds an invoice by its LA, PL and PR numbers, method and status', async () => {
      const n = invoice.number.replace('LA-', '');
      const q = async (s: string) => (await request(http).get(`/api/v1/invoice-register?${s}`).set(auth()).expect(200)).body;
      expect((await q(`invoiceNo=${n}`)).data.map((i: any) => i.number)).toEqual([invoice.number]);
      expect((await q(`invoiceNo=${Number(n)}`)).data[0].number).toBe(invoice.number);   // leading zeros optional
      expect((await q(`playerNo=${child.reference}`)).data[0].number).toBe(invoice.number);
      expect((await q(`parentNo=${g.reference.replace('PR-', '')}`)).data[0].number).toBe(invoice.number);
      expect((await q(`invoiceNo=${n}&method=CARD`)).data).toHaveLength(1);
      expect((await q(`invoiceNo=${n}&method=CASH`)).data).toHaveLength(0);
      expect((await q(`invoiceNo=${n}&status=PART_PAID`)).data).toHaveLength(1);
      expect((await q(`invoiceNo=${n}&additional=only`)).data).toHaveLength(0);
      const row = (await q(`invoiceNo=${n}`)).data[0];
      expect(row).toMatchObject({ totalInclVat: 5610, received: 2000, wallet: 500, writeOff: 10, pending: 3100, playersCount: 1 });
      expect(row.netReceived).toBeCloseTo(2000 / 1.05, 1);
      expect(row.subscription).toMatch(/Term 1/);
      expect(row.emailedAt).toBeTruthy();
    });

    it('exports every column', async () => {
      const res = await request(http).get(`/api/v1/invoice-register.csv?invoiceNo=${invoice.number}`).set(auth()).expect(200);
      const [head, line] = res.text.replace(/^﻿/, '').split('\r\n');
      expect(head.split(',').length).toBe(34);
      expect(line.startsWith(invoice.number)).toBe(true);
    });
  });

  describe('parent sign-in', () => {
    let temp: string, parentToken: string;

    it('requires a new password after the temporary one', async () => {
      temp = sent.find((x) => x.to === g.email && /sign-in details/.test(x.subject))!.text.match(/Temporary password: (\S+)/)![1];
      await request(http).post('/api/v1/parent/auth/login').send({ email: g.email, password: 'wrong-one-1' }).expect(401);
      const r = (await request(http).post('/api/v1/parent/auth/login').send({ email: g.email.toUpperCase(), password: temp }).expect(201)).body;
      expect(r.mustChangePassword).toBe(true);
      parentToken = r.accessToken;
      const blocked = await request(http).get('/api/v1/parent/me').set({ Authorization: `Bearer ${parentToken}` });
      expect(blocked.status).toBe(403);
      await request(http).post('/api/v1/parent/auth/change-password').set({ Authorization: `Bearer ${parentToken}` })
        .send({ currentPassword: temp, newPassword: 'onlyletters' }).expect(400);
      const ok = (await request(http).post('/api/v1/parent/auth/change-password').set({ Authorization: `Bearer ${parentToken}` })
        .send({ currentPassword: temp, newPassword: 'Football2026' }).expect(201)).body;
      parentToken = ok.accessToken;
    });

    it('shows the parent their children and invoices, and their own PDFs only', async () => {
      const me = (await request(http).get('/api/v1/parent/me').set({ Authorization: `Bearer ${parentToken}` }).expect(200)).body;
      expect(me.children.map((c: any) => c.reference)).toEqual([child.reference]);
      expect(me.invoices[0]).toMatchObject({ number: invoice.number, balance: 3100 });
      await request(http).get(`/api/v1/parent/invoices/${invoice.id}/pdf`).set({ Authorization: `Bearer ${parentToken}` }).expect(200);

      const other = (await request(http).get('/api/v1/invoice-register?limit=50').set(auth())).body.data.find((i: any) => i.parent.id !== g.id && i.status !== 'DRAFT');
      otherInvoiceId = other.id;
      await request(http).get(`/api/v1/parent/invoices/${otherInvoiceId}/pdf`).set({ Authorization: `Bearer ${parentToken}` }).expect(404);
    });

    it('keeps parent and staff tokens apart', async () => {
      await request(http).get('/api/v1/players').set({ Authorization: `Bearer ${parentToken}` }).expect(401);
      const s = await request(http).get('/api/v1/parent/me').set(auth());
      expect([401, 403]).toContain(s.status);
    });

    it('"Send sign-in details" issues a new temporary password and the old one stops working', async () => {
      const r = (await request(http).post(`/api/v1/guardians/${g.id}/send-login`).set(auth()).expect(201)).body;
      expect(r).toMatchObject({ sent: true, loginCreated: true });
      const fresh = sent.filter((x) => x.to === g.email && /sign-in details/.test(x.subject)).pop()!.text.match(/Temporary password: (\S+)/)![1];
      expect(fresh).not.toBe(temp);
      await request(http).post('/api/v1/parent/auth/login').send({ email: g.email, password: 'Football2026' }).expect(401);
      const r2 = (await request(http).post('/api/v1/parent/auth/login').send({ email: g.email, password: fresh }).expect(201)).body;
      expect(r2.mustChangePassword).toBe(true);
    });
  });

  describe('inventory', () => {
    it('clears the store only on a typed confirmation, leaving one practice item', async () => {
      await request(http).post('/api/v1/inventory/reset').set(auth()).send({ confirm: 'yes' }).expect(400);
      const r = (await request(http).post('/api/v1/inventory/reset').set(auth()).send({ confirm: 'CLEAR INVENTORY' }).expect(200)).body;
      expect(r.kept.map((i: any) => i.sku)).toEqual(['LL-TEST-M']);
      const d = (await request(http).get('/api/v1/inventory/items?programme=LALIGA').set(auth()).expect(200)).body;
      expect(d.items.map((i: any) => [i.sku, i.currentStock])).toEqual([['LL-TEST-M', 10]]);
      const hist = (await request(http).get('/api/v1/inventory/movements?search=LL-TEST').set(auth()).expect(200)).body;
      expect(hist.map((m: any) => m.type)).toEqual(['OPENING']);
    });

    it('adds an item in several sizes, each with its own number', async () => {
      const r = (await request(http).post('/api/v1/inventory/items').set(auth()).send({
        name: `Test Top ${uniq}`, programme: 'LALIGA', category: 'T-shirts', sizes: [{ size: '7-8', openingQty: 4 }, { size: 'M', openingQty: 2 }],
      }).expect(201)).body;
      expect(r).toHaveLength(2);
      expect(r[0].sku).toMatch(/^LL-\d{3}-78$/);
      expect(r[1].sku).toMatch(/^LL-\d{3}-M$/);
      expect(r[0].itemCode).toBe(r[1].itemCode);

      const sku = r[0].sku;
      await request(http).post('/api/v1/inventory/movements').set(auth()).send({ type: 'IN', reason: 'Delivery', lines: [{ sku, quantity: 6 }] }).expect(201);
      const tooMany = await request(http).post('/api/v1/inventory/movements').set(auth()).send({ type: 'OUT', party: 'Coach Pol', lines: [{ sku, quantity: 11 }] });
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.message).toMatch(/only 10 in stock/);
      await request(http).post('/api/v1/inventory/movements').set(auth()).send({ type: 'OUT', lines: [{ sku, quantity: 1 }] }).expect(400);   // who took it
      const out = (await request(http).post('/api/v1/inventory/movements').set(auth()).send({ type: 'OUT', party: 'Coach Pol', reason: 'Match day', lines: [{ sku: sku.toLowerCase(), quantity: 3 }] }).expect(201)).body;
      expect(out.items[0].stock).toBe(7);
      const take = (await request(http).post('/api/v1/inventory/movements').set(auth()).send({ type: 'ADJUST', reason: 'Stock take', lines: [{ sku, countedQty: 5 }] }).expect(201)).body;
      expect(take.items[0].stock).toBe(5);

      const hist = (await request(http).get(`/api/v1/inventory/movements?search=${sku}`).set(auth()).expect(200)).body;
      expect(hist.map((m: any) => m.type)).toEqual(['ADJUST', 'OUT', 'IN', 'OPENING']);
      expect(hist.map((m: any) => m.balanceAfter)).toEqual([5, 7, 10, 4]);
      expect(hist[1].party).toBe('Coach Pol');

      const csv = await request(http).get(`/api/v1/inventory/items.csv?search=${sku}`).set(auth()).expect(200);
      expect(csv.text).toContain(sku);
    });

    it('a coach cannot see or change the store', async () => {
      const coachTok = (await request(http).post('/api/v1/auth/login').send({ email: 'sergio@laligaacademy.local', password: 'Coach@12345' })).body.accessToken;
      await request(http).get('/api/v1/inventory/items').set({ Authorization: `Bearer ${coachTok}` }).expect(403);
      await request(http).post('/api/v1/inventory/reset').set({ Authorization: `Bearer ${coachTok}` }).send({ confirm: 'CLEAR INVENTORY' }).expect(403);
      await request(http).get('/api/v1/reports/payments').set({ Authorization: `Bearer ${coachTok}` }).expect(403);
    });
  });
});
