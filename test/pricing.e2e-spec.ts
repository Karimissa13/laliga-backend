import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';

/**
 * The 2026/27 price list (VAT inclusive), term options, optional extras, the
 * "User term" items invoice, and the dashboard figures they feed.
 *
 * Prices used here, straight from the sheet:
 *   2 a week · U6/U8: T1 4,092 · T1&2 4,910 · Full 6,820
 *   2 a week · U10–U18: T1 5,610 · T1&2 6,732 · Full 9,350
 *   1 a week · U6/U8: T1 2,558
 *   3 a week · U9–U14: Full 14,027
 *   Development kit 350 · Advanced kit 550 · Man City League 600
 */
describe('Price list, term options and extras (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  let teams: any[];
  let products: Record<string, any>;
  const teamFor = (code: string, level: string) => teams.find((t) => t.level === level && t.ageCodes.includes(code));

  const family = async (tag: string) => (await request(http).post('/api/v1/guardians').set(auth()).send({
    fullName: `${tag} Pricing ${uniq}`, email: `${tag.toLowerCase()}.p${uniq}@example.com`,
    mobile: `+97155${String(uniq).slice(-6)}${tag.length}` }).expect(201)).body;
  const child = async (guardianId: string, firstName: string, dob: string) =>
    (await request(http).post('/api/v1/players').set(auth()).send({
      guardianId, firstName, lastName: `Price${uniq}`, dateOfBirth: dob, gender: 'MALE',
    }).expect(201)).body;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(m.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    teams = (await request(http).get('/api/v1/team-board').set(auth()).expect(200)).body;
    const list = (await request(http).get('/api/v1/products').set(auth()).expect(200)).body;
    products = Object.fromEntries(list.map((p: any) => [p.code, p]));
  }, 60000);
  afterAll(async () => { await app.close(); });

  it('publishes the price list as printed', async () => {
    const pl = (await request(http).get('/api/v1/price-list').set(auth()).expect(200)).body;
    expect(pl.packages.map((p: any) => p.code)).toEqual(['T1', 'T2', 'T3', 'T1_2', 'T2_3', 'FULL']);
    const row = (spw: number, cat: string) => pl.tiers.find((t: any) => t.sessionsPerWeek === spw).rows.find((r: any) => r.category === cat);
    expect(row(2, 'U8').prices).toEqual({ T1: 4092, T2: 2455, T3: 1910, T1_2: 4910, T2_3: 3930, FULL: 6820 });
    expect(row(2, 'U12').prices.FULL).toBe(9350);
    expect(row(1, 'U6').prices.T1).toBe(2558);
    expect(row(3, 'U12').prices.FULL).toBe(14027);
    expect(row(3, 'U16').prices.FULL).toBe(10659);
    expect(row(2, 'GIRLS').prices.T1).toBe(3630);
    expect(row(2, 'U8').hoursPerSession).toBe(1);
    expect(row(2, 'U12').hoursPerSession).toBe(1.5);
  });

  it('offers the options a Development child can buy', async () => {
    const ag = (await request(http).get('/api/v1/age-groups').set(auth())).body.find((a: any) => a.code === 'U10');
    const team = teamFor('U10', 'DEVELOPMENT');
    const o = (await request(http).get(`/api/v1/registration/options?ageGroupId=${ag.id}&teamId=${team.id}`).set(auth()).expect(200)).body;
    expect(o.packages).toHaveLength(6);
    expect(o.tiers.map((t: any) => t.sessionsPerWeek)).toEqual([1, 2]);   // 3 a week is Advanced & HPC only
    expect(o.defaultSessionsPerWeek).toBe(2);                            // Tue & Thu
    expect(o.products.map((p: any) => p.code)).toEqual(['KIT-DEV', 'MCL']);
    const hpc = teamFor('U12', 'HPC');
    const o2 = (await request(http).get(`/api/v1/registration/options?teamId=${hpc.id}`).set(auth()).expect(200)).body;
    expect(o2.tiers.map((t: any) => t.sessionsPerWeek)).toEqual([3]);
    expect(o2.products.map((p: any) => p.code)).toEqual(['KIT-ADV', 'MCL']);
  });

  it('quotes a new child at the VAT-inclusive list price', async () => {
    const team = teamFor('U12', 'DEVELOPMENT');
    const q = async (extra: string) => (await request(http)
      .get(`/api/v1/registration/quote?dob=2015-02-02&teamId=${team.id}&${extra}`).set(auth()).expect(200)).body;
    expect((await q('package=T1_2')).total).toBe(6732);
    expect((await q('package=FULL')).total).toBe(9350);
    const one = await q('package=T1&sessionsPerWeek=1');
    expect(one.total).toBe(3086);
    expect(one.netExclVat + one.vat).toBeCloseTo(3086, 2);
    const withExtras = await q(`package=FULL&productIds=${products['KIT-DEV'].id},${products.MCL.id}`);
    expect(withExtras.extrasTotal).toBe(950);
    expect(withExtras.grandTotal).toBe(10300);
    const no = await q('package=T1&sessionsPerWeek=3');
    expect(no.ok).toBe(false);
    expect(no.reason).toMatch(/isn't offered at Development/);
  });

  describe('a family buying a full season with extras', () => {
    let g: any, older: any, younger: any, olderInvoice: any;

    it('enrols in all three terms on one invoice, extras on their own lines', async () => {
      g = await family('Season');
      older = await child(g.id, 'Older', '2015-04-04');   // U12
      const team = teamFor('U12', 'DEVELOPMENT');
      const r = (await request(http).post(`/api/v1/players/${older.id}/terms`).set(auth()).send({
        package: 'FULL', teamId: team.id, productIds: [products['KIT-DEV'].id, products.MCL.id],
      }).expect(201)).body;
      expect(r.enrolmentIds).toHaveLength(3);
      expect(r.package).toBe('FULL');
      olderInvoice = r.invoice;
      expect(Number(olderInvoice.total)).toBe(10300);      // 9,350 + 350 + 600
      const byStream = Object.fromEntries(olderInvoice.lineItems.map((l: any) => [l.stream, l]));
      expect(byStream.ACADEMY.package).toBe('FULL');
      expect(byStream.ACADEMY.description).toMatch(/Full season/);
      expect(byStream.KITS.kitItems).toEqual([{ type: 'TRAINING', qty: 1 }]);
      expect(byStream.MAN_CITY_LEAGUE).toBeTruthy();
    });

    it('refuses a second purchase that overlaps a term already bought', async () => {
      const res = await request(http).post(`/api/v1/players/${older.id}/terms`).set(auth()).send({ package: 'T3' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Already enrolled in Term 3/);
    });

    it('takes the sibling discount off the fee only — never the kit or the league', async () => {
      younger = await child(g.id, 'Younger', '2017-04-04');   // U10
      const team = teamFor('U10', 'DEVELOPMENT');
      const r = (await request(http).post(`/api/v1/players/${younger.id}/terms`).set(auth()).send({
        package: 'T1_2', teamId: team.id, productIds: [products['KIT-DEV'].id],
      }).expect(201)).body;
      // 6,732 → net 6,411.43; 15% = 961.71; net 5,449.72 + VAT 272.49 = 5,722.21; + kit 350
      expect(Number(r.invoice.discountTotal)).toBe(961.71);
      expect(Number(r.invoice.total)).toBe(6072.21);
      const kit = r.invoice.lineItems.find((l: any) => l.stream === 'KITS');
      expect(Number(kit.lineTotal) + Number(kit.lineTotal) * 0.05).toBeCloseTo(350, 1);
    });
  });

  it('a late older sibling credits a younger child\'s full-season fee once, not once per term', async () => {
    const g = await family('Late');
    const y = await child(g.id, 'Little', '2019-06-06');   // U8
    const u8 = teamFor('U8', 'DEVELOPMENT');
    const first = (await request(http).post(`/api/v1/players/${y.id}/terms`).set(auth()).send({ package: 'FULL', teamId: u8.id }).expect(201)).body;
    expect(Number(first.invoice.total)).toBe(6820);
    const o = await child(g.id, 'Big', '2015-06-06');
    const second = (await request(http).post(`/api/v1/players/${o.id}/terms`).set(auth()).send({ package: 'FULL', teamId: teamFor('U12', 'DEVELOPMENT').id }).expect(201)).body;
    // 6,820 → net 6,495.24; 15% = 974.29 + VAT 48.71
    expect(second.siblingCredits).toHaveLength(1);
    expect(second.siblingCredits[0]).toMatchObject({ playerId: y.id, total: 1023, appliedToInvoice: 1023 });
    const again = (await request(http).get(`/api/v1/players/${y.id}/profile`).set(auth()).expect(200)).body;
    expect(again.siblingCredits).toHaveLength(1);
    expect(again.history.filter((h: any) => h.package === 'FULL')).toHaveLength(3);
  });

  it('"User term" adds items to a registered child on their own invoice', async () => {
    const g = await family('Items');
    const p = await child(g.id, 'Kitted', '2014-01-01');
    const r = (await request(http).post(`/api/v1/players/${p.id}/items`).set(auth()).send({
      items: [{ productId: products['KIT-ADV'].id, quantity: 2 }, { description: 'Abu Dhabi Cup entry', amountInclVat: 150, stream: 'ABU_DHABI_CUP' }],
    }).expect(201)).body;
    expect(r.invoice.type).toBe('ADDITIONAL');
    expect(r.invoice.status).toBe('ISSUED');
    expect(Number(r.invoice.total)).toBe(1250);
    const kit = r.invoice.lineItems.find((l: any) => l.stream === 'KITS');
    expect(kit.kitItems).toEqual([{ type: 'TRAINING', qty: 2 }, { type: 'HOME', qty: 2 }]);
    const profile = (await request(http).get(`/api/v1/players/${p.id}/profile`).set(auth()).expect(200)).body;
    const note = profile.comments.find((c: any) => /^Added: /.test(c.body));
    expect(note.body).toMatch(/Advanced kit × 2/);
    expect(note.body).toMatch(/Abu Dhabi Cup entry/);
    expect(note.body).toMatch(/AED 1250\.00/);

    const bad = await request(http).post(`/api/v1/players/${p.id}/items`).set(auth()).send({ items: [{ description: 'Nothing' }] });
    expect(bad.status).toBe(400);
  });

  it('the dashboard counts what was sold', async () => {
    const d = (await request(http).get('/api/v1/dashboard/overview').set(auth()).expect(200)).body;
    expect(d.filters.season.id).toBeTruthy();
    expect(d.admin.players.registered).toBeGreaterThan(0);
    expect(d.admin.players.spark).toHaveLength(8);
    expect(d.admin.schedule.weeks.length).toBeGreaterThan(30);
    expect(d.admin.schedule.terms).toHaveLength(3);
    const f = d.finance;
    expect(f.revenue.months).toHaveLength(11);
    expect(f.revenue.months[0].key).toBe('2026-09');
    expect(f.revenue.months[10].key).toBe('2027-07');
    const kits = Object.fromEntries(f.kits.types.map((k: any) => [k.key, k.units]));
    expect(kits.HOME).toBeGreaterThanOrEqual(2);
    expect(kits.TRAINING).toBeGreaterThanOrEqual(4);
    const stream = (k: string) => f.streams.find((s: any) => s.key === k).amount;
    expect(stream('MAN_CITY_LEAGUE')).toBeGreaterThanOrEqual(600);
    expect(stream('ABU_DHABI_CUP')).toBeGreaterThanOrEqual(150);
    // collected + pending across months equals the headline
    const sum = f.revenue.months.reduce((s: number, m: any) =>
      s + f.streams.reduce((t: number, x: any) => t + m[x.key], 0) + m.PENDING, 0);
    expect(sum).toBeCloseTo(f.revenue.total, 0);
    const p = f.payments;
    const aged = p.aging.notDue.amount + p.aging.d0_30.amount + p.aging.d31_60.amount + p.aging.d60plus.amount;
    expect(aged).toBeCloseTo(p.totalUnpaid, 1);
    expect(p.unpaidInvoices).toBeGreaterThan(0);

    // A location with nothing at it is empty, not an error.
    const zsc = (await request(http).get('/api/v1/locations').set(auth())).body.find((l: any) => /Zayed/.test(l.name));
    const z = (await request(http).get(`/api/v1/dashboard/overview?locationId=${zsc.id}`).set(auth()).expect(200)).body;
    expect(z.filters.location.name).toMatch(/Zayed/);
    expect(z.finance.revenue.total).toBeLessThan(f.revenue.total);
  });

  it('a coach sees the admin side of the dashboard but no money', async () => {
    const coachTok = (await request(http).post('/api/v1/auth/login')
      .send({ email: 'sergio@laligaacademy.local', password: 'Coach@12345' }).expect(201)).body.accessToken;
    const d = (await request(http).get('/api/v1/dashboard/overview').set({ Authorization: `Bearer ${coachTok}` }).expect(200)).body;
    expect(d.finance).toBeNull();
    expect(d.admin.coaches.total).toBeGreaterThan(0);
  });

  it('price-list edits apply to new quotes; coaches can be set full- or part-time', async () => {
    const pl = (await request(http).get('/api/v1/price-list').set(auth())).body;
    const row = pl.tiers.find((t: any) => t.sessionsPerWeek === 1).rows.find((r: any) => r.category === 'GIRLS');
    await request(http).patch(`/api/v1/price-list/${row.id}`).set(auth()).send({ prices: { T1: 2000 } }).expect(200);
    const after = (await request(http).get('/api/v1/price-list').set(auth())).body
      .tiers.find((t: any) => t.sessionsPerWeek === 1).rows.find((r: any) => r.category === 'GIRLS');
    expect(after.prices.T1).toBe(2000);
    expect(after.prices.T2).toBe(1198);
    await request(http).patch(`/api/v1/price-list/${row.id}`).set(auth()).send({ prices: { T1: 1997 } }).expect(200);

    const coach = (await request(http).get('/api/v1/coaches').set(auth())).body[0];
    const c = (await request(http).patch(`/api/v1/coaches/${coach.id}`).set(auth()).send({ employmentType: 'PART_TIME' }).expect(200)).body;
    expect(c.employmentType).toBe('PART_TIME');
    await request(http).patch(`/api/v1/coaches/${coach.id}`).set(auth()).send({ photoUrl: 'javascript:alert(1)' }).expect(400);
    await request(http).patch(`/api/v1/coaches/${coach.id}`).set(auth()).send({ employmentType: null }).expect(200);
  });

  it('calendar entries appear on the dashboard timeline', async () => {
    const season = (await request(http).get('/api/v1/seasons').set(auth())).body.find((s: any) => s.isActive);
    const ev = (await request(http).post('/api/v1/academy-events').set(auth()).send({
      kind: 'TOURNAMENT', title: `Abu Dhabi Cup ${uniq}`, startDate: '2027-01-16', endDate: '2027-01-17', seasonId: season.id,
    }).expect(201)).body;
    const d = (await request(http).get('/api/v1/dashboard/overview').set(auth())).body;
    const shown = d.admin.schedule.events.find((e: any) => e.id === ev.id);
    expect(shown).toBeTruthy();
    expect(shown.startWeek).toBe(shown.endWeek);
    await request(http).post('/api/v1/academy-events').set(auth()).send({
      kind: 'MATCH', title: 'Backwards', startDate: '2027-01-17', endDate: '2027-01-16',
    }).expect(400);
    await request(http).delete(`/api/v1/academy-events/${ev.id}`).set(auth()).expect(200);
  });
});
