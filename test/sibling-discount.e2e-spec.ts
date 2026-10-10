import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';

/**
 * Sibling-discount policy, end to end.
 *
 * Regression guard for a bug that was live: the engine evaluated one player at a
 * time, so every child in a family received a discount and the largest rule won.
 * A two-child family was discounted twice (AED 930 given away instead of AED 360).
 *
 * Policy under test: the first child pays full price, the second gets 15%, the
 * third 25%, the fourth and beyond 25%. Default order is eldest-pays-full, so the
 * discount lands on the youngest — usually the cheaper U6/U8 bracket. Only the
 * sibling rule applies automatically, and discounts never stack.
 */
describe('Sibling discount (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();

  let seasonId: string;
  let termId: string;
  let guardianId: string;
  const kids: Array<{ id: string; name: string; enrolmentId: string }> = [];

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    const res = await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' });
    token = res.body.accessToken;
    expect(token).toBeTruthy();

    seasonId = (await request(http).get('/api/v1/seasons').set(auth())).body[0].id;
    termId = (await request(http).get('/api/v1/terms').set(auth())).body[0].id;
  }, 60000);

  afterAll(async () => { await app.close(); });

  it('only the sibling rule is marked automatic', async () => {
    const res = await request(http).get('/api/v1/discounts').set(auth()).expect(200);
    const automatic = res.body.filter((d: any) => d.isAutomatic && d.isActive);
    expect(automatic).toHaveLength(1);
    expect(automatic[0].rule).toBe('SIBLING');
    // The ladder is configuration, not code.
    expect(automatic[0].params).toMatchObject({ tiers: [15, 25], beyond: 25 });
  });

  it('creates a family of three children, eldest to youngest', async () => {
    const g = await request(http).post('/api/v1/guardians').set(auth()).send({
      fullName: `Ladder Family ${uniq}`,
      email: `ladder${uniq}@example.com`,
      mobile: '+971500009001' }).expect(201);
    guardianId = g.body.id;

    // Deliberately created out of birth order to prove ordering is by date of
    // birth, not by the order records were entered.
    const defs = [
      { first: 'Middle', dob: '2017-03-02' },
      { first: 'Eldest', dob: '2013-05-20' },
      { first: 'Youngest', dob: '2020-08-11' },
    ];
    for (const d of defs) {
      const p = await request(http).post('/api/v1/players').set(auth()).send({
        guardianId, firstName: d.first, lastName: `Ladder${uniq}`, dateOfBirth: d.dob, gender: 'MALE',
      }).expect(201);
      const e = await request(http).post('/api/v1/enrolments').set(auth()).send({
        playerId: p.body.id, seasonId, termId,
      }).expect(201);
      kids.push({ id: p.body.id, name: d.first, enrolmentId: e.body.enrolment.id });
    }
    expect(kids).toHaveLength(3);
  });

  it('ranks eldest first and applies 0 / 15 / 25 per cent', async () => {
    const res = await request(http)
      .get(`/api/v1/discounts/sibling-plan?guardianId=${guardianId}&seasonId=${seasonId}`)
      .set(auth()).expect(200);

    expect(res.body.isOverridden).toBe(false);
    const byRank = res.body.entries;
    expect(byRank.map((e: any) => e.name.split(' ')[0])).toEqual(['Eldest', 'Middle', 'Youngest']);
    expect(byRank.map((e: any) => e.percent)).toEqual([0, 15, 25]);
    expect(byRank[0].reason).toMatch(/pays full price/i);
  });

  it('bills the family once per position, not once per child', async () => {
    const res = await request(http).post('/api/v1/invoices/generate').set(auth()).send({
      enrolmentIds: kids.map((k) => k.enrolmentId),
    }).expect(201);

    const inv = res.body.invoice;
    const applied = inv.discounts;

    // Exactly two discounts for three children — the eldest pays full price.
    expect(applied).toHaveLength(2);
    expect(applied.every((a: any) => a.wasAutomatic)).toBe(true);
    expect(applied.every((a: any) => a.rule === 'SIBLING')).toBe(true);

    // Every discount is attributable to a child, and no child has two.
    const childIds = applied.map((a: any) => a.playerId);
    expect(new Set(childIds).size).toBe(childIds.length);
    expect(childIds).not.toContain(kids.find((k) => k.name === 'Eldest')!.id);

    // The percentages land on the right children.
    const labels = applied.map((a: any) => a.label).sort();
    expect(labels.some((l: string) => /2nd child 15%/.test(l))).toBe(true);
    expect(labels.some((l: string) => /3rd child 25%/.test(l))).toBe(true);

    // And the arithmetic adds up against the line items.
    const lines = inv.lineItems;
    const listTotal = lines.reduce((s: number, l: any) => s + Number(l.unitAmount), 0);
    const netTotal = lines.reduce((s: number, l: any) => s + Number(l.lineTotal), 0);
    expect(Number(inv.discountTotal)).toBeCloseTo(listTotal - netTotal, 2);
    expect(Number(inv.discountTotal)).toBeGreaterThan(0);
  });

  it('an only child gets nothing', async () => {
    const g = await request(http).post('/api/v1/guardians').set(auth()).send({
      fullName: `Only Child ${uniq}`,
      email: `only${uniq}@example.com`,
      mobile: '+971500009002',
    }).expect(201);
    const p = await request(http).post('/api/v1/players').set(auth()).send({
      guardianId: g.body.id, firstName: 'Solo', lastName: `Only${uniq}`, dateOfBirth: '2016-02-02', gender: 'MALE',
    }).expect(201);
    await request(http).post('/api/v1/enrolments').set(auth())
      .send({ playerId: p.body.id, seasonId, termId }).expect(201);

    const plan = await request(http)
      .get(`/api/v1/discounts/sibling-plan?guardianId=${g.body.id}&seasonId=${seasonId}`)
      .set(auth()).expect(200);
    expect(plan.body.entries).toHaveLength(1);
    expect(plan.body.entries[0].percent).toBe(0);
    expect(plan.body.entries[0].reason).toMatch(/only child/i);
  });

  it('lets an admin move the full-price position, and refuses another family\'s child', async () => {
    const youngestFirst = [...kids].sort((a, b) => (a.name === 'Youngest' ? -1 : b.name === 'Youngest' ? 1 : 0));
    const moved = await request(http)
      .patch(`/api/v1/discounts/sibling-order/${guardianId}`)
      .set(auth()).send({ orderedPlayerIds: youngestFirst.map((k) => k.id) }).expect(200);

    expect(moved.body.isOverridden).toBe(true);
    expect(moved.body.entries[0].name).toMatch(/Youngest/);
    expect(moved.body.entries[0].percent).toBe(0);

    // A child from another guardian must be rejected, not silently ignored.
    const other = await request(http).get('/api/v1/players?limit=50').set(auth()).expect(200);
    const stray = other.body.data.find((p: any) => p.guardianId !== guardianId);
    expect(stray).toBeDefined();
    await request(http)
      .patch(`/api/v1/discounts/sibling-order/${guardianId}`)
      .set(auth()).send({ orderedPlayerIds: [stray.id] }).expect(400);

    // Back to the default.
    const reset = await request(http)
      .patch(`/api/v1/discounts/sibling-order/${guardianId}`)
      .set(auth()).send({ orderedPlayerIds: [] }).expect(200);
    expect(reset.body.isOverridden).toBe(false);
    expect(reset.body.entries[0].name).toMatch(/Eldest/);
  });

  it('a manual discount replaces the automatic one rather than stacking', async () => {
    // Fresh family so the enrolments are unbilled.
    const g = await request(http).post('/api/v1/guardians').set(auth()).send({
      fullName: `Stack Test ${uniq}`,
      email: `stack${uniq}@example.com`,
      mobile: '+971500009003',
    }).expect(201);
    const made: Array<{ id: string; enrolmentId: string }> = [];
    for (const dob of ['2014-01-01', '2019-01-01']) {
      const p = await request(http).post('/api/v1/players').set(auth()).send({
        guardianId: g.body.id, firstName: `S${dob.slice(2, 4)}`, lastName: `Stack${uniq}`, dateOfBirth: dob, gender: 'MALE',
      }).expect(201);
      const e = await request(http).post('/api/v1/enrolments').set(auth())
        .send({ playerId: p.body.id, seasonId, termId }).expect(201);
      made.push({ id: p.body.id, enrolmentId: e.body.enrolment.id });
    }
    const youngest = made[1].id;

    const res = await request(http).post('/api/v1/invoices/generate').set(auth()).send({
      enrolmentIds: made.map((m) => m.enrolmentId),
      manualDiscounts: {
        [youngest]: { amount: 500, label: 'Goodwill', reason: 'Approved by operations' },
      },
    }).expect(201);

    const applied = res.body.invoice.discounts;
    // One discount, for the youngest, and it is the manual one.
    const forYoungest = applied.filter((a: any) => a.playerId === youngest);
    expect(forYoungest).toHaveLength(1);
    expect(forYoungest[0].wasAutomatic).toBe(false);
    expect(forYoungest[0].label).toBe('Goodwill');
    expect(Number(forYoungest[0].amount)).toBe(500);
  });
});
