import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';

/**
 * Squad moves (Karim, 12 Oct 2026): a child moved to another team during the season.
 * Needs a fresh, seeded database (the seed's U12 teams and the 2026/27 price list).
 */
describe('Squad moves (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  let teams: any[];
  const uniq = Date.now();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const dubai = (offsetDays: number) => new Date(Date.now() + 4 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
  const team = (name: string) => { const t = teams.find((x) => x.name === name); if (!t) throw new Error(`no team ${name}`); return t; };

  let n = 0;
  async function family(pkg: string, teamName: string, extra: Record<string, unknown> = {}) {
    n++;
    const g = (await request(http).post('/api/v1/guardians').set(auth()).send({
      fullName: `Move Family ${uniq}-${n}`, email: `move${uniq}${n}@example.com`, mobile: `+97158${String(uniq + n).slice(-7)}`,
    }).expect(201)).body;
    const p = (await request(http).post('/api/v1/players').set(auth()).send({
      guardianId: g.id, firstName: `Mover${n}`, lastName: `Test${uniq}`, dateOfBirth: '2015-03-03', gender: 'MALE',
    }).expect(201)).body;
    const reg = (await request(http).post(`/api/v1/players/${p.id}/terms`).set(auth())
      .send({ package: pkg, teamId: team(teamName).id, ...extra }).expect(201)).body;
    return { guardian: g, player: p, invoice: reg.invoice };
  }

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(m.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login').send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    teams = (await request(http).get('/api/v1/team-board').set(auth())).body;
  }, 60000);
  afterAll(async () => { await app.close(); });

  it('Development 2×/week → HPC 3×/week: a separate, linked move-up invoice; the term invoice is unchanged', async () => {
    const f = await family('FULL', 'U12 Development', {
      instalments: [{ percent: 34, dueDate: dubai(5) }, { percent: 33, dueDate: dubai(60) }, { percent: 33, dueDate: dubai(120) }],
    });
    await request(http).post(`/api/v1/invoices/${f.invoice.id}/payments`).set(auth()).send({ amount: 1000, method: 'CARD' }).expect(201);
    const before = (await request(http).get(`/api/v1/invoices/${f.invoice.id}`).set(auth()).expect(200)).body;
    const moveDate = dubai(1);
    const hpc = team('U12 HPC');

    const q = (await request(http).get(`/api/v1/players/${f.player.id}/move/quote?toTeamId=${hpc.id}&moveDate=${moveDate}`).set(auth()).expect(200)).body;
    expect(q.direction).toBe('UP');
    expect(q.groups).toHaveLength(1);
    expect(q.groups[0]).toMatchObject({ fromSessions: 2, toSessions: 3, invoiceNumber: before.number, package: 'FULL' });
    expect(q.toPay).toBeGreaterThan(0);
    // Two calendars: new price × the HPC sessions left, less old price × the Development sessions not yet trained.
    const g = q.groups[0];
    expect([g.oldPrice, g.newPrice]).toEqual([9350, 14027]);
    expect(g.sessionsTotal).toBeGreaterThan(g.oldSessionsTotal);              // 3×/week vs 2×/week calendars
    expect(g.charge.newPart).toBeCloseTo(14027 * g.sessionsLeft / g.sessionsTotal, 2);
    expect(g.charge.oldPart).toBeCloseTo(9350 * g.oldSessionsLeft / g.oldSessionsTotal, 2);
    expect(q.toPay).toBeCloseTo(g.charge.newPart - g.charge.oldPart, 2);
    expect(q.groups[0].remainingDueDates.length).toBeGreaterThanOrEqual(2);

    const r = (await request(http).post(`/api/v1/players/${f.player.id}/move`).set(auth())
      .send({ toTeamId: hpc.id, moveDate, reason: 'Moved up after assessment (test)' }).expect(201)).body;
    expect(r.invoices).toHaveLength(1);
    const up = r.invoices[0];
    expect(up).toMatchObject({ purpose: 'MOVE_UP', relatedInvoiceId: f.invoice.id, type: 'ADDITIONAL', status: 'ISSUED' });
    expect(Math.abs(Number(up.total) - q.toPay)).toBeLessThan(0.02);
    expect(up.lineItems[0].description).toMatch(/Squad move-up: U12 Development \(2×\/week\) → U12 HPC \(3×\/week\)/);

    // Split over the term invoice's remaining instalment dates.
    const plan = (await request(http).get(`/api/v1/invoices/${up.id}/instalments`).set(auth()).expect(200)).body;
    expect(plan.hasPlan).toBe(true);
    expect(plan.instalments.map((x: any) => x.dueDate)).toEqual(q.groups[0].remainingDueDates.slice(0, 5));

    // The term invoice is exactly as issued, and can no longer be re-priced.
    const after = (await request(http).get(`/api/v1/invoices/${f.invoice.id}`).set(auth()).expect(200)).body;
    expect([after.total, after.subtotal, after.vatTotal, after.lineItems.length]).toEqual([before.total, before.subtotal, before.vatTotal, before.lineItems.length]);
    const training = (await request(http).get(`/api/v1/invoices/${f.invoice.id}/training`).set(auth()).expect(200)).body;
    expect(JSON.stringify(training)).toMatch(/U12 Development/);
    expect(JSON.stringify(training)).not.toMatch(/U12 HPC/);
    await request(http).post(`/api/v1/invoices/${f.invoice.id}/adjust`).set(auth()).send({ children: [{ playerId: f.player.id, startDate: null }] }).expect(400);

    // Both PDFs render.
    for (const id of [f.invoice.id, up.id]) {
      const pdf = await request(http).get(`/api/v1/invoices/${id}/pdf`).set(auth()).expect(200);
      expect(pdf.headers['content-type']).toMatch(/pdf/);
    }

    // History kept: three old enrolments TRANSFERRED, three new in the new team; current team updated.
    const prof = (await request(http).get(`/api/v1/players/${f.player.id}/profile`).set(auth()).expect(200)).body;
    expect(JSON.stringify(prof)).toMatch(/U12 HPC/);
    const hist = prof.history as Array<{ status: string; team: string | null }>;
    expect(hist.filter((e) => e.status === 'TRANSFERRED' && e.team === 'U12 Development')).toHaveLength(3);
    expect(hist.filter((e) => e.status === 'ACTIVE' && e.team === 'U12 HPC')).toHaveLength(3);
    expect(prof.purchases[0].team).toBe('U12 HPC');   // the purchase shows the child now, once per term
    expect(prof.purchases[0].terms).toHaveLength(3);
  });

  it('U12 Advanced White trains 3×/week; staff may charge 1, 2 or 3 — at 2×/week there is no invoice', async () => {
    const f = await family('FULL', 'U12 Development');
    const adv = team('U12 Advanced White');
    const q3 = (await request(http).get(`/api/v1/players/${f.player.id}/move/quote?toTeamId=${adv.id}&moveDate=${dubai(1)}`).set(auth()).expect(200)).body;
    expect(q3.toTeam).toMatchObject({ sessionsPerWeek: 3, teamSessionsPerWeek: 3 });   // Tue, Wed & Thu
    expect(q3.tiers).toEqual([1, 2, 3]);
    expect(q3.direction).toBe('UP');
    const q = (await request(http).get(`/api/v1/players/${f.player.id}/move/quote?toTeamId=${adv.id}&moveDate=${dubai(1)}&sessionsPerWeek=2`).set(auth()).expect(200)).body;
    expect(q.direction).toBe('SAME');
    expect(q.toPay).toBe(0);
    expect(q.warnings.join(' ')).toMatch(/trains 3×\/week/);
    const r = (await request(http).post(`/api/v1/players/${f.player.id}/move`).set(auth()).send({ toTeamId: adv.id, moveDate: dubai(1), sessionsPerWeek: 2 }).expect(201)).body;
    expect(r.invoices).toHaveLength(0);
    expect(r.moved).toBe(3);
  });

  it('HPC 3×/week → Development 2×/week, credited: a tax credit note on the term invoice', async () => {
    const f = await family('FULL', 'U12 HPC');
    const dev = team('U12 Development');
    const q = (await request(http).get(`/api/v1/players/${f.player.id}/move/quote?toTeamId=${dev.id}&moveDate=${dubai(1)}`).set(auth()).expect(200)).body;
    expect(q.direction).toBe('DOWN');
    expect(q.toCredit).toBeGreaterThan(0);
    const r = (await request(http).post(`/api/v1/players/${f.player.id}/move`).set(auth())
      .send({ toTeamId: dev.id, moveDate: dubai(1), credit: true }).expect(201)).body;
    expect(r.credits[0].writtenOff + r.credits[0].toWallet).toBeCloseTo(q.toCredit, 1);
    const notes = (await request(http).get(`/api/v1/invoices/${f.invoice.id}/credit-notes`).set(auth()).expect(200)).body;
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a move within the child’s own age category', async () => {
    const f = await family('FULL', 'U12 Development');
    const r = await request(http).get(`/api/v1/players/${f.player.id}/move/quote?toTeamId=${team('U13 HPC').id}&moveDate=${dubai(1)}`).set(auth()).expect(400);
    expect(r.body.message).toMatch(/isn't a U12 team/);
    await request(http).post(`/api/v1/players/${f.player.id}/move`).set(auth())
      .send({ toTeamId: team('U13 Advanced White').id, moveDate: dubai(1) }).expect(400);
  });

  it('refuses a move to the team the child is already in', async () => {
    const f = await family('FULL', 'U12 Development');
    await request(http).post(`/api/v1/players/${f.player.id}/move`).set(auth())
      .send({ toTeamId: team('U12 Development').id, moveDate: dubai(1) }).expect(400);
  });
});
