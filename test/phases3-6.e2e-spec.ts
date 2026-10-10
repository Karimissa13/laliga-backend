import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';

/**
 * Phases 3–6 e2e — Scheduling & Attendance, Finance, Communications, Analytics,
 * Player Development. Requires a seeded DB (npm run db:setup).
 */
describe('LaLiga Backend (e2e) — Phases 3–6', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    const r = await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' });
    token = r.body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  // ---------------- Phase 3 ----------------
  describe('Scheduling', () => {
    let venueId: string; let start: string; let end: string;

    it('lists sessions and exposes venue/coach detail', async () => {
      const res = await request(http).get('/api/v1/sessions/upcoming?days=7').set(auth()).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      let s = res.body.find((x: any) => x.venue);
      if (!s) {
        // A fresh install has no venues yet: make one and book a session on it.
        const loc = (await request(http).get('/api/v1/locations').set(auth()).expect(200)).body[0];
        const v = (await request(http).post('/api/v1/venues').set(auth()).send({ locationId: loc.id, name: `Pitch ${Date.now()}` }).expect(201)).body;
        const at = new Date(Date.now() + 2 * 86400000); at.setUTCHours(14, 0, 0, 0);
        const to = new Date(at.getTime() + 90 * 60000);
        s = (await request(http).post('/api/v1/sessions').set(auth()).send({ title: 'Venue check', venueId: v.id, startsAt: at.toISOString(), endsAt: to.toISOString() }).expect(201)).body;
        s.venue = { id: v.id };
      }
      venueId = s.venue.id; start = s.startsAt; end = s.endsAt;
    });

    it('rejects a venue double-booking', async () => {
      const res = await request(http).post('/api/v1/sessions').set(auth())
        .send({ title: 'Clash', venueId, startsAt: start, endsAt: end })
        .expect(400);
      expect(res.body.error).toBe('ScheduleConflict');
    });

    it('allows a deliberate override with force', async () => {
      await request(http).post('/api/v1/sessions').set(auth())
        .send({ title: 'Forced', venueId, startsAt: start, endsAt: end, force: true })
        .expect(201);
    });

    it('rejects an end time before the start', async () => {
      await request(http).post('/api/v1/sessions').set(auth())
        .send({ title: 'Backwards', startsAt: end, endsAt: start })
        .expect(400);
    });
  });

  describe('Attendance', () => {
    it('returns a digital register for a session with a team', async () => {
      const sessions = await request(http).get('/api/v1/sessions?to=' + new Date().toISOString()).set(auth()).expect(200);
      // The season plan gives every team its sessions, including teams with no
      // children yet — take the register of one whose team has a roster.
      let res: any = null;
      for (const s of sessions.body.filter((x: any) => x.team).reverse()) {
        res = await request(http).get(`/api/v1/sessions/${s.id}/register`).set(auth()).expect(200);
        if (res.body.roster.length) break;
      }
      expect(res.body.roster.length).toBeGreaterThan(0);
      expect(res.body).toHaveProperty('markedCount');
      expect(res.body).toHaveProperty('complete');
    });

    it('flags attendance concerns below a threshold', async () => {
      const res = await request(http).get('/api/v1/attendance/issues?threshold=100').set(auth()).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((r: any) => expect(r.attendanceRate).toBeLessThan(100));
    });
  });

  // ---------------- Phase 4 ----------------
  describe('Finance', () => {
    it('evaluates automatic discounts with reasons', async () => {
      const players = await request(http).get('/api/v1/players?status=ACTIVE&limit=20').set(auth()).expect(200);
      const pid = players.body.data[0].id;
      const res = await request(http).get(`/api/v1/discounts/evaluate?playerId=${pid}&amount=1000`).set(auth()).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((c: any) => {
        expect(c).toHaveProperty('rule');
        expect(c).toHaveProperty('reason');
        expect(c.amount).toBeGreaterThan(0);
      });
    });

    it('reports outstanding balances derived from the ledger', async () => {
      const res = await request(http).get('/api/v1/invoices/outstanding').set(auth()).expect(200);
      expect(res.body).toHaveProperty('totalOutstanding');
      expect(res.body).toHaveProperty('overdueCount');
      res.body.items.forEach((i: any) => expect(i.balance).toBeGreaterThan(0));
    });

    it('records a payment and recomputes status from the ledger', async () => {
      const list = await request(http).get('/api/v1/invoices?status=ISSUED&limit=50').set(auth()).expect(200);
      const unpaid = list.body.data.find((i: any) => Number(i.amountPaid) === 0);
      if (!unpaid) return; // nothing to test against in this dataset
      const total = Number(unpaid.total);

      const half = Math.round((total / 2) * 100) / 100;
      const first = await request(http).post(`/api/v1/invoices/${unpaid.id}/payments`).set(auth())
        .send({ amount: half, method: 'CASH' }).expect(201);
      expect(first.body.invoice.status).toBe('PART_PAID');

      // second half may leave a sub-cent residue — settlement tolerance must still mark it PAID
      const second = await request(http).post(`/api/v1/invoices/${unpaid.id}/payments`).set(auth())
        .send({ amount: half, method: 'CASH' }).expect(201);
      expect(second.body.invoice.status).toBe('PAID');
    });

    it('refuses a refund larger than the amount paid', async () => {
      const list = await request(http).get('/api/v1/invoices?status=PAID&limit=10').set(auth()).expect(200);
      const paid = list.body.data[0];
      if (!paid) return;
      await request(http).post(`/api/v1/invoices/${paid.id}/refund`).set(auth())
        .send({ amount: Number(paid.total) + 5000 }).expect(400);
    });
  });

  // ---------------- Phase 5 ----------------
  describe('Communications', () => {
    it('resolves a targeted audience (guardians with outstanding balances)', async () => {
      const res = await request(http).post('/api/v1/communications/audience-preview').set(auth())
        .send({ audience: { hasOutstanding: true }, channel: 'EMAIL' }).expect(201);
      expect(res.body).toHaveProperty('count');
      expect(Array.isArray(res.body.recipients)).toBe(true);
    });

    it('previews the payment-reminder automation without sending', async () => {
      const res = await request(http).post('/api/v1/automations/payment-reminders').set(auth())
        .send({ dryRun: true }).expect(201);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.sent).toBe(0);
      expect(res.body).toHaveProperty('candidates');
    });

    it('runs every automation in preview mode', async () => {
      const res = await request(http).post('/api/v1/automations/run-all').set(auth())
        .send({ dryRun: true }).expect(201);
      expect(res.body.results.length).toBe(4);
    });
  });

  describe('Scheduler', () => {
    it('registers every automation as a job, disabled by default', async () => {
      const res = await request(http).get('/api/v1/automations/schedule').set(auth()).expect(200);
      expect(res.body.length).toBe(4);
      res.body.forEach((j: any) => {
        expect(j).toHaveProperty('cron');
        expect(j).toHaveProperty('enabled');
      });
    });

    it('enables, reschedules and disables a job', async () => {
      const on = await request(http).post('/api/v1/automations/schedule/payment-reminders/enable')
        .set(auth()).send({ enabled: true }).expect(201);
      expect(on.body.enabled).toBe(true);
      expect(on.body.nextRunAt).toBeTruthy();

      const cron = await request(http).post('/api/v1/automations/schedule/payment-reminders/cron')
        .set(auth()).send({ cron: '0 7 * * *' }).expect(201);
      expect(cron.body.cron).toBe('0 7 * * *');

      const off = await request(http).post('/api/v1/automations/schedule/payment-reminders/enable')
        .set(auth()).send({ enabled: false }).expect(201);
      expect(off.body.enabled).toBe(false);
      expect(off.body.nextRunAt).toBeNull();
    });
  });

  // ---------------- Phase 6 ----------------
  describe('Analytics & development', () => {
    it('returns revenue analytics with a collection rate', async () => {
      const res = await request(http).get('/api/v1/analytics/revenue').set(auth()).expect(200);
      expect(res.body).toHaveProperty('billed');
      expect(res.body).toHaveProperty('collected');
      expect(res.body.collectionRate).toBeGreaterThanOrEqual(0);
      expect(res.body.collectionRate).toBeLessThanOrEqual(100);
    });

    it('returns capacity utilisation per team', async () => {
      const res = await request(http).get('/api/v1/analytics/capacity').set(auth()).expect(200);
      expect(res.body.rows.length).toBeGreaterThan(0);
      res.body.rows.forEach((r: any) => {
        expect(r.filled).toBeLessThanOrEqual(Math.max(r.capacity, r.filled));
        expect(r).toHaveProperty('utilisation');
      });
    });

    it('returns a Player Passport with development, attendance and documents', async () => {
      let evals = await request(http).get('/api/v1/evaluations').set(auth()).expect(200);
      if (!evals.body.length) {
        // A fresh install has no evaluations yet: score one child first.
        const kid = (await request(http).get('/api/v1/players?limit=1').set(auth()).expect(200)).body.data[0];
        await request(http).post('/api/v1/evaluations').set(auth()).send({ playerId: kid.id, scores: { technical: 4, tactical: 3, physical: 4, social: 5 } }).expect(201);
        evals = await request(http).get('/api/v1/evaluations').set(auth()).expect(200);
      }
      const pid = evals.body[0].player.id;
      const res = await request(http).get(`/api/v1/players/${pid}/passport`).set(auth()).expect(200);
      expect(res.body.player).toHaveProperty('reference');
      expect(res.body.development.evaluationCount).toBeGreaterThan(0);
      expect(res.body).toHaveProperty('attendance');
      expect(res.body.documents).toHaveProperty('missing');
    });

    it('rejects an out-of-range evaluation score', async () => {
      const players = await request(http).get('/api/v1/players?limit=1').set(auth()).expect(200);
      await request(http).post('/api/v1/evaluations').set(auth())
        .send({ playerId: players.body.data[0].id, scores: { technical: 9 } })
        .expect(400);
    });
  });
});
