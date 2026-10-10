import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';

/**
 * Players section (Oct 2026): directory filters, the player page actions, and the
 * registration helpers. Includes regressions for three bugs found while building it:
 *   - restore after archive left the child off their team
 *   - quoting a brand-new family crashed (empty IN list with a non-UUID placeholder)
 *   - the legacy behaviour of letting any child onto any team
 */
describe('Players section (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  const auth = () => ({ Authorization: `Bearer ${token}` });

  let seasonId: string, term1: string, term2: string;
  let teams: any[] = [];
  const team = (name: string) => teams.find((t) => t.name === name);
  let guardianId: string, playerId: string, playerRef: string, guardianRef: string;

  const find = async (q: string) => (await request(http).get(`/api/v1/players?${q}`).set(auth()).expect(200)).body;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(m.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    const seasons = (await request(http).get('/api/v1/seasons').set(auth())).body;
    seasonId = seasons.find((s: any) => s.isActive).id;
    const terms = (await request(http).get('/api/v1/terms').set(auth())).body
      .filter((t: any) => t.seasonId === seasonId)
      .sort((a: any, b: any) => a.startDate.localeCompare(b.startDate));
    [term1, term2] = [terms[0].id, terms[1].id];
    teams = (await request(http).get('/api/v1/team-board').set(auth())).body;
  }, 60000);
  afterAll(async () => { await app.close(); });

  describe('academy structure', () => {
    it('has the 21 teams with levels and training slots', () => {
      const names = teams.map((t) => t.name);
      for (const n of ['U6 Development', 'U8 Development 1', 'U8 Development 2', 'U9 Advanced', 'U12 HPC',
        'U12 Advanced White', 'U14 Advanced Blue', 'U16/18 Development', 'U18 Advanced']) {
        expect(names).toContain(n);
      }
      expect(team('U12 HPC').schedule).toBe('Mon, Wed & Fri · 6:00–7:30 pm');
      expect(team('U14 Advanced Blue').schedule).toBe('Tue & Thu · 7:30–9:00 pm');
      expect(team('U16 HPC').schedule).toBe('Mon, Wed & Fri · 7:30–9:00 pm');
      expect(team('U16/18 Development').ageCodes).toEqual(['U16', 'U18']);
    });

    it('places gap years up, and refuses to guess beyond U18', async () => {
      const at = async (dob: string) => (await request(http).get(`/api/v1/registration/placement?dob=${dob}`).set(auth())).body;
      expect((await at('2020-05-01')).code).toBe('U8');   // U7
      expect((await at('2012-06-01')).code).toBe('U16');  // U15
      expect((await at('2010-02-02')).code).toBe('U18');  // U17
      expect((await at('2007-01-01')).code).toBeNull();
    });

    it('lists eligible teams best level first, combined teams included', async () => {
      const ags = (await request(http).get('/api/v1/age-groups').set(auth())).body;
      const u14 = ags.find((a: any) => a.code === 'U14').id;
      const u18 = ags.find((a: any) => a.code === 'U18').id;
      const e14 = (await request(http).get(`/api/v1/registration/eligible-teams?ageGroupId=${u14}`).set(auth())).body
        .map((t: any) => t.name).filter((n: string) => n.startsWith('U14'));
      expect(e14).toEqual(['U14 HPC', 'U14 Advanced White', 'U14 Advanced Blue', 'U14 Development']);
      const e18 = (await request(http).get(`/api/v1/registration/eligible-teams?ageGroupId=${u18}`).set(auth())).body
        .map((t: any) => t.name);
      expect(e18).toEqual(expect.arrayContaining(['U18 Advanced', 'U16/18 Development']));
    });
  });

  describe('registration helpers', () => {
    it('quotes a brand-new family without crashing (regression)', async () => {
      const res = await request(http).get(`/api/v1/registration/quote?dob=2019-01-15&termId=${term1}`).set(auth()).expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.siblingDiscount).toBeNull();
      expect(res.body.total).toBeGreaterThan(0);
    });

    it('creates a family and finds it again by phone, however it is typed', async () => {
      const tail = String(uniq).slice(-7);
      const g = await request(http).post('/api/v1/guardians').set(auth()).send({
        fullName: `Desk Family ${uniq}`, email: `desk${uniq}@example.com`, mobile: `+97155${tail}` }).expect(201);
      guardianId = g.body.id; guardianRef = g.body.reference;
      const hits = (await request(http)
        .get(`/api/v1/registration/guardian-lookup?q=${encodeURIComponent('055 ' + tail)}`).set(auth())).body;
      expect(hits.map((h: any) => h.id)).toContain(guardianId);
    });

    it('quotes a younger sibling for an existing family with the ladder applied', async () => {
      const p = await request(http).post('/api/v1/players').set(auth()).send({
        guardianId, firstName: 'Elder', lastName: `Desk${uniq}`, dateOfBirth: '2014-04-04', gender: 'MALE',
      }).expect(201);
      playerId = p.body.id; playerRef = p.body.reference;
      await request(http).post(`/api/v1/players/${playerId}/terms`).set(auth())
        .send({ termId: term1, teamId: team('U13 Development').id }).expect(201);
      const q = (await request(http)
        .get(`/api/v1/registration/quote?guardianId=${guardianId}&dob=2019-06-06&termId=${term1}&firstName=Younger`)
        .set(auth()).expect(200)).body;
      expect(q.siblingDiscount).toMatchObject({ position: '2nd', percent: 15 });
    });
  });

  describe('placement guard', () => {
    it('refuses a team outside the child\'s category unless deliberately overridden', async () => {
      const bad = await request(http).post(`/api/v1/players/${playerId}/terms`).set(auth())
        .send({ termId: term2, teamId: team('U8 Development 1').id }).expect(400);
      expect(JSON.stringify(bad.body)).toMatch(/CategoryMismatch|takes U8/);
      await request(http).post(`/api/v1/players/${playerId}/terms`).set(auth())
        .send({ termId: term2, teamId: team('U14 Development').id, allowCategoryOverride: true }).expect(201);
    });
  });

  describe('directory', () => {
    it('returns every column the desk asked for', async () => {
      const row = (await find(`playerRef=${playerRef}`)).data[0];
      for (const k of ['guardianEmail', 'guardianMobile', 'reference', 'guardianReference', 'name', 'dateOfBirth',
        'gender', 'category', 'location', 'payment', 'team', 'coach', 'term', 'days', 'latestComment']) {
        expect(row).toHaveProperty(k);
      }
      expect(row.days).toMatch(/·/);
    });

    it('matches PL- and PR- however they are typed', async () => {
      const n = playerRef.replace(/\D/g, '').replace(/^0+/, '');
      expect((await find(`playerRef=PL-${n}`)).meta.total).toBe(1);
      expect((await find(`playerRef=${n}`)).meta.total).toBe(1);
      const byParent = (await find(`guardianRef=${guardianRef.toLowerCase()}`)).data;
      expect(byParent.length).toBeGreaterThan(0);
      expect(byParent.every((r: any) => r.guardianId === guardianId)).toBe(true);
    });

    it('filters by payment state, term and registration dates', async () => {
      expect((await find(`playerRef=${playerRef}&paymentStatus=UNPAID`)).meta.total).toBe(1);
      expect((await find(`playerRef=${playerRef}&paymentStatus=PAID`)).meta.total).toBe(0);
      expect((await find(`playerRef=${playerRef}&termId=${term1}`)).meta.total).toBe(1);
      expect((await find(`playerRef=${playerRef}&registeredFrom=2099-01-01`)).meta.total).toBe(0);
    });

    it('rejects an unknown payment status rather than ignoring it', async () => {
      await request(http).get('/api/v1/players?paymentStatus=MAYBE').set(auth()).expect(400);
    });
  });

  describe('player page actions', () => {
    it('profile carries placement, parent, billing, history and comments', async () => {
      await request(http).post(`/api/v1/players/${playerId}/comments`).set(auth()).send({ body: 'Desk test comment' }).expect(201);
      const d = (await request(http).get(`/api/v1/players/${playerId}/profile`).set(auth()).expect(200)).body;
      expect(d.team.name).toBe('U14 Development');
      expect(d.guardian.reference).toBe(guardianRef);
      expect(d.invoices.length).toBe(2);
      expect(d.history.every((h: any) => h.termId)).toBe(true);
      expect(d.comments[0].body).toBe('Desk test comment');
    });

    it('account switch needs a reason, is read-only, and is audited with that reason', async () => {
      await request(http).post(`/api/v1/guardians/${guardianId}/account-view`).set(auth()).send({}).expect(400);
      const v = (await request(http).post(`/api/v1/guardians/${guardianId}/account-view`).set(auth())
        .send({ reason: `e2e check ${uniq}` }).expect(201)).body;
      expect(v.readOnly).toBe(true);
      const logs = (await request(http).get('/api/v1/audit-logs?limit=20').set(auth())).body;
      expect(logs.find((l: any) => l.action === 'guardian.account_view' && l.metadata?.reason === `e2e check ${uniq}`)).toBeDefined();
    });

    it('archive frees the place; restore gives it back (regression)', async () => {
      await request(http).post(`/api/v1/players/${playerId}/archive`).set(auth()).send({ reason: 'Moving abroad for a term' }).expect(201);
      expect((await find(`playerRef=${playerRef}`)).meta.total).toBe(0);
      expect((await find(`playerRef=${playerRef}&includeArchived=true`)).meta.total).toBe(1);
      await request(http).post(`/api/v1/players/${playerId}/terms`).set(auth()).send({ termId: term2 }).expect(400);
      const r = (await request(http).post(`/api/v1/players/${playerId}/restore`).set(auth()).send({}).expect(201)).body;
      expect(r.team).toBe('U14 Development');
    });

    it('permanent delete is refused with history, allowed for a mistaken record', async () => {
      const refused = await request(http).post(`/api/v1/players/${playerId}/delete-permanently`).set(auth())
        .send({ reason: 'should be refused' }).expect(400);
      expect(JSON.stringify(refused.body)).toMatch(/invoices/);
      const oops = (await request(http).post('/api/v1/players').set(auth()).send({
        guardianId, firstName: 'Typo', lastName: `Desk${uniq}`, dateOfBirth: '2017-07-07', gender: 'FEMALE',
      }).expect(201)).body;
      await request(http).post(`/api/v1/players/${oops.id}/delete-permanently`).set(auth())
        .send({ reason: 'Duplicate entry' }).expect(201);
      await request(http).get(`/api/v1/players/${oops.id}/profile`).set(auth()).expect(404);
    });

    it('assigning a coach applies to the whole team', async () => {
      const coaches = (await request(http).get('/api/v1/coaches').set(auth())).body;
      const c = coaches.find((x: any) => x.user?.fullName === 'Guille');
      const r = (await request(http).patch(`/api/v1/teams/${team('U14 Development').id}/coach`).set(auth())
        .send({ coachId: c.id }).expect(200)).body;
      expect(r.affectedPlayers).toBeGreaterThanOrEqual(1);
      const d = (await request(http).get(`/api/v1/players/${playerId}/profile`).set(auth())).body;
      expect(d.team.coach.name).toBe('Guille');
    });
  });
});
