import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';

/**
 * End-to-end tests for Phase 1. Requires a seeded database (npm run db:seed)
 * reachable via DATABASE_URL. Exercises auth, RBAC enforcement, and the People
 * registration workflow against the real HTTP + Postgres stack.
 */
describe('LaLiga Backend (e2e) — Phase 1', () => {
  let app: INestApplication;
  let http: any;
  let adminToken: string;
  let coachToken: string;
  const uniq = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => { await app.close(); });

  it('rejects unauthenticated access', async () => {
    await request(http).get('/api/v1/players').expect(401);
  });

  it('logs in the super admin', async () => {
    const res = await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    adminToken = res.body.accessToken;
    expect(res.body.user.role).toBe('super-admin');
  });

  it('rejects bad credentials', async () => {
    await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'wrongpassword' })
      .expect(401);
  });

  it('returns me with wildcard permissions', async () => {
    const res = await request(http).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.permissions).toContain('*');
  });

  it('returns dashboard KPIs', async () => {
    const res = await request(http).get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.kpis).toHaveProperty('totalPlayers');
    expect(res.body).toHaveProperty('pendingActions');
  });

  let guardianId: string;
  it('creates a guardian', async () => {
    const res = await request(http).post('/api/v1/guardians')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'E2E Parent', email: `e2e${uniq}@example.com`, mobile: '+971500000000' })
      .expect(201);
    expect(res.body.reference).toMatch(/^PR-\d{6}$/);
    guardianId = res.body.id;
  });

  let playerId: string;
  it('adds a player with auto-derived age group', async () => {
    const res = await request(http).post('/api/v1/players')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ guardianId, firstName: 'E2E', lastName: 'Player', gender: 'MALE', dateOfBirth: '2015-03-01' })
      .expect(201);
    expect(res.body.reference).toMatch(/^PL-\d{6}$/);
    expect(res.body.ageGroup?.code).toBe('U12');
    playerId = res.body.id;
  });

  it('validates input (rejects a bad DOB)', async () => {
    await request(http).post('/api/v1/players')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ guardianId, firstName: 'X', lastName: 'Y', gender: 'MALE', dateOfBirth: 'not-a-date' })
      .expect(400);
  });

  it('changes player status', async () => {
    const res = await request(http).patch(`/api/v1/players/${playerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' }).expect(200);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('creates a coach user and enforces RBAC', async () => {
    const roles = await request(http).get('/api/v1/roles')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    const coachRole = roles.body.find((r: any) => r.slug === 'coach');
    await request(http).post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'E2E Coach', email: `coach${uniq}@laliga.local`, password: 'Coach@12345', roleId: coachRole.id })
      .expect(201);

    const login = await request(http).post('/api/v1/auth/login')
      .send({ email: `coach${uniq}@laliga.local`, password: 'Coach@12345' }).expect(201);
    coachToken = login.body.accessToken;

    // Coach may view players...
    await request(http).get('/api/v1/players').set('Authorization', `Bearer ${coachToken}`).expect(200);
    // ...but not create guardians, list users, or read the audit log.
    await request(http).post('/api/v1/guardians').set('Authorization', `Bearer ${coachToken}`)
      .send({ fullName: 'x', email: `x${uniq}@y.com`, mobile: '1' }).expect(403);
    await request(http).get('/api/v1/users').set('Authorization', `Bearer ${coachToken}`).expect(403);
    await request(http).get('/api/v1/audit-logs').set('Authorization', `Bearer ${coachToken}`).expect(403);
  });

  it('records writes to the audit log', async () => {
    const res = await request(http).get('/api/v1/audit-logs?action=player.create')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
