import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MailerService, MailMessage } from '../src/modules/notifications/mailer.service';

/**
 * Siblings registered together on one family invoice (sibling discount across
 * them), and the term reports: Development (1–5) and Advanced (0–5 by position).
 */
describe('Family registration and term reports (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  const sent: MailMessage[] = [];
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const mailer = {
    live: true,
    status: () => ({ connected: true, host: 'test', from: 'test@example.com' }),
    send: async (m: MailMessage) => { sent.push(m); return { ok: true, simulated: false, messageId: `t-${sent.length}` }; } };
  let teams: any[];
  let g: any, big: any, small: any;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailerService).useValue(mailer).compile();
    app = configureApp(m.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login').send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    teams = (await request(http).get('/api/v1/team-board').set(auth())).body;
  }, 60000);
  afterAll(async () => { await app.close(); });

  describe('siblings on one registration', () => {
    const u12 = () => teams.find((t) => t.name === 'U12 Development');
    const u8 = () => teams.find((t) => t.name === 'U8 Development 1');

    it('prices the family together: the younger child gets the 2nd-child discount', async () => {
      const q = (await request(http).post('/api/v1/registration/family-quote').set(auth()).send({ children: [
        { key: 'a', dob: '2015-03-01', firstName: 'Big', lastName: `Fam${uniq}`, package: 'FULL', sessionsPerWeek: 2, teamId: u12().id },
        { key: 'b', dob: '2019-03-01', firstName: 'Small', lastName: `Fam${uniq}`, package: 'FULL', sessionsPerWeek: 2, teamId: u8().id },
      ] }).expect(200)).body;
      expect(q.ok).toBe(true);
      const [a, b] = q.children;
      expect(a).toMatchObject({ key: 'a', position: '1st', siblingPercent: 0, siblingDiscount: null });
      expect(b).toMatchObject({ key: 'b', position: '2nd', siblingPercent: 15 });
      expect(b.siblingDiscount.amount).toBeGreaterThan(0);
      expect(q.total).toBeCloseTo(a.grandTotal + b.grandTotal, 2);
      expect(q.siblingSavings).toBeCloseTo(b.siblingDiscount.amount, 2);
    });

    it('registers both children and raises ONE invoice with a line each and the sibling discount, with one welcome email', async () => {
      g = (await request(http).post('/api/v1/guardians').set(auth()).send({
        fullName: `Family ${uniq}`, email: `family${uniq}@example.com`, mobile: `+97153${String(uniq).slice(-7)}`,
      }).expect(201)).body;
      const before = sent.length;
      big = (await request(http).post('/api/v1/players').set(auth()).send({ guardianId: g.id, firstName: 'Big', lastName: `Fam${uniq}`, gender: 'MALE', dateOfBirth: '2015-03-01', sendWelcome: false }).expect(201)).body;
      small = (await request(http).post('/api/v1/players').set(auth()).send({ guardianId: g.id, firstName: 'Small', lastName: `Fam${uniq}`, gender: 'MALE', dateOfBirth: '2019-03-01' }).expect(201)).body;
      const welcomes = sent.slice(before).filter((x) => x.to === g.email && /Welcome/.test(x.subject));
      expect(welcomes).toHaveLength(1);
      expect(welcomes[0].text).toContain(`Big and Small Fam${uniq} are now registered`);
      const r = (await request(http).post(`/api/v1/guardians/${g.id}/terms`).set(auth()).send({ items: [
        { playerId: big.id, package: 'FULL', sessionsPerWeek: 2, teamId: u12().id },
        { playerId: small.id, package: 'FULL', sessionsPerWeek: 2, teamId: u8().id },
      ] }).expect(201)).body;
      expect(r.invoice.lineItems).toHaveLength(2);
      expect(r.invoice.lineItems.map((l: any) => l.playerId).sort()).toEqual([big.id, small.id].sort());
      expect(r.appliedDiscounts).toHaveLength(1);
      expect(r.appliedDiscounts[0]).toMatch(/^Small: Sibling discount/);
      const invs = (await request(http).get(`/api/v1/invoice-register?parentNo=${g.reference.replace('PR-', '')}`).set(auth())).body.data;
      expect(invs).toHaveLength(1);
      const p = (await request(http).get(`/api/v1/players/${small.id}/profile`).set(auth())).body;
      expect(p.currentTerm.name).toBe('Full season');
    });

    it('refuses a child of another family, a duplicate child and a missing term option', async () => {
      const other = (await request(http).get('/api/v1/players?limit=5').set(auth())).body.data.find((x: any) => x.guardianReference !== g.reference);
      await request(http).post(`/api/v1/guardians/${g.id}/terms`).set(auth()).send({ items: [{ playerId: other.id, package: 'T2', sessionsPerWeek: 1 }] }).expect(400);
      await request(http).post(`/api/v1/guardians/${g.id}/terms`).set(auth()).send({ items: [{ playerId: big.id, package: 'T2' }, { playerId: big.id, package: 'T3' }] }).expect(400);
      await request(http).post(`/api/v1/guardians/${g.id}/terms`).set(auth()).send({ items: [{ playerId: big.id, sessionsPerWeek: 1 }] }).expect(400);
      // Already enrolled for the full season: nothing half-happens.
      await request(http).post(`/api/v1/guardians/${g.id}/terms`).set(auth()).send({ items: [{ playerId: big.id, package: 'T2', sessionsPerWeek: 2 }] }).expect(400);
    });
  });

  describe('term reports', () => {
    let devId: string, advId: string, termId: string;

    it('lists every child enrolled in the term with the report their squad needs', async () => {
      const b = (await request(http).get(`/api/v1/development/board?search=${encodeURIComponent('Fam' + uniq)}`).set(auth()).expect(200)).body;
      termId = b.term.id;
      expect(b.term.name).toBe('Term 1');
      expect(b.rows.map((r: any) => r.name).sort()).toEqual([`Big Fam${uniq}`, `Small Fam${uniq}`]);
      expect(b.rows.every((r: any) => r.reportType === 'DEVELOPMENT' && r.state === 'TODO')).toBe(true);
    });

    it('a Development report: 1–5 items, two positions, observations; locked when final', async () => {
      const t = (await request(http).get('/api/v1/development/templates').set(auth()).expect(200)).body;
      expect(t.DEVELOPMENT.areas.map((a: any) => a.key)).toEqual(['technical', 'tactical', 'physical', 'cognitive', 'attitude']);
      const r = (await request(http).post('/api/v1/development/reports').set(auth()).send({ playerId: big.id }).expect(201)).body;
      devId = r.id;
      expect(r).toMatchObject({ reportType: 'DEVELOPMENT', status: 'DRAFT', termId });
      const again = (await request(http).post('/api/v1/development/reports').set(auth()).send({ playerId: big.id }).expect(201)).body;
      expect(again.id).toBe(devId);
      await request(http).patch(`/api/v1/development/reports/${devId}`).set(auth()).send({ scores: { 'technical.ball_skills': 0 } }).expect(400);
      await request(http).patch(`/api/v1/development/reports/${devId}`).set(auth()).send({ scores: { 'conditional.agility': 3 } }).expect(400);
      await request(http).patch(`/api/v1/development/reports/${devId}`).set(auth()).send({ positions: ['CM1', 'RW', 'ST'] }).expect(400);
      const first = (await request(http).post(`/api/v1/development/reports/${devId}/final`).set(auth()).expect(400)).body;
      expect(first.message).toMatch(/Score every item/);
      const scores: Record<string, number> = {};
      r.areas.forEach((a: any) => a.items.forEach((i: any, n: number) => { scores[`${a.key}.${i.key}`] = (n % 3) + 3; }));
      const saved = (await request(http).patch(`/api/v1/development/reports/${devId}`).set(auth()).send({ scores, positions: ['CM1', 'RW'], notes: 'Works hard in every session.' }).expect(200)).body;
      expect(saved.averages.overall).toBeGreaterThanOrEqual(3);
      expect(saved.averages.areas.technical).toBeCloseTo(3.9, 1);
      const fin = (await request(http).post(`/api/v1/development/reports/${devId}/final`).set(auth()).expect(201)).body;
      expect(fin.status).toBe('FINAL');
      await request(http).patch(`/api/v1/development/reports/${devId}`).set(auth()).send({ notes: 'changed' }).expect(400);
      await request(http).delete(`/api/v1/development/reports/${devId}`).set(auth()).expect(400);
      const pdf = await request(http).get(`/api/v1/development/reports/${devId}/pdf`).set(auth()).expect(200);
      expect(pdf.headers['content-type']).toMatch(/pdf/);
      expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    });

    it('an Advanced report has different items by position, a comment per area, and a photo and number', async () => {
      const r = (await request(http).post('/api/v1/development/reports').set(auth()).send({ playerId: small.id, reportType: 'ADVANCED', position: 'DEFENDER' }).expect(201)).body;
      advId = r.id;
      expect(r.scale).toMatchObject({ min: 0, max: 5 });
      expect(r.areas.map((a: any) => a.key)).toEqual(['technical_tactical', 'conditional', 'psychological']);
      expect(r.areas[0].items.map((i: any) => i.label)).toContain('Defence of the box');
      const fw = (await request(http).patch(`/api/v1/development/reports/${advId}`).set(auth()).send({ position: 'FORWARD', scores: { 'technical_tactical.shooting': 0 } }).expect(200)).body;
      expect(fw.areas[0].items.map((i: any) => i.label)).toContain('Finishing (1 touch)');
      expect(fw.scores['technical_tactical.shooting']).toBe(0);
      const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      await request(http).patch(`/api/v1/development/reports/${advId}`).set(auth()).send({ photo: 'not-an-image' }).expect(400);
      const scores: Record<string, number> = {};
      fw.areas.forEach((a: any) => a.items.forEach((i: any, n: number) => { scores[`${a.key}.${i.key}`] = n % 6; }));
      await request(http).patch(`/api/v1/development/reports/${advId}`).set(auth()).send({ scores, shirtNumber: 9, photo: tiny, notes: 'Adapted well to 9-a-side.' }).expect(200);
      const missing = (await request(http).post(`/api/v1/development/reports/${advId}/final`).set(auth()).expect(400)).body;
      expect(missing.message).toMatch(/comment/);
      await request(http).patch(`/api/v1/development/reports/${advId}`).set(auth()).send({ comments: { technical_tactical: 'Good movement.', conditional: 'Fast and strong.', psychological: 'Great attitude.' } }).expect(200);
      const fin = (await request(http).post(`/api/v1/development/reports/${advId}/final`).set(auth()).expect(201)).body;
      expect(fin).toMatchObject({ status: 'FINAL', shirtNumber: 9, position: 'FORWARD' });
      const pdf = await request(http).get(`/api/v1/development/reports/${advId}/pdf`).set(auth()).expect(200);
      expect(pdf.body.length).toBeGreaterThan(2000);
    });

    it('sends the final report to the parent with the PDF, and the parent can download it', async () => {
      const r = (await request(http).post(`/api/v1/development/reports/${devId}/send`).set(auth()).expect(201)).body;
      expect(r.sent).toBe(true);
      const m = sent[sent.length - 1];
      expect(m.to).toBe(g.email);
      expect(m.subject).toMatch(/Term 1 Development report/);
      expect(m.attachments![0].filename).toMatch(/Development-report\.pdf$/);
      expect(r.report.sentAt).toBeTruthy();
      const list = (await request(http).get(`/api/v1/players/${big.id}/reports`).set(auth()).expect(200)).body;
      expect(list[0]).toMatchObject({ reportType: 'DEVELOPMENT', status: 'FINAL' });
      // parent sign-in
      const temp = sent.filter((x) => x.to === g.email && /sign-in details/.test(x.subject)).pop()!.text.match(/Temporary password: (\S+)/)![1];
      let pt = (await request(http).post('/api/v1/parent/auth/login').send({ email: g.email, password: temp }).expect(201)).body.accessToken;
      pt = (await request(http).post('/api/v1/parent/auth/change-password').set(auth(pt)).send({ currentPassword: temp, newPassword: 'Football2026' }).expect(201)).body.accessToken;
      const mine = (await request(http).get('/api/v1/parent/reports').set(auth(pt)).expect(200)).body;
      expect(mine.map((x: any) => x.id).sort()).toEqual([devId, advId].sort());
      await request(http).get(`/api/v1/parent/reports/${devId}/pdf`).set(auth(pt)).expect(200);
    });

    it('a coach writes reports but cannot send or reopen them', async () => {
      const coach = (await request(http).post('/api/v1/auth/login').send({ email: 'sergio@laligaacademy.local', password: 'Coach@12345' })).body.accessToken;
      await request(http).get('/api/v1/development/board').set(auth(coach)).expect(200);
      await request(http).post(`/api/v1/development/reports/${advId}/send`).set(auth(coach)).expect(403);
      await request(http).post(`/api/v1/development/reports/${advId}/reopen`).set(auth(coach)).expect(403);
      const re = (await request(http).post(`/api/v1/development/reports/${advId}/reopen`).set(auth()).expect(201)).body;
      expect(re.status).toBe('DRAFT');
      await request(http).patch(`/api/v1/development/reports/${advId}`).set(auth(coach)).send({ notes: 'Coach edit after reopening.' }).expect(200);
    });
  });
});
