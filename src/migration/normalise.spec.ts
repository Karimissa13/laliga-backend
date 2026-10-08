import {
  classifyProgramme, guardianKey, mapInvoiceStatus, mapPlayerStatus, normaliseDate,
  normaliseEmail, normaliseMobile, normaliseMoney, normalisePaymentMethod, parseAgeCategory,
} from './normalise';
import { Gender, InvoiceStatus, PaymentMethod, PlayerStatus, ProgramType } from '../database/entities';

describe('legacy normalisers', () => {
  describe('parseAgeCategory — the audit found these were free text', () => {
    it('normalises the U15 / U-15 inconsistency to one code', () => {
      expect(parseAgeCategory('U15').code).toBe('U15');
      expect(parseAgeCategory('U-15').code).toBe('U15');
      expect(parseAgeCategory('u 15').code).toBe('U15');
    });
    it('extracts gender baked into the label', () => {
      const p = parseAgeCategory('Girl U-15');
      expect(p.code).toBe('U15');
      expect(p.gender).toBe(Gender.FEMALE);
    });
    it('extracts the level from HPC U19', () => {
      const p = parseAgeCategory('HPC U19');
      expect(p.code).toBe('U19');
      expect(p.level).toBe('HPC');
    });
    it('returns a null code for unparseable labels', () => {
      expect(parseAgeCategory('Goalkeepers').code).toBeNull();
      expect(parseAgeCategory('').code).toBeNull();
    });
  });

  describe('normalisePaymentMethod — legacy list had a duplicate "Transfer"', () => {
    it('collapses both transfer spellings onto one method', () => {
      expect(normalisePaymentMethod('Transfer')).toBe(PaymentMethod.BANK_TRANSFER);
      expect(normalisePaymentMethod('Bank Transfer')).toBe(PaymentMethod.BANK_TRANSFER);
    });
    it('maps Cardbank and Credit to CARD', () => {
      expect(normalisePaymentMethod('Cardbank')).toBe(PaymentMethod.CARD);
      expect(normalisePaymentMethod('Credit')).toBe(PaymentMethod.CARD);
    });
    it('maps Cheques to CHEQUE', () => {
      expect(normalisePaymentMethod('Cheques')).toBe(PaymentMethod.CHEQUE);
    });
    it('returns null for anything unrecognised so it gets reported', () => {
      expect(normalisePaymentMethod('Bitcoin')).toBeNull();
    });
  });

  describe('mapInvoiceStatus — 7 overlapping legacy statuses', () => {
    it('folds the three "issued but unpaid" variants together', () => {
      expect(mapInvoiceStatus('Invoice Issued')).toBe(InvoiceStatus.ISSUED);
      expect(mapInvoiceStatus('Payment Pending')).toBe(InvoiceStatus.ISSUED);
      expect(mapInvoiceStatus('Invoice Accepted')).toBe(InvoiceStatus.ISSUED);
    });
    it('keeps the meaningful ones distinct', () => {
      expect(mapInvoiceStatus('Paid')).toBe(InvoiceStatus.PAID);
      expect(mapInvoiceStatus('Partial Payment')).toBe(InvoiceStatus.PART_PAID);
      expect(mapInvoiceStatus('Sponsored')).toBe(InvoiceStatus.SPONSORED);
    });
  });

  describe('mapPlayerStatus', () => {
    it('maps the legacy words onto the new lifecycle', () => {
      expect(mapPlayerStatus('Active')).toBe(PlayerStatus.ACTIVE);
      expect(mapPlayerStatus('Trial')).toBe(PlayerStatus.TRIAL);
      expect(mapPlayerStatus('Waiting List')).toBe(PlayerStatus.WAITLISTED);
      expect(mapPlayerStatus('Withdrawn')).toBe(PlayerStatus.WITHDRAWN);
    });
  });

  describe('classifyProgramme — legacy "term" meant three different things', () => {
    it('splits terms, camps and tournaments apart', () => {
      expect(classifyProgramme('Season 10 Term 1')).toBe(ProgramType.TERM);
      expect(classifyProgramme('Elite Development Camp')).toBe(ProgramType.CAMP);
      expect(classifyProgramme('Salou Cup 2026')).toBe(ProgramType.EVENT);
      expect(classifyProgramme('Citizens Cup')).toBe(ProgramType.EVENT);
      expect(classifyProgramme('Man City League')).toBe(ProgramType.LEAGUE);
    });
  });

  describe('contact normalisation', () => {
    it('brings UAE mobile formats to one canonical form', () => {
      expect(normaliseMobile('0501111111')).toBe('+971501111111');
      expect(normaliseMobile('00971501111111')).toBe('+971501111111');
      expect(normaliseMobile('+971 50 111 1111')).toBe('+971501111111');
      expect(normaliseMobile('971501111111')).toBe('+971501111111');
    });
    it('lowercases and validates emails', () => {
      expect(normaliseEmail('  AHMED@Example.com ')).toBe('ahmed@example.com');
      expect(normaliseEmail('not-an-email')).toBeNull();
      expect(normaliseEmail('')).toBeNull();
    });
  });

  describe('date and money parsing', () => {
    it('reads dd/mm/yyyy and ISO alike', () => {
      expect(normaliseDate('10/05/2016')).toBe('2016-05-10');
      expect(normaliseDate('2013-02-20')).toBe('2013-02-20');
      expect(normaliseDate('')).toBeNull();
      expect(normaliseDate('rubbish')).toBeNull();
    });
    it('strips currency formatting', () => {
      expect(normaliseMoney('AED 3,991.05')).toBe(3991.05);
      expect(normaliseMoney('3801')).toBe(3801);
      expect(normaliseMoney('')).toBeNull();
    });
  });

  describe('guardianKey — how duplicate families are detected', () => {
    it('treats the same email as the same guardian regardless of case/spacing', () => {
      expect(guardianKey('AHMED@Example.com', '0501111111', 'ahmed  al mansoori'))
        .toBe(guardianKey('ahmed@example.com', null, 'Ahmed Al Mansoori'));
    });
    it('falls back to mobile when the email is missing', () => {
      expect(guardianKey(null, '0554443333', 'Khalid')).toBe('m:+971554443333');
    });
    it('falls back to the name when there is nothing else', () => {
      expect(guardianKey(null, null, 'Khalid Iqbal')).toBe('n:khalid iqbal');
    });
  });
});
