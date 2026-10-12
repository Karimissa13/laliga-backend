import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';

/**
 * Paying with wallet credit (Karim, 12 Oct 2026): any invoice — season package, trip,
 * league — from the family's wallet; where the credit went shown on the statement and
 * the ledger; cancelling a credit and taking a wallet payment back.
 */
describe('Family wallet — paying invoices, cancelling, taking back (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  let teams: any[];
  let g: any, kid: any, season: any, trip: any, league: any;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const wallet = async () => Number((await request(http).get(`/api/v1/guardians/${g.id}/wallet`).set(auth()).expect(200)).body.balance);
  const invoice = async (id: string) => (await request(http).get(`/api/v1/invoices/${id}`).set(auth()).expect(200)).body;
  const owed = (i: any) => r2(Number(i.total) - Number(i.amountPaid) - Number(i.writeOffAmount));
  const credit = (amount: number, reason = 'Goodwill — test') =>
    request(http).post(`/api/v1/guardians/${g.id}/wallet/credit`).set(auth()).send({ amount, reason }).expect(201);
  const statement = async (qs = '') => (await request(http).get(`/api/v1/dashboard/wallet-ledger?guardianId=${g.id}${qs}`).set(auth()).expect(200)).body;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(m.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login').send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    teams = (await request(http).get('/api/v1/team-board').set(auth())).body;
    g = (await request(http).post('/api/v1/guardians').set(auth()).send({
      fullName: `Wallet ${uniq}`, email: `wallet${uniq}@example.com`, mobile: `+97156${String(uniq).slice(-7)}`,
    }).expect(201)).body;
    kid = (await request(http).post('/api/v1/players').set(auth()).send({ guardianId: g.id, firstName: 'Omar', lastName: `Wal${uniq}`, gender: 'MALE', dateOfBirth: '2015-03-01', sendWelcome: false }).expect(201)).body;
    // A season package on a 3-instalment plan, a trip and a league entry.
    season = (await request(http).post(`/api/v1/players/${kid.id}/terms`).set(auth()).send({
      package: 'FULL', sessionsPerWeek: 2, teamId: teams.find((t) => t.name === 'U12 Development').id,
      instalments: [{ percent: 40, dueDate: '2026-10-20' }, { percent: 30, dueDate: '2027-01-13' }, { percent: 30, dueDate: '2027-04-21' }],
    }).expect(201)).body.invoice;
    trip = (await request(http).post(`/api/v1/players/${kid.id}/items`).set(auth()).send({
      items: [{ description: 'Salou Cup — trip to Spain', amountInclVat: 3150, stream: 'SALOU_CUP' }],
    }).expect(201)).body.invoice;
    league = (await request(http).post(`/api/v1/players/${kid.id}/items`).set(auth()).send({
      items: [{ description: 'Man City League — season entry', amountInclVat: 600, stream: 'MAN_CITY_LEAGUE' }],
    }).expect(201)).body.invoice;
  }, 60000);
  afterAll(async () => { await app.close(); });

  it('lists the invoices wallet credit can pay, with what each is for', async () => {
    const list = (await request(http).get(`/api/v1/guardians/${g.id}/wallet/payable`).set(auth()).expect(200)).body;
    const by = (id: string) => list.find((x: any) => x.id === id);
    expect(by(season.id)).toMatchObject({ purpose: 'Full season', hasPlan: true });
    expect(by(trip.id)).toMatchObject({ purpose: 'Salou Cup (trip)', owed: 3150 });
    expect(by(league.id)).toMatchObject({ purpose: 'Man City League', owed: 600 });
  });

  it('pays a trip in full and a league in part from the wallet', async () => {
    await credit(4000);
    expect(await wallet()).toBe(4000);
    const a = (await request(http).post(`/api/v1/invoices/${trip.id}/pay-from-wallet`).set(auth()).send({ amount: 3150 }).expect(201)).body;
    expect(a.invoice.status).toBe('PAID');
    expect(a.wallet).toBe(850);
    const b = (await request(http).post(`/api/v1/invoices/${league.id}/pay-from-wallet`).set(auth()).send({ amount: 200 }).expect(201)).body;
    expect(b.invoice.status).toBe('PART_PAID');
    expect(owed(b.invoice)).toBe(400);
    expect(await wallet()).toBe(650);
    // The invoice shows it as paid from the wallet, not as money received.
    const reg = (await request(http).get(`/api/v1/invoice-register?invoiceNo=${trip.number.replace('LA-', '')}`).set(auth())).body.data[0];
    expect(reg).toMatchObject({ wallet: 3150, received: 0, pending: 0 });
  });

  it('shows where the credit went: the invoice, the date and what it was for', async () => {
    const s = await statement('&kind=used');
    expect(s.data.length).toBe(2);
    const trip1 = s.data.find((e: any) => e.invoiceNumber === trip.number);
    expect(trip1).toMatchObject({ type: 'DEBIT', amount: 3150, kind: 'INVOICE_PAYMENT', kindLabel: 'Used to pay an invoice', purpose: 'Salou Cup (trip)', invoiceId: trip.id, cancellable: true });
    expect(trip1.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.data.find((e: any) => e.invoiceNumber === league.number).purpose).toBe('Man City League');
    const csv = await request(http).get(`/api/v1/dashboard/wallet-ledger.csv?guardianId=${g.id}`).set(auth()).expect(200);
    expect(csv.text).toContain('Used For');
    expect(csv.text).toContain('Salou Cup (trip)');
  });

  it('pays one instalment of a season package', async () => {
    const plan = (await request(http).get(`/api/v1/invoices/${season.id}/instalments`).set(auth())).body;
    const first = plan.instalments[0];
    await credit(first.amount - 650 + 1);                                    // wallet now covers instalment 1, with 1 AED spare
    const r = (await request(http).post(`/api/v1/invoices/${season.id}/pay-from-wallet`).set(auth()).send({ amount: first.amount, instalmentSeq: 1 }).expect(201)).body;
    expect(r.invoice.statusLabel).toBe('Instalment 1 of 3 paid');
    expect(r.wallet).toBeCloseTo(1, 2);
  });

  it('refuses more than the wallet holds, more than the invoice owes, and a paid invoice', async () => {
    const more = await request(http).post(`/api/v1/invoices/${league.id}/pay-from-wallet`).set(auth()).send({ amount: 50 }).expect(400);
    expect(more.body.message).toMatch(/Not enough in the wallet — it holds AED 1\.00/);
    await credit(1000);
    const over = await request(http).post(`/api/v1/invoices/${league.id}/pay-from-wallet`).set(auth()).send({ amount: 401 }).expect(400);
    expect(over.body.message).toMatch(/only owes AED 400\.00/);
    await request(http).post(`/api/v1/invoices/${trip.id}/pay-from-wallet`).set(auth()).send({ amount: 10 }).expect(400);   // already paid
    expect(await wallet()).toBeCloseTo(1001, 2);                             // nothing moved
  });

  it('two wallet payments at the same moment can never overpay the invoice', async () => {
    const [x, y] = await Promise.all([
      request(http).post(`/api/v1/invoices/${league.id}/pay-from-wallet`).set(auth()).send({ amount: 300 }),
      request(http).post(`/api/v1/invoices/${league.id}/pay-from-wallet`).set(auth()).send({ amount: 300 }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 400]);
    expect(owed(await invoice(league.id))).toBe(100);
    expect(await wallet()).toBeCloseTo(701, 2);
  });

  it('"Record a payment" with the Wallet method takes the money out of the wallet (it used not to)', async () => {
    await request(http).post(`/api/v1/invoices/${league.id}/payments`).set(auth()).send({ amount: 100, method: 'WALLET' }).expect(201);
    expect(await wallet()).toBeCloseTo(601, 2);
    expect((await invoice(league.id)).status).toBe('PAID');
  });

  it('takes a wallet payment back: the money returns, the invoice owes it again', async () => {
    const s = await statement('&kind=used');
    const tripEntry = s.data.find((e: any) => e.invoiceNumber === trip.number);
    const before = await wallet();
    const r = (await request(http).post(`/api/v1/wallet-entries/${tripEntry.id}/cancel`).set(auth()).send({ reason: 'Trip cancelled by the family' }).expect(201)).body;
    expect(r.wallet).toBeCloseTo(before + 3150, 2);
    const t = await invoice(trip.id);
    expect(t.status).toBe('ISSUED');
    expect(owed(t)).toBe(3150);
    expect(t.payments.some((p: any) => p.reversalOfId && p.direction === 'REFUND' && p.method === 'WALLET')).toBe(true);
    // No credit note: nothing was refunded, the payment was taken back.
    expect((await request(http).get(`/api/v1/invoices/${trip.id}/credit-notes`).set(auth())).body).toHaveLength(0);
    const after = await statement();
    expect(after.data.find((e: any) => e.id === tripEntry.id)).toMatchObject({ cancellable: false, cancelReason: 'Trip cancelled by the family' });
    expect(after.data[0]).toMatchObject({ kind: 'PAYMENT_REVERSAL', type: 'CREDIT', amount: 3150 });
    await request(http).post(`/api/v1/wallet-entries/${tripEntry.id}/cancel`).set(auth()).send({ reason: 'Again' }).expect(400);
    // The invoice list shows it owed again; the payment report labels the reversing row.
    const reg = (await request(http).get(`/api/v1/invoice-register?invoiceNo=${trip.number.replace('LA-', '')}`).set(auth())).body.data[0];
    expect(reg).toMatchObject({ wallet: 0, pending: 3150 });
  });

  it('a taken-back instalment payment re-opens that instalment', async () => {
    const pays = (await invoice(season.id)).payments.filter((p: any) => p.method === 'WALLET' && p.direction === 'INBOUND');
    await request(http).post(`/api/v1/payments/${pays[0].id}/reverse-wallet`).set(auth()).send({ reason: 'Paid by card instead' }).expect(201);
    const plan = (await request(http).get(`/api/v1/invoices/${season.id}/instalments`).set(auth())).body;
    expect(plan.counts).toEqual({ total: 3, paid: 0, pending: 3 });
    expect((await invoice(season.id)).statusLabel).toBe('Invoice issued');
  });

  it('cancels a credit added for another reason, only while the money is still in the wallet', async () => {
    const s = await statement('&kind=added');
    const goodwill = s.data.find((e: any) => e.kind === 'CREDIT' && e.amount === 1000);
    const before = await wallet();
    await request(http).post(`/api/v1/wallet-entries/${goodwill.id}/cancel`).set(auth()).send({ reason: 'x' }).expect(400);   // reason required
    await request(http).post(`/api/v1/wallet-entries/${goodwill.id}/cancel`).set(auth()).send({ reason: 'Added to the wrong family' }).expect(201);
    expect(await wallet()).toBeCloseTo(before - 1000, 2);
    const c = (await statement('&kind=cancelled')).data;
    expect(c.some((e: any) => e.id === goodwill.id && e.cancelledAt)).toBe(true);
    expect(c.some((e: any) => e.kind === 'CANCELLATION' && e.amount === 1000)).toBe(true);

    // Spend almost everything, then try to cancel a credit that is no longer there.
    const big = (await statement('&kind=added')).data.find((e: any) => e.kind === 'CREDIT' && e.amount === 4000);
    const left = await wallet();
    await request(http).post(`/api/v1/invoices/${trip.id}/pay-from-wallet`).set(auth()).send({ amount: Math.min(left, 3150) }).expect(201);
    const no = await request(http).post(`/api/v1/wallet-entries/${big.id}/cancel`).set(auth()).send({ reason: 'Mistake' }).expect(400);
    expect(no.body.message).toMatch(/Not enough in the wallet/);
  });

  it('a refund credit is corrected on its invoice, not cancelled in the wallet; coaches can do none of this', async () => {
    const paid = (await invoice(trip.id));
    await request(http).post(`/api/v1/invoices/${trip.id}/refund`).set(auth()).send({ amount: 50, reason: 'Partial refund test', toWallet: true }).expect(201);
    const refundEntry = (await statement()).data.find((e: any) => e.kind === 'REFUND');
    expect(refundEntry).toMatchObject({ invoiceId: paid.id, cancellable: false });
    const no = await request(http).post(`/api/v1/wallet-entries/${refundEntry.id}/cancel`).set(auth()).send({ reason: 'Try' }).expect(400);
    expect(no.body.message).toMatch(/comes from a refund/);
    const coachTok = (await request(http).post('/api/v1/auth/login').send({ email: 'sergio@laligaacademy.local', password: 'Coach@12345' })).body.accessToken;
    const coach = { Authorization: `Bearer ${coachTok}` };
    await request(http).post(`/api/v1/invoices/${league.id}/pay-from-wallet`).set(coach).send({ amount: 1 }).expect(403);
    await request(http).post(`/api/v1/wallet-entries/${refundEntry.id}/cancel`).set(coach).send({ reason: 'Try' }).expect(403);
    await request(http).get(`/api/v1/guardians/${g.id}/wallet/payable`).set(coach).expect(403);
  });
});
