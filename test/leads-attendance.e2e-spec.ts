import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MailerService, MailMessage } from '../src/modules/notifications/mailer.service';

/**
 * Trials & Leads (website intake → contact → trial in a real session → joined)
 * and the season's sessions with their registers.
 */
describe('Trials & Leads and season attendance (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  const uniq = Date.now();
  const mobile = `+97155${String(uniq).slice(-7)}`;
  const sent: MailMessage[] = [];
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mailer = {
    live: true,
    status: () => ({ connected: true, host: 'test', from: 'test@example.com' }),
    send: async (m: MailMessage) => { sent.push(m); return { ok: true, simulated: false, messageId: `t-${sent.length}` }; } };
  let teams: any[];
  let leadId: string;
  let trialSessionId: string;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailerService).useValue(mailer).compile();
    app = configureApp(m.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    token = (await request(http).post('/api/v1/auth/login')
      .send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
    teams = (await request(http).get('/api/v1/team-board').set(auth())).body;
  }, 60000);
  afterAll(async () => { await app.close(); });

  describe('the website pop-up', () => {
    it('takes a trial request without sign-in, email optional, and works out the category', async () => {
      const r = await request(http).post('/api/v1/public/trial-requests').send({
        guardianName: `Web Parent ${uniq}`, playerName: 'Omar Web', guardianMobile: mobile.replace('+971', '0'),
        playerDob: '14/03/2015', isGuardian: 'on', 'g-recaptcha-response': 'token-from-the-form', utm_source: 'google',
      }).expect(201);
      expect(r.body.ok).toBe(true);
      expect(r.body.reference).toMatch(/^TR-/);
      const list = (await request(http).get(`/api/v1/leads?search=${encodeURIComponent('Web Parent ' + uniq)}`).set(auth()).expect(200)).body;
      expect(list.meta.total).toBe(1);
      const l = list.data[0];
      leadId = l.id;
      expect(l.guardianEmail).toBeNull();
      expect(l.guardianMobile).toBe(mobile);
      expect(l.playerDob).toBe('2015-03-14');
      expect(l.ageGroupLabel).toBe('U12');
      expect(l.status).toBe('NEW');
      expect(l.source).toBe('POPUP');
      expect(l.isGuardian).toBe(true);
    });

    it('rejects a bad request, quietly drops a bot, and flags a repeat enquiry', async () => {
      await request(http).post('/api/v1/public/trial-requests').send({ guardianName: 'X', playerName: '', guardianMobile: '1' }).expect(400);
      const bot = await request(http).post('/api/v1/public/trial-requests').send({
        guardianName: 'Bot Parent', playerName: 'Bot', guardianMobile: '0501112233', playerDob: '2015-01-01', website: 'http://spam',
      }).expect(201);
      expect(bot.body.reference).toBeUndefined();
      const again = await request(http).post('/api/v1/public/trial-requests').send({
        guardianName: `Web Parent ${uniq}`, playerName: 'Sister Web', guardianMobile: mobile, playerDob: '2018-06-01',
      }).expect(201);
      const list = (await request(http).get(`/api/v1/leads?search=${encodeURIComponent(again.body.reference)}`).set(auth())).body;
      expect(list.data[0].duplicateOfLeadId).toBe(leadId);
      const d = (await request(http).get(`/api/v1/leads/${leadId}/detail`).set(auth()).expect(200)).body;
      expect(d.possibleDuplicates.map((x: any) => x.reference)).toContain(again.body.reference);
      expect(d.timeline[0].type).toBe('CREATED');
    });
  });

  describe('working the lead', () => {
    it('a call moves New to Contacted, counts the attempt and sets the follow-up', async () => {
      const due = new Date(Date.now() - 3600000).toISOString();
      const d = (await request(http).post(`/api/v1/leads/${leadId}/activities`).set(auth())
        .send({ type: 'CALL', outcome: 'NO_ANSWER', nextFollowUpAt: due }).expect(201)).body;
      expect(d.lead.status).toBe('CONTACTED');
      expect(d.lead.contactAttempts).toBe(1);
      expect(d.timeline.map((a: any) => a.type)).toEqual(expect.arrayContaining(['CALL', 'STATUS', 'FOLLOW_UP']));
      const dueList = (await request(http).get('/api/v1/leads?status=DUE&limit=200').set(auth()).expect(200)).body;
      expect(dueList.data.map((x: any) => x.id)).toContain(leadId);
      const st = (await request(http).get('/api/v1/leads/stats').set(auth()).expect(200)).body;
      expect(st.due).toBeGreaterThanOrEqual(1);
      await request(http).post(`/api/v1/leads/${leadId}/activities`).set(auth()).send({ type: 'COMMENT' }).expect(400);
      await request(http).post(`/api/v1/leads/${leadId}/activities`).set(auth()).send({ type: 'COMMENT', body: 'Prefers weekday evenings' }).expect(201);
      const withComments = (await request(http).get(`/api/v1/leads?hasComments=yes&search=${encodeURIComponent('Web Parent ' + uniq)}`).set(auth())).body;
      expect(withComments.data.map((x: any) => x.id)).toContain(leadId);
    });

    it('assigns the lead to a team member', async () => {
      const owners = (await request(http).get('/api/v1/leads/owners').set(auth()).expect(200)).body;
      expect(owners.length).toBeGreaterThan(0);
      await request(http).patch(`/api/v1/leads/${leadId}/assign`).set(auth()).send({ assignedToId: owners[0].id }).expect(200);
      const mine = (await request(http).get(`/api/v1/leads?assignedToId=${owners[0].id}&limit=200`).set(auth())).body;
      expect(mine.data.find((x: any) => x.id === leadId).assignedToName).toBe(owners[0].fullName);
    });

    it('books the trial into a real training session that takes the child\'s category', async () => {
      const slots = (await request(http).get(`/api/v1/leads/${leadId}/trial-slots`).set(auth()).expect(200)).body;
      expect(slots.length).toBeGreaterThan(0);
      const u12 = new Set(teams.filter((t) => (t.ageCodes || []).includes('U12')).map((t) => t.id));
      expect(slots.every((s: any) => u12.has(s.teamId))).toBe(true);
      trialSessionId = slots[0].id;
      const d = (await request(http).post(`/api/v1/leads/${leadId}/trial`).set(auth()).send({ sessionId: trialSessionId }).expect(201)).body;
      expect(d.lead.status).toBe('TRIAL_BOOKED');
      expect(d.trialSession.id).toBe(trialSessionId);
      expect(d.trialTeam.id).toBe(slots[0].teamId);
      const reg = (await request(http).get(`/api/v1/sessions/${trialSessionId}/register`).set(auth()).expect(200)).body;
      expect(reg.trials.map((t: any) => t.leadId)).toContain(leadId);
    });

    it('fills a ready-made message and gives a WhatsApp link; email needs an address', async () => {
      const c = (await request(http).post(`/api/v1/leads/${leadId}/compose`).set(auth()).send({ template: 'trial_confirmation' }).expect(201)).body;
      expect(c.text).toContain('Omar');
      expect(c.text).toContain('trial is booked for');
      expect(c.whatsappUrl).toMatch(new RegExp(`^https://wa\\.me/${mobile.slice(1)}\\?text=`));
      expect(c.canEmail).toBe(false);
      await request(http).post(`/api/v1/leads/${leadId}/compose`).set(auth()).send({ template: 'nope' }).expect(400);
      const wa = (await request(http).post(`/api/v1/leads/${leadId}/message`).set(auth()).send({ channel: 'WHATSAPP', text: c.text }).expect(201)).body;
      expect(wa.timeline[0].type).toBe('WHATSAPP');
      expect(wa.lead.contactAttempts).toBe(2);
      await request(http).post(`/api/v1/leads/${leadId}/message`).set(auth()).send({ channel: 'EMAIL', text: 'Hello' }).expect(400);
      await request(http).patch(`/api/v1/leads/${leadId}`).set(auth()).send({ guardianEmail: `web${uniq}@example.com` }).expect(200);
      const before = sent.length;
      const em = (await request(http).post(`/api/v1/leads/${leadId}/message`).set(auth()).send({ channel: 'EMAIL', subject: c.subject, text: c.text }).expect(201)).body;
      expect(em.emailed.sent).toBe(true);
      expect(sent.length).toBe(before + 1);
      expect(sent[sent.length - 1].to).toBe(`web${uniq}@example.com`);
    });

    it('records the trial and the coach\'s recommendation', async () => {
      const d = (await request(http).post(`/api/v1/leads/${leadId}/trial-result`).set(auth())
        .send({ outcome: 'ATTENDED', feedback: 'Quick feet', recommendedLevel: 'Development' }).expect(201)).body;
      expect(d.lead.status).toBe('TRIAL_ATTENDED');
      expect(d.lead.trialOutcome).toBe('ATTENDED');
      expect(d.lead.level).toBe('Development');
      expect(d.lead.nextFollowUpAt).toBeTruthy();
    });

    it('links the child registered from the lead and marks it Joined', async () => {
      const lead = (await request(http).get(`/api/v1/leads/${leadId}`).set(auth())).body;
      const g = (await request(http).post('/api/v1/guardians').set(auth()).send({
        fullName: lead.guardianName, email: lead.guardianEmail, mobile: lead.guardianMobile,
      }).expect(201)).body;
      const p = (await request(http).post('/api/v1/players').set(auth()).send({
        guardianId: g.id, firstName: 'Omar', lastName: 'Web', gender: 'MALE', dateOfBirth: lead.playerDob,
      }).expect(201)).body;
      const d = (await request(http).post(`/api/v1/leads/${leadId}/converted`).set(auth()).send({ playerId: p.id }).expect(201)).body;
      expect(d.lead.status).toBe('REGISTERED');
      expect(d.lead.playerId).toBe(p.id);
      expect(d.timeline[0].type).toBe('CONVERTED');
      expect(d.timeline[0].meta.reference).toBe(p.reference);
      // A later enquiry from the same family is recognised as a registered family.
      const again = (await request(http).post('/api/v1/leads').set(auth()).send({
        guardianName: lead.guardianName, guardianMobile: lead.guardianMobile, playerName: 'Younger Web',
      }).expect(201)).body;
      expect(again.existingGuardianId).toBe(g.id);
      expect(again.source).toBe('ENQUIRY');
      expect(again.guardianEmail).toBeNull();
    });

    it('needs a reason for Not joining, and exports to Excel', async () => {
      const l = (await request(http).post('/api/v1/leads').set(auth()).send({
        guardianName: `Lost Parent ${uniq}`, guardianMobile: `+97156${String(uniq).slice(-7)}`, playerName: 'Lost Kid', playerDob: '2016-01-01',
      }).expect(201)).body;
      await request(http).patch(`/api/v1/leads/${l.id}/status`).set(auth()).send({ status: 'LOST' }).expect(400);
      const lost = (await request(http).patch(`/api/v1/leads/${l.id}/status`).set(auth()).send({ status: 'LOST', reason: 'Location / too far' }).expect(200)).body;
      expect(lost.lostReason).toBe('Location / too far');
      expect(lost.nextFollowUpAt).toBeNull();
      const csv = await request(http).get(`/api/v1/leads.csv?search=${encodeURIComponent('Lost Parent ' + uniq)}`).set(auth()).expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text.charCodeAt(0)).toBe(0xfeff);
      expect(csv.text).toContain('Not joining');
      expect(csv.text).toContain('Location / too far');
    });

    it('keeps the message templates editable', async () => {
      const t = (await request(http).get('/api/v1/leads/templates').set(auth()).expect(200)).body.templates;
      expect(t.map((x: any) => x.key)).toEqual(expect.arrayContaining(['first_contact', 'trial_confirmation', 'after_trial']));
      t[0].text = 'Hi {{parent}} — about {{child}}';
      await request(http).put('/api/v1/leads/templates').set(auth()).send({ templates: t }).expect(200);
      const c = (await request(http).post(`/api/v1/leads/${leadId}/compose`).set(auth()).send({ template: t[0].key }).expect(201)).body;
      expect(c.text).toBe('Hi Web — about Omar');
    });
  });

  describe('the season\'s sessions', () => {
    const grid = async (teamId: string, from: string, to: string) =>
      (await request(http).get(`/api/v1/teams/${teamId}/attendance-grid?from=${from}&to=${to}`).set(auth()).expect(200)).body;
    const planned = (g: any) => g.sessions.filter((s: any) => s.type === 'TRAINING');

    it('every team has its sessions from 31 Aug 2026 to 11 Jun 2027, and re-running adds nothing', async () => {
      const r = (await request(http).post('/api/v1/schedule/season/generate').set(auth()).send({}).expect(201)).body;
      expect(r.created).toBe(0);
      expect(r.teams).toBe(teams.length);
      expect(r.total).toBeGreaterThan(1500);
      expect(r.closures.map((c: any) => c.title)).toEqual(expect.arrayContaining(['Winter break']));
    });

    it('follows each team\'s days and skips holidays', async () => {
      const mwf = teams.find((t) => /^Mon, Wed & Fri/.test(t.schedule));
      const tt = teams.find((t) => /^Tue & Thu/.test(t.schedule));
      const aug = planned(await grid(mwf.id, '2026-08-01', '2026-08-31'));
      expect(aug.map((s: any) => s.date)).toEqual(['2026-08-31']);
      const dec = planned(await grid(tt.id, '2026-12-01', '2026-12-31'));
      expect(dec.map((s: any) => s.date)).toEqual(['2026-12-01', '2026-12-08', '2026-12-10']);   // National Day 3 Dec off, term ends 11 Dec
      const winter = planned(await grid(tt.id, '2026-12-12', '2027-01-03'));
      expect(winter).toHaveLength(0);
      const june = planned(await grid(mwf.id, '2027-06-01', '2027-06-30'));
      expect(june[june.length - 1].date).toBe('2027-06-11');
    });

    it('takes a register: everyone present, a change, a cancelled session and a future one', async () => {
      const team = teams.find((t) => /^Tue & Thu/.test(t.schedule));
      const g = await grid(team.id, '2026-09-01', '2026-09-30');
      const past = planned(g).filter((s: any) => s.when === 'past');
      expect(past.length).toBeGreaterThan(5);
      const s1 = past[0];
      await request(http).post(`/api/v1/sessions/${s1.id}/register/all-present`).set(auth()).expect(201);
      const reg = (await request(http).get(`/api/v1/sessions/${s1.id}/register`).set(auth()).expect(200)).body;
      expect(reg.complete).toBe(reg.total > 0);
      if (reg.roster.length) {
        const pid = reg.roster[0].playerId;
        await request(http).post(`/api/v1/sessions/${s1.id}/register`).set(auth()).send({ marks: [{ playerId: pid, status: 'ABSENT' }] }).expect(201);
        await request(http).post(`/api/v1/sessions/${s1.id}/register/all-present`).set(auth()).expect(201);   // leaves the absence alone
        const g2 = await grid(team.id, '2026-09-01', '2026-09-30');
        expect(g2.players.find((p: any) => p.id === pid).marks[s1.id]).toBe('ABSENT');
      }
      const s2 = past[1];
      await request(http).patch(`/api/v1/sessions/${s2.id}/cancel`).set(auth()).send({ reason: 'Pitch closed' }).expect(200);
      await request(http).post(`/api/v1/sessions/${s2.id}/register/all-present`).set(auth()).expect(400);
      const g3 = await grid(team.id, '2026-09-01', '2026-09-30');
      expect(g3.sessions.find((s: any) => s.id === s2.id)).toMatchObject({ cancelled: true, cancelReason: 'Pitch closed' });
      await request(http).patch(`/api/v1/sessions/${s2.id}/cancel`).set(auth()).send({ cancelled: false }).expect(200);
      const future = planned(await grid(team.id, '2027-05-01', '2027-05-31'))[0];
      await request(http).post(`/api/v1/sessions/${future.id}/register/all-present`).set(auth()).expect(400);
      const unsub = (await request(http).get('/api/v1/attendance/unsubmitted?days=60').set(auth()).expect(200)).body;
      expect(unsub.some((u: any) => u.sessionId === s2.id)).toBe(reg.total > 0);
    });

    it('lists the day\'s registers across teams', async () => {
      const d = (await request(http).get('/api/v1/attendance/day?date=2026-09-01').set(auth()).expect(200)).body;
      expect(d.date).toBe('2026-09-01');
      const tueThu = teams.filter((t) => /^Tue & Thu/.test(t.schedule)).length;
      expect(d.sessions.filter((s: any) => s.type === 'TRAINING').length).toBe(tueThu);
      expect(d.sessions[0]).toHaveProperty('roster');
    });
  });
});
