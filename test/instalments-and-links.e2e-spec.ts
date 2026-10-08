import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { MailerService, MailMessage } from '../src/modules/notifications/mailer.service';

/**
 * Instalments set by the academy (2–5, % + due date), payments allocated to
 * them, waiving, and payment links (made by the system; bank transfer shown
 * until a gateway is connected).
 */
describe('Instalments and payment links (e2e)', () => {
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
  let g: any, kid: any, inv: any;
  const u12 = () => teams.find((t) => t.name === 'U12 Development');

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailerService).useValue(mailer).compile();
    app = m.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login').send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    teams = (await request(http).get('/api/v1/team-board').set(auth())).body;
    g = (await request(http).post('/api/v1/guardians').set(auth()).send({
      fullName: `Instal ${uniq}`, email: `instal${uniq}@example.com`, mobile: `+97155${String(uniq).slice(-7)}`,
    }).expect(201)).body;
    kid = (await request(http).post('/api/v1/players').set(auth()).send({ guardianId: g.id, firstName: 'Rami', lastName: `Inst${uniq}`, gender: 'MALE', dateOfBirth: '2015-03-01', sendWelcome: false }).expect(201)).body;
  }, 60000);
  afterAll(async () => { await app.close(); });

  it('refuses a plan that does not add up, before anything is enrolled', async () => {
    const bad = await request(http).post(`/api/v1/players/${kid.id}/terms`).set(auth()).send({
      package: 'FULL', sessionsPerWeek: 2, teamId: u12().id, instalments: [{ percent: 40, dueDate: '2026-10-15' }, { percent: 30, dueDate: '2027-01-13' }],
    }).expect(400);
    expect(bad.body.message).toMatch(/add up to 70%/);
    const p = (await request(http).get(`/api/v1/players/${kid.id}/profile`).set(auth())).body;
    expect(p.purchases?.length ?? 0).toBe(0);
    await request(http).post(`/api/v1/players/${kid.id}/terms`).set(auth()).send({
      package: 'FULL', sessionsPerWeek: 2, instalments: [{ percent: 50, dueDate: '2027-01-13' }, { percent: 50, dueDate: '2026-10-15' }],
    }).expect(400);
  });

  it('registers with 3 instalments (40/30/30) typed by staff', async () => {
    const r = (await request(http).post(`/api/v1/players/${kid.id}/terms`).set(auth()).send({
      package: 'FULL', sessionsPerWeek: 2, teamId: u12().id,
      instalments: [{ percent: 40, dueDate: '2026-10-15' }, { percent: 30, dueDate: '2027-01-13' }, { percent: 30, dueDate: '2027-04-21' }],
    }).expect(201)).body;
    inv = r.invoice;
    const s = (await request(http).get(`/api/v1/invoices/${inv.id}/instalments`).set(auth()).expect(200)).body;
    expect(s.hasPlan).toBe(true);
    expect(s.instalments.map((i: any) => i.percent)).toEqual([40, 30, 30]);
    const sum = s.instalments.reduce((a: number, i: any) => a + i.amount, 0);
    expect(sum).toBeCloseTo(Number(inv.total), 2);
    expect(s.instalments[0].amount).toBeCloseTo(Number(inv.total) * 0.4, 2);
    expect(s.next.seq).toBe(1);
    const reg = (await request(http).get(`/api/v1/invoice-register?invoiceNo=${inv.number.replace('LA-', '')}`).set(auth())).body.data[0];
    expect(reg.installments).toEqual({ total: 3, paid: 0, pending: 3 });
  });

  it('allocates payments: tagged to an instalment first, then in order', async () => {
    const s0 = (await request(http).get(`/api/v1/invoices/${inv.id}/instalments`).set(auth())).body;
    const [a, b] = s0.instalments;
    await request(http).post(`/api/v1/invoices/${inv.id}/payments`).set(auth()).send({ amount: a.amount, method: 'CASH', instalmentSeq: 1 }).expect(201);
    await request(http).post(`/api/v1/invoices/${inv.id}/payments`).set(auth()).send({ amount: 100, method: 'CASH' }).expect(201);
    const s = (await request(http).get(`/api/v1/invoices/${inv.id}/instalments`).set(auth())).body;
    expect(s.instalments[0].state).toBe('PAID');
    expect(s.instalments[1]).toMatchObject({ state: 'PART_PAID', paid: 100 });
    expect(s.instalments[1].remaining).toBeCloseTo(b.amount - 100, 2);
    expect(s.counts).toEqual({ total: 3, paid: 1, pending: 2 });
  });

  it('changes the plan but never below what an instalment has received', async () => {
    await request(http).put(`/api/v1/invoices/${inv.id}/instalments`).set(auth()).send({ items: [
      { percent: 10, dueDate: '2026-10-15' }, { percent: 45, dueDate: '2027-01-13' }, { percent: 45, dueDate: '2027-04-21' },
    ] }).expect(400);
    const s = (await request(http).put(`/api/v1/invoices/${inv.id}/instalments`).set(auth()).send({ items: [
      { percent: 40, dueDate: '2026-10-15' }, { percent: 20, dueDate: '2027-01-13' }, { percent: 20, dueDate: '2027-03-01' }, { percent: 20, dueDate: '2027-04-21' },
    ] }).expect(200)).body;
    expect(s.instalments).toHaveLength(4);
    expect(s.instalments[0].state).toBe('PAID');
    await request(http).put(`/api/v1/invoices/${inv.id}/instalments`).set(auth()).send({ items: Array.from({ length: 6 }, (_, i) => ({ percent: i < 5 ? 16 : 20, dueDate: '2027-01-0' + (i + 1) })) }).expect(400);
  });

  it('waives an instalment (written off on the invoice) and takes it back', async () => {
    const before = (await request(http).get(`/api/v1/invoices/${inv.id}`).set(auth())).body;
    const s = (await request(http).post(`/api/v1/invoices/${inv.id}/instalments/4/waive`).set(auth()).send({ reason: 'Approved by Karim' }).expect(201)).body;
    const w = s.instalments.find((i: any) => i.seq === 4);
    expect(w.state).toBe('WAIVED');
    const after = (await request(http).get(`/api/v1/invoices/${inv.id}`).set(auth())).body;
    expect(Number(after.writeOffAmount)).toBeCloseTo(Number(before.writeOffAmount) + w.waivedAmount, 2);
    const back = (await request(http).post(`/api/v1/invoices/${inv.id}/instalments/4/unwaive`).set(auth()).expect(201)).body;
    expect(back.instalments.find((i: any) => i.seq === 4).state).not.toBe('WAIVED');
    expect(Number((await request(http).get(`/api/v1/invoices/${inv.id}`).set(auth())).body.writeOffAmount)).toBeCloseTo(Number(before.writeOffAmount), 2);
  });

  it('makes a payment link for one instalment; the parent page shows the amount and bank details (no gateway yet)', async () => {
    const l = (await request(http).post(`/api/v1/invoices/${inv.id}/payment-link`).set(auth()).send({ instalmentSeq: 2 }).expect(200)).body;
    expect(l.url).toMatch(/\/pay\/#[A-Za-z0-9_-]{30,}$/);
    expect(l.online).toBe(false);
    const again = (await request(http).post(`/api/v1/invoices/${inv.id}/payment-link`).set(auth()).send({ instalmentSeq: 2 }).expect(200)).body;
    expect(again.url).toBe(l.url); // reused while the amount is the same
    const t = l.url.split('#')[1];
    const v = (await request(http).get(`/api/v1/pay/${t}`).expect(200)).body;
    expect(v).toMatchObject({ status: 'ACTIVE', what: 'Instalment 2', online: false, children: ['Rami'] });
    expect(v.amount).toBeCloseTo(l.amount, 2);
    expect(v.bank.iban).toBeTruthy();
    expect(JSON.stringify(v)).not.toContain(g.email);
    await request(http).post(`/api/v1/pay/${t}/checkout`).expect(409);
    await request(http).get('/api/v1/pay/not-a-real-token-at-all-xxxxxxxx').expect(404);
  });

  it('sends the payment link by email and logs it; a fake webhook cannot mark it paid', async () => {
    const before = sent.length;
    const r = (await request(http).post(`/api/v1/invoices/${inv.id}/payment-link/send`).set(auth()).send({}).expect(200)).body;
    const m = sent.slice(before).find((x) => x.to === g.email);
    expect(m?.subject).toMatch(/payment (link|reminder) LA-/);
    expect(m?.text).toContain(r.url);
    const links = (await request(http).get(`/api/v1/invoices/${inv.id}/payment-links`).set(auth()).expect(200)).body;
    // On a plan, "send" picks the next instalment not yet paid (instalment 2 here).
    expect(r.instalmentSeq).toBe(2);
    expect(links.find((x: any) => x.sentAt).sentTo).toContain(g.email);
    const whole = (await request(http).post(`/api/v1/invoices/${inv.id}/payment-link`).set(auth()).send({ balance: true }).expect(200)).body;
    expect(whole.instalmentSeq).toBeNull();
    const log = (await request(http).get('/api/v1/email/log?kind=payment_link').set(auth()).expect(200)).body;
    expect(log.some((e: any) => e.to.includes(g.email))).toBe(true);
    const paidBefore = (await request(http).get(`/api/v1/invoices/${inv.id}`).set(auth())).body.amountPaid;
    const wh = (await request(http).post('/api/v1/payments/webhook').send({ invoiceId: inv.id, amount: 99999, status: 'PAID', gatewayId: 'fake' }).expect(201)).body;
    expect(wh.received).toBe(false);
    expect((await request(http).get(`/api/v1/invoices/${inv.id}`).set(auth())).body.amountPaid).toBe(paidBefore);
  });

  it('refuses a link on a draft invoice and on a paid instalment', async () => {
    await request(http).post(`/api/v1/invoices/${inv.id}/payment-link`).set(auth()).send({ instalmentSeq: 1 }).expect(400);
    const kid2 = (await request(http).post('/api/v1/players').set(auth()).send({ guardianId: g.id, firstName: 'Dina', lastName: `Inst${uniq}`, gender: 'FEMALE', dateOfBirth: '2016-05-01', sendWelcome: false }).expect(201)).body;
    const d = (await request(http).post(`/api/v1/players/${kid2.id}/terms`).set(auth()).send({ package: 'T2', sessionsPerWeek: 1, issue: false }).expect(201)).body;
    await request(http).post(`/api/v1/invoices/${d.invoice.id}/payment-link`).set(auth()).send({}).expect(400);
  });
});
