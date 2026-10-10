import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';

/**
 * Late-sibling credits (policy confirmed Oct 2026).
 *
 * A younger child invoiced as an only child moves down the sibling ladder when an
 * older sibling registers later in the same term. The difference is credited
 * automatically: applied to their invoice if it still has a balance, otherwise
 * kept in the family wallet. Issued invoices are never edited.
 *
 * Prices from the 2026/27 price list (VAT inclusive), Term 1 at 2 sessions a week:
 * U8 4,092 (net 3,897.14) · U12 and U16 5,610 (net 5,342.86).
 */
describe('Late-sibling credits (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  let term1: string;

  const family = async (tag: string) => (await request(http).post('/api/v1/guardians').set(auth()).send({
    fullName: `${tag} Family ${uniq}`, email: `${tag.toLowerCase()}${uniq}@example.com`,
    mobile: `+97156${String(uniq).slice(-6)}${tag.length}` }).expect(201)).body;
  const child = async (guardianId: string, firstName: string, dob: string) =>
    (await request(http).post('/api/v1/players').set(auth()).send({
      guardianId, firstName, lastName: `Credit${uniq}`, dateOfBirth: dob, gender: 'MALE',
    }).expect(201)).body;
  const addTerm = async (playerId: string, extra: any = {}) =>
    (await request(http).post(`/api/v1/players/${playerId}/terms`).set(auth()).send({ termId: term1, ...extra }).expect(201)).body;
  const invoice = async (id: string) => (await request(http).get(`/api/v1/invoices/${id}`).set(auth()).expect(200)).body;
  const wallet = async (guardianId: string) =>
    Number((await request(http).get(`/api/v1/guardians/${guardianId}/wallet`).set(auth()).expect(200)).body.balance);

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(m.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    const seasons = (await request(http).get('/api/v1/seasons').set(auth())).body;
    const sid = seasons.find((s: any) => s.isActive).id;
    term1 = (await request(http).get('/api/v1/terms').set(auth())).body
      .filter((t: any) => t.seasonId === sid)
      .sort((a: any, b: any) => a.startDate.localeCompare(b.startDate))[0].id;
  }, 60000);
  afterAll(async () => { await app.close(); });

  describe('unpaid invoice — the credit reduces its balance', () => {
    let g: any, youngest: any, middle: any, yInvoiceId: string, mInvoiceId: string;

    it('the youngest, registered first as an only child, pays full price', async () => {
      g = await family('Unpaid');
      youngest = await child(g.id, 'Youngest', '2019-03-01');   // U8 · 4,092
      const r = await addTerm(youngest.id);
      yInvoiceId = r.invoice.id;
      expect(Number(r.invoice.discountTotal)).toBe(0);
      expect(Number(r.invoice.total)).toBe(4092);
      expect(r.siblingCredits).toEqual([]);
    });

    it('an older sibling joins: the youngest is credited 15% + VAT, applied to their invoice', async () => {
      middle = await child(g.id, 'Middle', '2015-03-01');        // U12 · 5,610
      const r = await addTerm(middle.id);
      mInvoiceId = r.invoice.id;
      expect(Number(r.invoice.discountTotal)).toBe(0);            // the older one is now 1st → full price
      expect(r.siblingCredits).toHaveLength(1);
      const c = r.siblingCredits[0];
      expect(c).toMatchObject({ playerId: youngest.id, percentBefore: 0, percentAfter: 15, total: 613.8, appliedToInvoice: 613.8, leftInWallet: 0 });

      const yInv = await invoice(yInvoiceId);
      expect(Number(yInv.total)).toBe(4092);                      // the issued invoice is not edited…
      expect(Number(yInv.amountPaid)).toBe(613.8);                // …the credit is a wallet payment against it
      expect(yInv.status).toBe('PART_PAID');
      expect(await wallet(g.id)).toBe(0);                         // credited and immediately applied
    });

    it('an even older sibling joins: each younger child gets only what is still owed', async () => {
      const eldest = await child(g.id, 'Eldest', '2011-03-01');  // U16 · 5,610
      const r = await addTerm(eldest.id);
      const byChild = Object.fromEntries(r.siblingCredits.map((c: any) => [c.playerId, c]));
      // Middle: 1st → 2nd, 0% → 15% of 5,342.86 = 801.43 + VAT 40.07
      expect(byChild[middle.id]).toMatchObject({ percentBefore: 0, percentAfter: 15, total: 841.5 });
      // Youngest: 2nd → 3rd, 15% → 25% of 3,897.14 — only what is still owed: 389.72 + VAT 19.49
      expect(byChild[youngest.id]).toMatchObject({ percentBefore: 15, percentAfter: 25, total: 409.21 });
      expect(Number((await invoice(yInvoiceId)).amountPaid)).toBe(1023.01);   // 613.80 + 409.21
      expect(Number((await invoice(mInvoiceId)).amountPaid)).toBe(841.5);
    });

    it('records the credit on the child\'s page and in the activity log', async () => {
      const d = (await request(http).get(`/api/v1/players/${youngest.id}/profile`).set(auth()).expect(200)).body;
      expect(d.siblingCredits).toHaveLength(2);
      expect(d.comments.some((x: any) => /Sibling discount re-ranked/.test(x.body))).toBe(true);
      const logs = (await request(http).get('/api/v1/audit-logs?limit=50').set(auth())).body;
      expect(logs.filter((l: any) => l.action === 'discount.sibling_credit' && l.entityId === youngest.id).length).toBe(2);
    });
  });

  describe('already-paid invoice — the credit stays in the wallet', () => {
    it('credits the wallet instead of the invoice', async () => {
      const g = await family('Paid');
      const y = await child(g.id, 'Younger', '2019-05-05');
      const first = await addTerm(y.id);
      await request(http).post(`/api/v1/invoices/${first.invoice.id}/payments`).set(auth())
        .send({ amount: 4092, method: 'CARD' }).expect(201);
      expect((await invoice(first.invoice.id)).status).toBe('PAID');

      const o = await child(g.id, 'Older', '2015-05-05');
      const r = await addTerm(o.id);
      expect(r.siblingCredits[0]).toMatchObject({ total: 613.8, appliedToInvoice: 0, leftInWallet: 613.8 });
      expect(await wallet(g.id)).toBe(613.8);
      expect((await invoice(first.invoice.id)).status).toBe('PAID');
    });
  });

  describe('a manual discount is a decision that stands', () => {
    it('does not credit on top of it', async () => {
      const g = await family('Manual');
      const y = await child(g.id, 'Younger', '2019-06-06');
      await addTerm(y.id, { manualDiscount: { amount: 100, label: 'Goodwill', reason: 'Agreed at trial' } });
      const o = await child(g.id, 'Older', '2015-06-06');
      const r = await addTerm(o.id);
      expect(r.siblingCredits).toEqual([]);
      expect(await wallet(g.id)).toBe(0);
    });
  });

  describe('drafts', () => {
    it('credits nothing until the older sibling\'s invoice is issued', async () => {
      const g = await family('Draft');
      const y = await child(g.id, 'Younger', '2019-07-07');
      await addTerm(y.id);
      const o = await child(g.id, 'Older', '2015-07-07');
      const draft = await addTerm(o.id, { issue: false });
      expect(draft.invoice.status).toBe('DRAFT');
      expect(draft.siblingCredits).toEqual([]);
      expect(await wallet(g.id)).toBe(0);

      const issued = (await request(http).post(`/api/v1/invoices/${draft.invoice.id}/issue`).set(auth()).expect(201)).body;
      expect(issued.siblingCredits).toHaveLength(1);
      expect(issued.siblingCredits[0]).toMatchObject({ playerId: y.id, total: 613.8, appliedToInvoice: 613.8 });
    });
  });

  describe('a younger sibling joining changes nothing for the older ones', () => {
    it('credits no one', async () => {
      const g = await family('Order');
      const o = await child(g.id, 'Older', '2015-08-08');
      await addTerm(o.id);
      const y = await child(g.id, 'Younger', '2019-08-08');
      const r = await addTerm(y.id);
      expect(Number(r.invoice.discountTotal)).toBe(584.57);     // the newcomer takes 15% of 3,897.14 itself
      expect(r.siblingCredits).toEqual([]);
    });
  });
});
