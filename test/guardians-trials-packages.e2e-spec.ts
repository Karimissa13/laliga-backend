import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { MailerService, MailMessage } from '../src/modules/notifications/mailer.service';

/**
 * Oct 2026 round: the package bought shows everywhere, no default term option,
 * percentage discounts on the training fee only, the Guardians screen, the trials
 * sheet with coach evaluations, coaches' access, staff accounts and the teams list.
 */
describe('Packages, guardians, trials sheet, coach access (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  const sent: MailMessage[] = [];
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const mailer = {
    live: true,
    status: () => ({ connected: true, host: 'test', from: 'test@example.com' }),
    send: async (m: MailMessage) => { sent.push(m); return { ok: true, simulated: false, messageId: `t-${sent.length}` }; },
  };
  let teams: any[], products: any[];
  let g: any, child: any;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailerService).useValue(mailer).compile();
    app = m.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login').send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    teams = (await request(http).get('/api/v1/team-board').set(auth())).body;
    products = (await request(http).get('/api/v1/products').set(auth())).body;
  }, 60000);
  afterAll(async () => { await app.close(); });

  describe('teams', () => {
    it('has the new U10 Development 2 and U8 Advanced teams and the agreed capacities', async () => {
      const cap = Object.fromEntries(teams.map((t) => [t.name, t.capacity]));
      expect(cap).toMatchObject({
        'U10 Development 1': 12, 'U10 Development 2': 12, 'U8 Advanced': 12, 'U8 Development 1': 12, 'U6 Development': 12,
        'U12 HPC': 14, 'U14 Advanced Blue': 14, 'U16 HPC': 16, 'U16/18 Development': 20, 'U18 Advanced': 22,
      });
      const u10b = teams.find((t) => t.name === 'U10 Development 2');
      expect(u10b.schedule).toMatch(/^Tue & Thu/);
      expect(u10b.schedule).toMatch(/7:30/);
      const grid = (await request(http).get(`/api/v1/teams/${u10b.id}/attendance-grid?from=2026-11-01&to=2026-11-30`).set(auth()).expect(200)).body;
      expect(grid.sessions.length).toBeGreaterThan(5);
    });
  });

  describe('term options and discounts', () => {
    beforeAll(async () => {
      g = (await request(http).post('/api/v1/guardians').set(auth()).send({
        fullName: `Season Family ${uniq}`, email: `season${uniq}@example.com`, mobile: `+97152${String(uniq).slice(-7)}`,
      }).expect(201)).body;
      child = (await request(http).post('/api/v1/players').set(auth()).send({
        guardianId: g.id, firstName: 'Season', lastName: `Kid${uniq}`, gender: 'MALE', dateOfBirth: '2015-05-05',
      }).expect(201)).body;
    });

    it('needs a term option to be chosen — none is picked for you', async () => {
      const r = await request(http).post(`/api/v1/players/${child.id}/terms`).set(auth()).send({ sessionsPerWeek: 2 }).expect(400);
      expect(r.body.message).toMatch(/term option/i);
    });

    it('a sponsored child pays nothing for training but still pays for the kit', async () => {
      const team = teams.find((t) => t.name === 'U12 Development');
      const kit = products.find((p) => /Development kit/.test(p.name));
      const q = (await request(http).get(`/api/v1/players/${child.id}/terms/quote?package=FULL&sessionsPerWeek=2&teamId=${team.id}&productIds=${kit.id}&manualPreset=SPONSORED_100`).set(auth()).expect(200)).body;
      expect(q.manualDiscount).toMatchObject({ percent: 100, label: 'Sponsored 100%' });
      expect(q.siblingDiscount).toBeNull();
      expect(q.total).toBe(0);
      expect(q.grandTotal).toBe(Number(kit.priceInclVat));
      const r = (await request(http).post(`/api/v1/players/${child.id}/terms`).set(auth()).send({
        package: 'FULL', sessionsPerWeek: 2, teamId: team.id, productIds: [kit.id], manualDiscount: { preset: 'SPONSORED_100', reason: 'Scholarship' },
      }).expect(201)).body;
      expect(Number(r.invoice.total)).toBeCloseTo(Number(kit.priceInclVat), 2);
      const training = r.invoice.lineItems.find((l: any) => l.package === 'FULL');
      expect(Number(training.lineTotal)).toBe(0);
      expect(r.appliedDiscounts[0]).toMatch(/Sponsored 100% — Scholarship/);
    });

    it('a full season shows as "Full season" on the player page, the players list and the parent portal', async () => {
      const p = (await request(http).get(`/api/v1/players/${child.id}/profile`).set(auth()).expect(200)).body;
      expect(p.currentTerm).toMatchObject({ name: 'Full season', package: 'FULL', terms: 'Term 1, Term 2, Term 3' });
      expect(p.purchases).toHaveLength(1);
      expect(p.purchases[0].terms.map((t: any) => t.name)).toEqual(['Term 1', 'Term 2', 'Term 3']);
      const list = (await request(http).get(`/api/v1/players?search=${encodeURIComponent('Kid' + uniq)}`).set(auth()).expect(200)).body;
      expect(list.data[0].term.name).toBe('Full season');
      // Parent portal: welcome email → temporary password → new password → what the parent sees.
      const temp = sent.filter((x) => x.to === g.email && /sign-in details/.test(x.subject)).pop()!.text.match(/Temporary password: (\S+)/)![1];
      let pt = (await request(http).post('/api/v1/parent/auth/login').send({ email: g.email, password: temp }).expect(201)).body.accessToken;
      pt = (await request(http).post('/api/v1/parent/auth/change-password').set(auth(pt)).send({ currentPassword: temp, newPassword: 'Football2026' }).expect(201)).body.accessToken;
      const me = (await request(http).get('/api/v1/parent/me').set(auth(pt)).expect(200)).body;
      expect(me.children[0].terms).toEqual(['Full season (Term 1, Term 2, Term 3)']);
    });

    it('takes the percentage presets, early bird included, on the training fee', async () => {
      const second = (await request(http).post('/api/v1/players').set(auth()).send({
        guardianId: g.id, firstName: 'Second', lastName: `Kid${uniq}`, gender: 'MALE', dateOfBirth: '2016-05-05',
      }).expect(201)).body;
      const q = (await request(http).get(`/api/v1/players/${second.id}/terms/quote?package=T2&sessionsPerWeek=1&manualPreset=DISCOUNT_25`).set(auth()).expect(200)).body;
      expect(Math.abs(q.manualDiscount.amount - q.listPrice * 0.25)).toBeLessThanOrEqual(0.006);
      const r = (await request(http).post(`/api/v1/players/${second.id}/terms`).set(auth()).send({ package: 'T2', sessionsPerWeek: 1, manualDiscount: { preset: 'EARLY_BIRD_10' } }).expect(201)).body;
      expect(r.appliedDiscounts).toEqual([`Second: Early bird 10%`]);
      await request(http).post(`/api/v1/players/${second.id}/terms`).set(auth()).send({ package: 'T3', sessionsPerWeek: 1, manualDiscount: { preset: 'HALF_PRICE' } }).expect(400);
    });
  });

  describe('guardians', () => {
    it('finds a family by any email, keeps an additional email, and clears it', async () => {
      await request(http).patch(`/api/v1/guardians/${g.id}`).set(auth()).send({ secondaryEmail: `Mum${uniq}@Example.com`, secondaryEmailName: 'Mother — Rana' }).expect(200);
      const d = (await request(http).get(`/api/v1/guardians/directory?search=mum${uniq}`).set(auth()).expect(200)).body;
      expect(d.meta.total).toBe(1);
      expect(d.data[0]).toMatchObject({ secondaryEmail: `mum${uniq}@example.com`, secondaryEmailName: 'Mother — Rana' });
      expect(d.data[0].children.map((c: any) => c.reference)).toContain(child.reference);
      const byChild = (await request(http).get(`/api/v1/guardians/directory?search=${encodeURIComponent('Season Kid' + uniq)}`).set(auth()).expect(200)).body;
      expect(byChild.data.map((x: any) => x.id)).toContain(g.id);
      const byRef = (await request(http).get(`/api/v1/guardians/directory?reference=${g.reference.replace('PR-', '')}`).set(auth()).expect(200)).body;
      expect(byRef.data.map((x: any) => x.id)).toEqual([g.id]);
      await request(http).patch(`/api/v1/guardians/${g.id}`).set(auth()).send({ secondaryEmail: g.email }).expect(400);
      // Invoice emails are copied to the additional email.
      const inv = (await request(http).get(`/api/v1/invoice-register?parentNo=${g.reference.replace('PR-', '')}`).set(auth()).expect(200)).body.data[0];
      await request(http).post(`/api/v1/invoices/${inv.id}/email`).set(auth()).expect(201);
      expect(sent[sent.length - 1].cc).toEqual([`mum${uniq}@example.com`]);
      const cleared = (await request(http).patch(`/api/v1/guardians/${g.id}`).set(auth()).send({ secondaryEmail: null }).expect(200)).body;
      expect(cleared.secondaryEmail).toBeNull();
      expect(cleared.secondaryEmailName).toBeNull();
    });
  });

  describe('staff', () => {
    it('Karim and Michel are the team members leads go to; the built-in admin is not', async () => {
      const o = (await request(http).get('/api/v1/leads/owners').set(auth()).expect(200)).body;
      const emails = await Promise.all(o.map(async (x: any) => (await request(http).get(`/api/v1/users/${x.id}`).set(auth())).body.email));
      expect(emails).toEqual(expect.arrayContaining(['karim@inspirat.us', 'michel@inspirat.us']));
      expect(emails).not.toContain('admin@laligaacademy.local');
      const users = (await request(http).get('/api/v1/users?limit=100').set(auth()).expect(200)).body.data;
      expect(users.find((u: any) => u.email === 'michel@inspirat.us').role.slug).toBe('super-admin');
    });

    it('a super admin sets a password, and the person changes their own', async () => {
      const roles = (await request(http).get('/api/v1/roles').set(auth()).expect(200)).body;
      const pw = `Desk-${uniq}-pass`;
      const u = (await request(http).post('/api/v1/users').set(auth()).send({ fullName: 'Desk Test', email: `desk${uniq}@example.com`, roleId: roles.find((r: any) => r.slug === 'sales').id, password: pw }).expect(201)).body;
      const t = (await request(http).post('/api/v1/auth/login').send({ email: u.email, password: pw }).expect(201)).body.accessToken;
      await request(http).post('/api/v1/auth/change-password').set(auth(t)).send({ currentPassword: 'not-it-at-all', newPassword: 'Another-pass-123' }).expect(401);
      await request(http).post('/api/v1/auth/change-password').set(auth(t)).send({ currentPassword: pw, newPassword: 'Another-pass-123' }).expect(201);
      await request(http).post('/api/v1/auth/login').send({ email: u.email, password: pw }).expect(401);
      await request(http).post('/api/v1/auth/login').send({ email: u.email, password: 'Another-pass-123' }).expect(201);
    });
  });

  describe('trials sheet', () => {
    let leadId: string, coachToken: string;
    const sheet = (id: string, body: any, t = token) => request(http).patch(`/api/v1/leads/${id}/trial-sheet`).set(auth(t)).send(body);

    beforeAll(async () => {
      const l = (await request(http).post('/api/v1/leads').set(auth()).send({
        guardianName: `Trial Parent ${uniq}`, guardianMobile: `+97154${String(uniq).slice(-7)}`, playerName: 'Trial Kid', playerDob: '2015-02-02',
      }).expect(201)).body;
      leadId = l.id;
      const slots = (await request(http).get(`/api/v1/leads/${leadId}/trial-slots`).set(auth()).expect(200)).body;
      const dev = slots.find((s: any) => s.level === 'DEVELOPMENT') ?? slots[0];
      await request(http).post(`/api/v1/leads/${leadId}/trial`).set(auth()).send({ sessionId: dev.id }).expect(201);
      coachToken = (await request(http).post('/api/v1/auth/login').send({ email: 'sergio@laligaacademy.local', password: 'Coach@12345' })).body.accessToken;
    });

    it('lists the trial by date with its type, and saves each cell', async () => {
      const lead = (await request(http).get(`/api/v1/leads/${leadId}`).set(auth())).body;
      const day = new Date(new Date(lead.trialDate).getTime() + 4 * 3600000).toISOString().slice(0, 10);
      const b = (await request(http).get(`/api/v1/leads/trials?from=${day}&to=${day}`).set(auth()).expect(200)).body;
      const row = b.rows.find((r: any) => r.id === leadId);
      expect(row).toMatchObject({ trialType: 'DEVELOPMENT', trialConfirmed: false, category: 'U12' });
      expect((await sheet(leadId, { trialConfirmed: true }).expect(200)).body.trialConfirmed).toBe(true);
      const owners = (await request(http).get('/api/v1/leads/owners').set(auth())).body;
      const r1 = (await sheet(leadId, { attended: 'YES', assignedToId: owners[0].id }).expect(200)).body;
      expect(r1).toMatchObject({ trialOutcome: 'ATTENDED', status: 'TRIAL_ATTENDED', assignedToName: owners[0].fullName });
      const todo = (await request(http).get(`/api/v1/leads/trials?from=${day}&to=${day}&followUp=evaluation`).set(auth())).body;
      expect(todo.rows.map((r: any) => r.id)).toContain(leadId);
      const r2 = (await sheet(leadId, { followUpOutcome: 'All details shared, interested — will confirm' }).expect(200)).body;
      expect(r2.followUpOutcome).toBe('All details shared, interested — will confirm');
      expect(r2.lastNote.body).toBe('All details shared, interested — will confirm');
      await sheet(leadId, { attended: 'MAYBE' }).expect(400);
    });

    it('coaches see trials and evaluate them, but cannot change the desk\'s columns', async () => {
      await request(http).get('/api/v1/leads/trials').set(auth(coachToken)).expect(200);
      await sheet(leadId, { attended: 'NO' }, coachToken).expect(403);
      const e = (await request(http).post(`/api/v1/leads/${leadId}/evaluations`).set(auth(coachToken)).send({
        recommendation: 'ADVANCED', ratings: { technical: 4, tactical: 3, physical: 4, attitude: 5 }, strengths: 'Quick feet', toImprove: 'Weak foot',
      }).expect(201)).body;
      expect(e.row).toMatchObject({ trialEvaluation: 'ADVANCED', trialOutcome: 'ATTENDED' });
      const d = (await request(http).get(`/api/v1/leads/${leadId}/detail`).set(auth()).expect(200)).body;
      expect(d.lead.level).toBe('Advanced');
      expect(d.evaluations[0]).toMatchObject({ recommendation: 'ADVANCED', strengths: 'Quick feet', by: 'Sergio' });
      expect(d.trialCoach.name).toBe('Sergio');
      await request(http).post(`/api/v1/leads/${leadId}/evaluations`).set(auth(coachToken)).send({ recommendation: 'ADVANCED', ratings: { technical: 9 } }).expect(400);
    });

    it('coaches never see money', async () => {
      const list = (await request(http).get(`/api/v1/players?search=${encodeURIComponent('Kid' + uniq)}`).set(auth(coachToken)).expect(200)).body;
      expect(list.data.every((r: any) => r.payment === null)).toBe(true);
      const p = (await request(http).get(`/api/v1/players/${child.id}/profile`).set(auth(coachToken)).expect(200)).body;
      expect(p).toMatchObject({ moneyHidden: true, invoices: [], payment: null });
      expect(p.guardian.wallet).toBeNull();
      expect(p.currentTerm.name).toBe('Full season');
      await request(http).get('/api/v1/invoice-register').set(auth(coachToken)).expect(403);
      await request(http).get('/api/v1/reports/payments').set(auth(coachToken)).expect(403);
      await request(http).get('/api/v1/guardians/directory').set(auth(coachToken)).expect(403);
    });

    it('keeps comments in the lead with their dates, and the standard follow-ups editable', async () => {
      await request(http).post(`/api/v1/leads/${leadId}/activities`).set(auth()).send({ type: 'WHATSAPP', outcome: 'SENT', body: 'Sent the placement' }).expect(201);
      await request(http).post(`/api/v1/leads/${leadId}/activities`).set(auth()).send({ type: 'CALL', outcome: 'NO_ANSWER' }).expect(201);
      const d = (await request(http).get(`/api/v1/leads/${leadId}/detail`).set(auth())).body;
      const notes = d.timeline.filter((a: any) => ['COMMENT', 'CALL', 'WHATSAPP'].includes(a.type));
      expect(notes[0]).toMatchObject({ type: 'CALL', meta: { outcome: 'NO_ANSWER' } });
      expect(notes[1]).toMatchObject({ type: 'WHATSAPP', body: 'Sent the placement' });
      expect(notes.every((n: any) => n.at)).toBe(true);
      const o = (await request(http).get('/api/v1/leads/outcomes').set(auth()).expect(200)).body.outcomes;
      expect(o).toContain('Prices are out of budget');
      await request(http).put('/api/v1/leads/outcomes').set(auth()).send({ outcomes: [...o, 'Moving to Dubai'] }).expect(200);
      expect((await request(http).get('/api/v1/leads/outcomes').set(auth())).body.outcomes).toContain('Moving to Dubai');
    });
  });
});
