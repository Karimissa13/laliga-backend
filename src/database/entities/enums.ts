// Shared domain enums (mirrors docs/data-model.reference.prisma)

export enum Gender { MALE = 'MALE', FEMALE = 'FEMALE' }

export enum PlayerStatus {
  TRIAL = 'TRIAL',
  WAITLISTED = 'WAITLISTED',
  REGISTERED = 'REGISTERED',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  WITHDRAWN = 'WITHDRAWN',
}

export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  TRIAL_BOOKED = 'TRIAL_BOOKED',
  TRIAL_ATTENDED = 'TRIAL_ATTENDED',
  OFFER_MADE = 'OFFER_MADE',
  REGISTERED = 'REGISTERED',
  LOST = 'LOST',
}

export enum LeadSource {
  POPUP = 'POPUP',
  ENQUIRY = 'ENQUIRY',
  WEBSITE = 'WEBSITE',
  REFERRAL = 'REFERRAL',
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
  SCHOOL = 'SCHOOL',
  EMAIL_SMS = 'EMAIL_SMS',
  TV_RADIO = 'TV_RADIO',
  OTHER = 'OTHER',
}

/** Training level of a TEAM. Within an age group, HPC is the 1st team. */
export enum TeamLevel {
  DEVELOPMENT = 'DEVELOPMENT',
  ADVANCED = 'ADVANCED',
  HPC = 'HPC',
}

/**
 * Advanced squads when an age group has more than one advanced team.
 * WHITE is the 2nd team, BLUE the 3rd. No squad means the only advanced team.
 */
export enum Squad {
  WHITE = 'WHITE',
  BLUE = 'BLUE',
}

export enum Weekday {
  MON = 'MON', TUE = 'TUE', WED = 'WED', THU = 'THU', FRI = 'FRI', SAT = 'SAT', SUN = 'SUN',
}

export enum ProgramType { TERM = 'TERM', CAMP = 'CAMP', EVENT = 'EVENT', LEAGUE = 'LEAGUE' }

export enum EnrolmentStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  TRANSFERRED = 'TRANSFERRED',
}

export enum InvoiceType {
  STANDARD = 'STANDARD',
  LEAGUE = 'LEAGUE',
  CAMP = 'CAMP',
  ADDITIONAL = 'ADDITIONAL',
  CUSTOM = 'CUSTOM',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PART_PAID = 'PART_PAID',
  PAID = 'PAID',
  REFUNDED = 'REFUNDED',
  WRITTEN_OFF = 'WRITTEN_OFF',
  CANCELLED = 'CANCELLED',
  SPONSORED = 'SPONSORED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CHEQUE = 'CHEQUE',
  CARD = 'CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  ONLINE = 'ONLINE',
  WALLET = 'WALLET',
}

export enum PaymentDirection { INBOUND = 'INBOUND', REFUND = 'REFUND' }

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum DiscountKind { PERCENTAGE = 'PERCENTAGE', FIXED = 'FIXED' }

export enum DiscountRule {
  MANUAL = 'MANUAL',
  SIBLING = 'SIBLING',
  RETURNING = 'RETURNING',
  EARLY_BIRD = 'EARLY_BIRD',
  PROMO = 'PROMO',
  SPONSOR = 'SPONSOR',
}

export enum DocumentType {
  PHOTO = 'PHOTO',
  MEDICAL_INSURANCE = 'MEDICAL_INSURANCE',
  EMIRATES_ID_FRONT = 'EMIRATES_ID_FRONT',
  EMIRATES_ID_BACK = 'EMIRATES_ID_BACK',
  BIRTH_CERTIFICATE = 'BIRTH_CERTIFICATE',
  PASSPORT = 'PASSPORT',
  CONSENT_FORM = 'CONSENT_FORM',
  OTHER = 'OTHER',
}

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  EXCUSED = 'EXCUSED',
  LATE = 'LATE',
}

export enum SessionType {
  TRAINING = 'TRAINING',
  MATCH = 'MATCH',
  TRIAL = 'TRIAL',
  CAMP = 'CAMP',
  EVENT = 'EVENT',
}

export enum CommunicationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
  PUSH = 'PUSH',
}

export enum CommunicationStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
}

export enum WalletTxnType { CREDIT = 'CREDIT', DEBIT = 'DEBIT' }

/** Why a tax credit note was issued against an invoice. */
export enum CreditNoteKind {
  REFUND = 'REFUND',             // money paid back (bank or wallet)
  WRITE_OFF = 'WRITE_OFF',       // amount forgiven (write-off or instalment waiver) — not a bad debt
  CANCELLATION = 'CANCELLATION', // an issued invoice cancelled in full
}

/** Where a line's money is reported on the finance dashboard. */
export enum RevenueStream {
  ACADEMY = 'ACADEMY',                 // term fees
  KITS = 'KITS',
  MAN_CITY_LEAGUE = 'MAN_CITY_LEAGUE',
  ABU_DHABI_CUP = 'ABU_DHABI_CUP',
  RAMADAN_CUP = 'RAMADAN_CUP',
  SALOU_CUP = 'SALOU_CUP',
  OTHER = 'OTHER',
}

export enum KitType {
  HOME = 'HOME', AWAY = 'AWAY', TOP = 'TOP', TRAINING = 'TRAINING', GOALKEEPER = 'GOALKEEPER',
}

export enum CoachEmployment { FULL_TIME = 'FULL_TIME', PART_TIME = 'PART_TIME' }

/** The six ways a season can be bought. */
export enum TermPackage {
  T1 = 'T1', T2 = 'T2', T3 = 'T3', T1_2 = 'T1_2', T2_3 = 'T2_3', FULL = 'FULL',
}

export enum InventoryProgramme { LALIGA = 'LALIGA', ADSC = 'ADSC' }
export enum StockMovementType {
  OPENING = 'OPENING',   // first count when an item is added or imported
  IN = 'IN',             // received into the store
  OUT = 'OUT',           // issued / taken out
  ADJUST = 'ADJUST',     // stock-take correction (+ or −)
}

export enum AcademyEventKind {
  PITCH_BOOKING = 'PITCH_BOOKING',
  MATCH = 'MATCH',
  TOURNAMENT = 'TOURNAMENT',
  EVENT = 'EVENT',
  HOLIDAY = 'HOLIDAY',
  CAMP = 'CAMP',
}
