import { creditSplit } from '../src/modules/finance/credit-notes.service';

describe('creditSplit', () => {
  it('takes the VAT at the invoice\'s own proportion (5% VAT inclusive)', () => {
    // Invoice 3,366.00 incl. 160.29 VAT; refund 1,050.00
    expect(creditSplit(1050, 3366, 160.29)).toEqual({ total: 1050, vat: 50, net: 1000 });
  });

  it('a full credit returns exactly the invoice VAT', () => {
    expect(creditSplit(9145.01, 9145.01, 435.48)).toEqual({ total: 9145.01, vat: 435.48, net: 8709.53 });
  });

  it('carries no VAT on a zero-VAT invoice', () => {
    expect(creditSplit(200, 200, 0)).toEqual({ total: 200, vat: 0, net: 200 });
    expect(creditSplit(50, 0, 0)).toEqual({ total: 50, vat: 0, net: 50 });
  });

  it('rounds to fils and keeps net + VAT = total', () => {
    const s = creditSplit(333.33, 5610, 267.14);
    expect(s.vat).toBe(15.87);
    expect(Math.round((s.net + s.vat) * 100) / 100).toBe(s.total);
  });
});
