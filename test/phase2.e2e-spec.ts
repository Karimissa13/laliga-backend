import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';

/**
 * Phase 2 e2e — Registration & Trials, Teams & Coaches.
 * Requires a seeded DB (npm run db:seed) reachable via DATABASE_URL.
 */
describe('LaLiga Backend (e2e) — Phase 2', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  let seasonId: string;
  let termId: string;
  let ageGroupId: string;
  let teamId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    const res = await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' });
    token = res.body.accessToken;
  });
  afterAll(async () => { await app.close(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('reads seeded season, term and age group', async () => {
    seasonId = (await request(http).get('/api/v1/seasons').set(auth())).body[0].id;
    termId = (await request(http).get('/api/v1/terms').set(auth())).body[0].id;
    ageGroupId = (await request(http).get('/api/v1/age-groups').set(auth())).body.find((a: any) => a.code === 'U12').id;
    expect(seasonId).toBeDefined();
    expect(termId).toBeDefined();
  });

  it('creates a team with capacity 2', async () => {
    const res = await request(http).post('/api/v1/teams').set(auth())
      .send({ name: `E2E Team ${uniq}`, seasonId, ageGroupId, capacity: 2 }).expect(201);
    teamId = res.body.id;
    expect(res.body.capacity).toBe(2);
  });

  it('registers a player end-to-end and enrols into the team', async () => {
    const res = await request(http).post('/api/v1/register').set(auth())
      .send({
        guardianName: 'E2E Fam', guardianEmail: `fam${uniq}@example.com`, guardianMobile: '+971500000001',
        firstName: 'Reg', lastName: 'One', gender: 'MALE', dateOfBirth: '2015-06-01',
        termId, teamId,
      }).expect(201);
    expect(res.body.guardian.reference).toMatch(/^PR-/);
    expect(res.body.player.reference).toMatch(/^PL-/);
    expect(res.body.waitlisted).toBe(false);
    expect(res.body.player.ageGroup).toBe('U12');
  });

  it('fills capacity then waitlists the next registration', async () => {
    await request(http).post('/api/v1/register').set(auth())
      .send({ guardianName: 'Fam2', guardianEmail: `fam2${uniq}@example.com`, guardianMobile: '+971500000002',
        firstName: 'Reg', lastName: 'Two', gender: 'FEMALE', dateOfBirth: '2015-07-01', termId, teamId }).expect(201);
    const roster = await request(http).get(`/api/v1/teams/${teamId}/roster`).set(auth()).expect(200);
    expect(roster.body.isFull).toBe(true);

    const third = await request(http).post('/api/v1/register').set(auth())
      .send({ guardianName: 'Fam3', guardianEmail: `fam3${uniq}@example.com`, guardianMobile: '+971500000003',
        firstName: 'Reg', lastName: 'Three', gender: 'MALE', dateOfBirth: '2015-08-01', termId, teamId }).expect(201);
    expect(third.body.waitlisted).toBe(true);
    expect(third.body.player.status).toBe('WAITLISTED');
  });

  it('runs a lead through the pipeline and converts it', async () => {
    const lead = await request(http).post('/api/v1/leads').set(auth())
      .send({ guardianName: 'Lead Fam', guardianEmail: `leadfam${uniq}@example.com`,
        guardianMobile: '+971500000004', playerName: 'Lead Kid', source: 'POPUP' }).expect(201);
    expect(lead.body.reference).toMatch(/^TR-/);
    const id = lead.body.id;

    await request(http).patch(`/api/v1/leads/${id}/status`).set(auth())
      .send({ status: 'TRIAL_BOOKED', trialDate: '2026-08-26' }).expect(200);

    const conv = await request(http).post(`/api/v1/leads/${id}/convert`).set(auth())
      .send({ gender: 'MALE', dateOfBirth: '2014-10-10' }).expect(201);
    expect(conv.body.player.reference).toMatch(/^PL-/);
    expect(conv.body.lead.status).toBe('REGISTERED');

    // Cannot convert twice.
    await request(http).post(`/api/v1/leads/${id}/convert`).set(auth())
      .send({ gender: 'MALE', dateOfBirth: '2014-10-10' }).expect(400);
  });

  it('transfers a player and preserves enrolment history', async () => {
    const team2 = await request(http).post('/api/v1/teams').set(auth())
      .send({ name: `E2E Team2 ${uniq}`, seasonId, ageGroupId, capacity: 10 }).expect(201);
    // find the first registered player via its guardian's unique mobile
    const player = (await request(http).get('/api/v1/players?search=%2B971500000001').set(auth())).body.data[0];

    await request(http).post('/api/v1/teams/transfer').set(auth())
      .send({ playerId: player.id, toTeamId: team2.body.id, seasonId, termId }).expect(201);

    const history = await request(http).get(`/api/v1/players/${player.id}/enrolments`).set(auth()).expect(200);
    const statuses = history.body.map((e: any) => e.status);
    expect(statuses).toContain('ACTIVE');
    expect(statuses).toContain('TRANSFERRED'); // prior enrolment kept, not destroyed
  });

  it('enforces team capacity via direct enrol (self-contained)', async () => {
    // A fresh capacity-1 team: first enrol is ACTIVE, second waitlists.
    const t = await request(http).post('/api/v1/teams').set(auth())
      .send({ name: `E2E Cap1 ${uniq}`, seasonId, ageGroupId, capacity: 1 }).expect(201);
    const mk = async (n: number) => (await request(http).post('/api/v1/register').set(auth())
      .send({ guardianName: `Cap Fam ${n}`, guardianEmail: `capfam${n}${uniq}@example.com`,
        guardianMobile: `+9715000001${n}`, firstName: 'Cap', lastName: `P${n}`, gender: 'MALE',
        dateOfBirth: '2015-05-01' })).body.player.id;

    const first = await request(http).post('/api/v1/enrolments').set(auth())
      .send({ playerId: await mk(1), termId, teamId: t.body.id }).expect(201);
    expect(first.body.waitlisted).toBe(false);

    const second = await request(http).post('/api/v1/enrolments').set(auth())
      .send({ playerId: await mk(2), termId, teamId: t.body.id }).expect(201);
    expect(second.body.waitlisted).toBe(true);
  });
});
