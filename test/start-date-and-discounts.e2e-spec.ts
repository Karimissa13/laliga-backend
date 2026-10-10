import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MailerService, MailMessage } from '../src/modules/notifications/mailer.service';

/**
 * A start date after the first day prorates the training fee by sessions left;
 * the full-price child of a family can get an extra discount of any percentage;
 * an unpaid invoice can be adjusted in place (start date, discount).
 */
describe('Start date proration and the extra discount (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  const sent: MailMessage[] = [];
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mailer = {
    live: true,
    status: () => ({ connected: true, host: 'test', from: 'test@example.com' }),
    send: async (m: MailMessage) => { sent.push(m); return { ok: true, simulated: false, messageId: `t-${sent.length}` }; } };
  let teams: any[];
  let g: any, big: any, small: any, invoiceId: string;
  const u12 = () => teams.find((t) => t.name === 'U12 Development');
  const u8 = () => teams.find((t) => t.name === 'U8 Development 1');

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailerService).useValue(mailer).compile();
    app = configureApp(m.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login').send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    teams = (await request(http).get('/api/v1/team-board').set(auth())).body;
  }, 60000);
  afterAll(async () => { await app.close(); });

  it('prorates the training fee by the team\'s sessions left from the start date; extras are not prorated', async () => {
    const base = { dob: '2015-03-01', package: 'T1', sessionsPerWeek: 2, teamId: u12().id };
    const full = (await request(http).get('/api/v1/registration/quote').query(base).set(auth()).expect(200)).body;
    expect(full.proration).toBeNull();
    const q = (await request(http).get('/api/v1/registration/quote').query({ ...base, startDate: '2026-10-12' }).set(auth()).expect(200)).body;
    expect(q.proration.basis).toBe('team sessions');
    expect(q.proration.sessionsLeft).toBeGreaterThan(0);
    expect(q.proration.sessionsLeft).toBeLessThan(q.proration.sessionsTotal);
    expect(q.listPriceInclVat).toBeCloseTo(full.listPriceInclVat * q.proration.ratio, 1);
    expect(q.proration.fullPriceInclVat).toBeCloseTo(full.listPriceInclVat, 2);
    // On or before the first day: full price.
    const early = (await request(http).get('/api/v1/registration/quote').query({ ...base, startDate: '2026-08-31' }).set(auth()).expect(200)).body;
    expect(early.proration).toBeNull();
    // After the last day of the option: refused.
    await request(http).get('/api/v1/registration/quote').query({ ...base, startDate: '2027-02-01' }).set(auth()).expect(400);
  });

  it('gives the full-price child an extra discount of any percentage; the sibling keeps the sibling discount', async () => {
    const q = (await request(http).post('/api/v1/registration/family-quote').set(auth()).send({ children: [
      { key: 'a', dob: '2015-03-01', firstName: 'Big', lastName: `Pro${uniq}`, package: 'FULL', sessionsPerWeek: 2, teamId: u12().id, manualPercent: 12.5 },
      { key: 'b', dob: '2019-03-01', firstName: 'Small', lastName: `Pro${uniq}`, package: 'FULL', sessionsPerWeek: 2, teamId: u8().id },
    ] }).expect(200)).body;
    const [a, b] = q.children;
    expect(a).toMatchObject({ position: '1st', siblingDiscount: null });
    expect(a.manualDiscount).toMatchObject({ percent: 12.5, label: 'Discount 12.5%', extra: true });
    expect(a.manualDiscount.amount).toBeCloseTo(a.listPrice * 0.125, 2);
    expect(b).toMatchObject({ position: '2nd', siblingPercent: 15, manualDiscount: null });
  });

  it('registers the family with a start date and the extra discount on one invoice', async () => {
    g = (await request(http).post('/api/v1/guardians').set(auth()).send({
      fullName: `Prorate ${uniq}`, email: `prorate${uniq}@example.com`, mobile: `+97154${String(uniq).slice(-7)}`,
    }).expect(201)).body;
    big = (await request(http).post('/api/v1/players').set(auth()).send({ guardianId: g.id, firstName: 'Big', lastName: `Pro${uniq}`, gender: 'MALE', dateOfBirth: '2015-03-01', sendWelcome: false }).expect(201)).body;
    small = (await request(http).post('/api/v1/players').set(auth()).send({ guardianId: g.id, firstName: 'Small', lastName: `Pro${uniq}`, gender: 'MALE', dateOfBirth: '2019-03-01' }).expect(201)).body;
    const r = (await request(http).post(`/api/v1/guardians/${g.id}/terms`).set(auth()).send({ items: [
      { playerId: big.id, package: 'T1', sessionsPerWeek: 2, teamId: u12().id, startDate: '2026-10-12', manualDiscount: { percent: 12.5, reason: 'Approved by Karim' } },
      { playerId: small.id, package: 'T1', sessionsPerWeek: 2, teamId: u8().id },
    ], issue: false }).expect(201)).body;
    invoiceId = r.invoice.id;
    const bigLine = r.invoice.lineItems.find((l: any) => l.playerId === big.id);
    expect(bigLine.description).toMatch(/from 12\/10\/2026 \(\d+ of \d+ sessions\)/);
    expect(r.appliedDiscounts.sort()).toEqual([expect.stringMatching(/^Big: Discount 12.5% — Approved by Karim$/), expect.stringMatching(/^Small: Sibling discount/)].sort());

    const t = (await request(http).get(`/api/v1/invoices/${invoiceId}/training`).set(auth()).expect(200)).body;
    expect(t.editable).toBe(true);
    const tb = t.children.find((c: any) => c.playerId === big.id);
    expect(tb).toMatchObject({ startDate: '2026-10-12', manualDiscount: { percent: 12.5 }, siblingDiscount: null });
    expect(tb.proration.sessionsLeft).toBeLessThan(tb.proration.sessionsTotal);
    const ts = t.children.find((c: any) => c.playerId === small.id);
    expect(ts.siblingDiscount.amount).toBeGreaterThan(0);

    const pdf = await request(http).get(`/api/v1/invoices/${invoiceId}/pdf`).set(auth()).expect(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
  });

  it('adjusts the unpaid invoice in place: back to full price, a different percentage, same invoice number', async () => {
    const before = (await request(http).get(`/api/v1/invoices/${invoiceId}`).set(auth())).body;
    const r = (await request(http).post(`/api/v1/invoices/${invoiceId}/adjust`).set(auth()).send({ children: [
      { playerId: big.id, startDate: null, discount: { percent: 20 } },
    ] }).expect(201)).body;
    expect(r.invoice.number).toBe(before.number);
    expect(r.invoice.lineItems).toHaveLength(before.lineItems.length);
    expect(Number(r.invoice.total)).toBeGreaterThan(Number(before.total));
    const t = (await request(http).get(`/api/v1/invoices/${invoiceId}/training`).set(auth())).body;
    const tb = t.children.find((c: any) => c.playerId === big.id);
    expect(tb).toMatchObject({ startDate: null, proration: null, manualDiscount: { percent: 20 } });
    expect(tb.net).toBeCloseTo(tb.amount * 0.8, 1);
    // Small's sibling discount is untouched.
    expect(t.children.find((c: any) => c.playerId === small.id).siblingDiscount.amount).toBeGreaterThan(0);
    // Removing the manual discount leaves the full-price child at full price.
    const r2 = (await request(http).post(`/api/v1/invoices/${invoiceId}/adjust`).set(auth()).send({ children: [{ playerId: big.id, discount: null }] }).expect(201)).body;
    expect(r2.appliedDiscounts).toHaveLength(1);
    // Totals still add up: subtotal + VAT = total.
    expect(Number(r2.invoice.subtotal) + Number(r2.invoice.vatTotal)).toBeCloseTo(Number(r2.invoice.total), 2);
  });

  it('refuses to adjust once money is recorded', async () => {
    await request(http).post(`/api/v1/invoices/${invoiceId}/issue`).set(auth()).send({}).expect(201);
    await request(http).post(`/api/v1/invoices/${invoiceId}/payments`).set(auth()).send({ amount: 100, method: 'CASH' }).expect(201);
    const t = (await request(http).get(`/api/v1/invoices/${invoiceId}/training`).set(auth())).body;
    expect(t.editable).toBe(false);
    await request(http).post(`/api/v1/invoices/${invoiceId}/adjust`).set(auth()).send({ children: [{ playerId: big.id, discount: { percent: 10 } }] }).expect(400);
  });
});
