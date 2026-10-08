/**
 * Canonical permission catalog: every `module.action` the system recognises.
 * The seeder creates a Permission row per key and wires them to default roles.
 * Adding a feature = add its permission keys here and reference them in guards.
 */

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];

// Modules and the actions each supports.
export const MODULE_ACTIONS: Record<string, Action[]> = {
  dashboard: ['view'],
  guardian: ['view', 'create', 'edit', 'delete', 'export', 'manage'],
  player: ['view', 'create', 'edit', 'delete', 'export', 'manage'],
  lead: ['view', 'create', 'edit', 'delete', 'export'],
  registration: ['view', 'create', 'edit', 'approve'],
  team: ['view', 'create', 'edit', 'delete'],
  coach: ['view', 'create', 'edit', 'delete'],
  season: ['view', 'create', 'edit', 'delete'],
  location: ['view', 'create', 'edit', 'delete'],
  agegroup: ['view', 'create', 'edit', 'delete'],
  session: ['view', 'create', 'edit', 'delete'],
  attendance: ['view', 'create', 'edit', 'export'],
  invoice: ['view', 'create', 'edit', 'delete', 'export', 'manage'],
  payment: ['view', 'create', 'edit'],
  refund: ['create'],
  writeoff: ['create'],
  discount: ['view', 'create', 'edit', 'delete'],
  wallet: ['view', 'manage'],
  evaluation: ['view', 'create', 'edit', 'approve'],
  document: ['view', 'create', 'delete'],
  communication: ['view', 'create', 'manage'],
  report: ['view', 'export'],
  user: ['view', 'create', 'edit', 'delete'],
  role: ['view', 'create', 'edit', 'delete', 'manage'],
  audit: ['view'],
  impersonate: ['create'],
  settings: ['view', 'manage'],
  inventory: ['view', 'create', 'edit'],
};

/** Flat list of all permission keys, e.g. ["player.view", "invoice.refund", ...]. */
export function allPermissionKeys(): string[] {
  const keys: string[] = [];
  for (const [mod, actions] of Object.entries(MODULE_ACTIONS)) {
    for (const a of actions) keys.push(`${mod}.${a}`);
  }
  return keys;
}

export interface RoleDef {
  name: string;
  slug: string;
  description: string;
  isSystem: boolean;
  // '*' = all permissions; otherwise explicit keys or `module.*` wildcards expanded by the seeder.
  permissions: string[];
}

// Default roles, mirroring the approved Roles & Permissions matrix in the blueprint.
export const DEFAULT_ROLES: RoleDef[] = [
  {
    name: 'Super Admin', slug: 'super-admin', isSystem: true,
    description: 'Full, unrestricted access to every module and setting.',
    permissions: ['*'],
  },
  {
    name: 'General Admin', slug: 'general-admin', isSystem: true,
    description: 'Day-to-day administration across people, registration, ops and comms.',
    permissions: [
      'dashboard.*', 'guardian.*', 'player.*', 'lead.*', 'registration.*',
      'team.*', 'coach.*', 'season.*', 'location.*', 'agegroup.*',
      'session.*', 'attendance.*', 'invoice.view', 'invoice.create', 'payment.view',
      'payment.create', 'discount.view', 'evaluation.view', 'document.*',
      'communication.*', 'report.*', 'audit.view', 'inventory.*',
    ],
  },
  {
    name: 'Finance', slug: 'finance', isSystem: true,
    description: 'Owns invoicing, payments, refunds, discounts and financial reporting.',
    permissions: [
      'dashboard.view', 'guardian.view', 'player.view', 'lead.view',
      'invoice.*', 'payment.*', 'refund.create', 'writeoff.create',
      'discount.*', 'wallet.*', 'report.*', 'communication.view', 'communication.create',
    ],
  },
  {
    name: 'Operations', slug: 'operations', isSystem: true,
    description: 'Registration, teams, scheduling, attendance and communications.',
    permissions: [
      'dashboard.view', 'guardian.view', 'guardian.create', 'guardian.edit',
      'player.*', 'lead.*', 'registration.*', 'team.*', 'coach.*',
      'season.*', 'location.*', 'agegroup.*', 'session.*', 'attendance.*',
      'document.*', 'communication.*', 'report.view', 'inventory.*',
    ],
  },
  {
    name: 'Technical Director', slug: 'technical-director', isSystem: true,
    description: 'Teams, coaching, scheduling, attendance and player development.',
    permissions: [
      'dashboard.view', 'player.view', 'player.edit', 'lead.view',
      'team.*', 'coach.*', 'session.*', 'attendance.*',
      'evaluation.*', 'report.view', 'communication.view',
    ],
  },
  {
    name: 'Coach', slug: 'coach', isSystem: true,
    description: 'Players, trials & leads, attendance, schedule and teams — no fees, invoices or payments anywhere. Writes the trial evaluations.',
    permissions: [
      'dashboard.view', 'player.view', 'team.view', 'session.view', 'lead.view',
      'attendance.view', 'attendance.create', 'attendance.edit',
      'evaluation.view', 'evaluation.create', 'evaluation.edit',
    ],
  },
  {
    name: 'Sales / Front Desk', slug: 'sales', isSystem: true,
    description: 'Leads, trials, registration and taking payments.',
    permissions: [
      'dashboard.view', 'guardian.view', 'guardian.create', 'player.view',
      'player.create', 'lead.*', 'registration.*', 'session.view',
      'invoice.view', 'invoice.create', 'payment.view', 'payment.create',
      'communication.view', 'communication.create', 'report.view',
    ],
  },
];
