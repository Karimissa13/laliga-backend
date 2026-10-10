import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { InvoiceRegisterQueryDto, PaymentReportQueryDto } from '../src/modules/finance/finance-reports.controller';
import { PlayerFilterDto } from '../src/modules/people/dto/player.dto';

/** The global pipe exactly as configureApp sets it (implicit conversion on — the live behaviour). */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const asQuery = (metatype: any): ArgumentMetadata => ({ type: 'query', metatype, data: '' });

describe('query parameters under the live validation settings', () => {
  it('"false" stays false (it used to arrive as true)', async () => {
    expect((await pipe.transform({ includeWallet: 'false' }, asQuery(PaymentReportQueryDto))).includeWallet).toBe(false);
    expect((await pipe.transform({ open: 'false', hasPlan: 'false' }, asQuery(InvoiceRegisterQueryDto)))).toMatchObject({ open: false, hasPlan: false });
    expect((await pipe.transform({ includeArchived: 'false' }, asQuery(PlayerFilterDto))).includeArchived).toBe(false);
  });

  it('"true" is true; missing or empty is not given', async () => {
    expect((await pipe.transform({ includeWallet: 'true' }, asQuery(PaymentReportQueryDto))).includeWallet).toBe(true);
    expect((await pipe.transform({ includeWallet: '' }, asQuery(PaymentReportQueryDto))).includeWallet).toBeUndefined();
    expect((await pipe.transform({}, asQuery(PaymentReportQueryDto))).includeWallet).toBeUndefined();
  });

  it('numbers and lists arrive as sent', async () => {
    const id1 = '6a2f1c3e-1b2d-4c5e-8f90-1a2b3c4d5e6f', id2 = '7b3f2d4e-2c3e-4d6f-9a01-2b3c4d5e6f70';
    const q = await pipe.transform({ page: '2', limit: '50', amountFrom: '', amountTo: '1500.5', ids: `${id1},${id2}` }, asQuery(InvoiceRegisterQueryDto));
    expect(q).toMatchObject({ page: 2, limit: 50, amountTo: 1500.5, ids: [id1, id2] });
    expect(q.amountFrom).toBeUndefined();
  });

  it('still refuses what it should', async () => {
    await expect(pipe.transform({ page: 'abc' }, asQuery(InvoiceRegisterQueryDto))).rejects.toBeDefined();
    await expect(pipe.transform({ ids: 'not-a-uuid' }, asQuery(InvoiceRegisterQueryDto))).rejects.toBeDefined();
    await expect(pipe.transform({ path: 'v1/players' }, asQuery(InvoiceRegisterQueryDto))).rejects.toBeDefined();
  });
});
