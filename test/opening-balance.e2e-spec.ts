import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { writeOpeningBalance } from '../src/modules/finance/opening-balance.service';

/** Balance from earlier seasons (Karim, 16 Oct 2026): one per family, owed but not a new tax invoice. */
describe('Balance from earlier seasons (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let token: string;
  let ds: DataSource;
  const uniq = Date.now();
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(m.createNestApplication({ bodyParser: false }));
    await app.init();
    http = app.getHttpServer();
    ds = app.get(DataSource);
    token = (await request(http).post('/api/v1/auth/login').send({ email: 'admin@laligaacademy.local', password: 'Admin@12345' })).body.accessToken;
  }, 60000);
  afterAll(async () => { await app.close(); });

  it('lists each old invoice, adds no VAT, shows as owed, prints as a statement and can be paid', async () => {
    const g = (await request(http).post('/api/v1/guardians').set(auth()).send({
      fullName: `Opening ${uniq}`, email: `opening${uniq}@example.com`, mobile: `+97155${String(uniq).slice(-7)}`,
    }).expect(201)).body;
    const old = [
      { number: 'INVAB-1980', legacyId: '1980', date: '2024-09-03', total: 3150, paid: 1000 },
      { number: 'INVAB-2210', legacyId: '2210', date: '2025-02-10', total: 1050, paid: 0 },
      { number: 'INVAB-2001', legacyId: '2001', date: '2024-10-01', total: 735, paid: 735 },
    ];
    const r = await ds.transaction((m) => writeOpeningBalance(m, g.id, old, '2026-12-20'));
    expect(r).toMatchObject({ number: `OB-${g.reference}`, total: 3200, lines: 2 });
    await expect(ds.transaction((m) => writeOpeningBalance(m, g.id, old, '2026-12-20'))).rejects.toThrow(/already has a balance/);

    const inv = (await request(http).get(`/api/v1/invoices/${r!.id}`).set(auth()).expect(200)).body;
    expect(inv).toMatchObject({ status: 'ISSUED', purpose: 'OPENING', total: '3200.00', vatTotal: '0.00' });
    expect(inv.lineItems.map((l: any) => l.legacyId).sort()).toEqual(['1980', '2210']);

    const reg = (await request(http).get(`/api/v1/invoice-register?parentNo=${g.reference}`).set(auth()).expect(200)).body.data;
    expect(reg).toHaveLength(1);
    expect(reg[0].subscription).toBe('Balance from earlier seasons');

    const pdf = await request(http).get(`/api/v1/invoices/${r!.id}/pdf`).set(auth()).buffer(true)
      .parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((pdf.body as Buffer).toString('latin1')).toContain('Balance from earlier seasons');

    await request(http).post(`/api/v1/invoices/${r!.id}/payments`).set(auth()).send({ amount: 1200, method: 'CASH' }).expect(201);
    const after = (await request(http).get(`/api/v1/invoices/${r!.id}`).set(auth()).expect(200)).body;
    expect(Number(after.total) - Number(after.amountPaid)).toBe(2000);
  });

  it('refuses an overpaid old invoice (that is wallet credit, not a balance)', async () => {
    const g = (await request(http).post('/api/v1/guardians').set(auth()).send({
      fullName: `Opening2 ${uniq}`, email: `opening2.${uniq}@example.com`, mobile: `+97154${String(uniq).slice(-7)}`,
    }).expect(201)).body;
    await expect(ds.transaction((m) => writeOpeningBalance(m, g.id, [{ number: 'INVAB-7', total: 100, paid: 150 }], '2026-12-20'))).rejects.toThrow(/wallet/);
    expect(await ds.transaction((m) => writeOpeningBalance(m, g.id, [{ number: 'INVAB-8', total: 100, paid: 100 }], '2026-12-20'))).toBeNull();
  });
});
