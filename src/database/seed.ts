import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppDataSource } from './data-source';
import {
  AgeGroup, Location, Permission, Role, Season, Term, User, ProgramType,
} from './entities';
import { allPermissionKeys, DEFAULT_ROLES, MODULE_ACTIONS } from '../rbac/permissions.catalog';
import { livePasswordProblem } from '../config/live-passwords';

dotenv.config();

function expandRolePermissions(keys: string[], all: string[]): string[] {
  if (keys.includes('*')) return all;
  const out = new Set<string>();
  for (const k of keys) {
    if (k.endsWith('.*')) {
      const mod = k.slice(0, -2);
      (MODULE_ACTIONS[mod] || []).forEach((a) => out.add(`${mod}.${a}`));
    } else {
      out.add(k);
    }
  }
  return [...out];
}

async function run() {
  const ds = await AppDataSource.initialize();
  console.log('DB connected. Seeding…');

  // 1) Permissions ----------------------------------------------------------
  const permRepo = ds.getRepository(Permission);
  const allKeys = allPermissionKeys();
  for (const key of allKeys) {
    const [module, action] = key.split('.');
    const exists = await permRepo.findOne({ where: { key } });
    if (!exists) await permRepo.save(permRepo.create({ key, module, action }));
  }
  const permByKey = new Map((await permRepo.find()).map((p) => [p.key, p]));
  console.log(`  permissions: ${permByKey.size}`);

  // 2) Roles ----------------------------------------------------------------
  const roleRepo = ds.getRepository(Role);
  for (const def of DEFAULT_ROLES) {
    let role = await roleRepo.findOne({ where: { slug: def.slug }, relations: { permissions: true } });
    const keys = expandRolePermissions(def.permissions, allKeys);
    const perms = keys.map((k) => permByKey.get(k)).filter(Boolean);
    if (!role) {
      role = roleRepo.create({
        name: def.name, slug: def.slug, description: def.description,
        isSystem: def.isSystem, permissions: perms as Permission[],
      });
    } else {
      role.permissions = perms as Permission[];
      role.description = def.description;
    }
    await roleRepo.save(role);
  }
  console.log(`  roles: ${DEFAULT_ROLES.length}`);

  // 3) Super admin user -----------------------------------------------------
  const userRepo = ds.getRepository(User);
  const superRole = await roleRepo.findOne({ where: { slug: 'super-admin' } });
  // The live system (LALIGA_LIVE=true) gets no generic admin with a known
  // password — only the named super admins below.
  const LIVE = process.env.LALIGA_LIVE === 'true';
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@laligaacademy.local').toLowerCase();
  let admin = await userRepo.findOne({ where: { email: adminEmail } });
  if (LIVE && !process.env.SEED_ADMIN_EMAIL) {
    console.log('  live system: no generic admin account');
  } else if (!admin) {
    const adminProblem = LIVE ? livePasswordProblem(process.env.SEED_ADMIN_PASSWORD) : null;
    if (adminProblem) {
      throw new Error(`Live setup: SEED_ADMIN_PASSWORD ${adminProblem}. Set a new one in the hosting settings, or remove SEED_ADMIN_EMAIL.`);
    }
    admin = userRepo.create({
      fullName: 'Academy Administrator',
      email: adminEmail,
      passwordHash: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'Admin@12345', 10),
      roleId: superRole!.id,
    });
    await userRepo.save(admin);
  }
  if (!LIVE || process.env.SEED_ADMIN_EMAIL) console.log(`  super admin: ${adminEmail}`);

  // Named owner account for the academy's operations manager.
  const ownerEmail = (process.env.SEED_OWNER_EMAIL || 'karim@inspirat.us').toLowerCase();
  if (!(await userRepo.findOne({ where: { email: ownerEmail } }))) {
    // On the live system the first password is the one Karim types into the
    // host's settings (never a default written in the code).
    const ownerProblem = LIVE ? livePasswordProblem(process.env.SEED_OWNER_PASSWORD) : null;
    if (ownerProblem) {
      throw new Error(`Live setup: SEED_OWNER_PASSWORD ${ownerProblem}. Set it in the hosting settings before the first deploy.`);
    }
    await userRepo.save(userRepo.create({
      fullName: process.env.SEED_OWNER_NAME || 'Karim Issa',
      email: ownerEmail,
      passwordHash: await bcrypt.hash(process.env.SEED_OWNER_PASSWORD || 'LaLiga@2026!', 10),
      roleId: superRole!.id,
    }));
  }
  console.log(`  super admin: ${ownerEmail}`);

  // Second super admin (operations). Created without a usable password: a super
  // admin sets it under Settings → Staff accounts, and Michel changes it after.
  const michelEmail = (process.env.SEED_SECOND_ADMIN_EMAIL || 'michel@inspirat.us').toLowerCase();
  const michel = await userRepo.findOne({ where: { email: michelEmail } });
  if (!michel) {
    await userRepo.save(userRepo.create({
      fullName: process.env.SEED_SECOND_ADMIN_NAME || 'Michel',
      email: michelEmail,
      passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
      roleId: superRole!.id,
    }));
  } else if (michel.roleId !== superRole!.id) {
    await userRepo.update(michel.id, { roleId: superRole!.id });
  }
  console.log(`  super admin: ${michelEmail} (password set from Settings → Staff accounts)`);

  // 4) Reference data (observed from the live academy) ----------------------
  const locRepo = ds.getRepository(Location);
  for (const name of ['Abu Dhabi - Active Al Maryah', 'Zayed Sports City']) {
    if (!(await locRepo.findOne({ where: { name } }))) {
      await locRepo.save(locRepo.create({ name, emirate: 'Abu Dhabi', isActive: true }));
    }
  }

  const agRepo = ds.getRepository(AgeGroup);
  // The categories the academy runs in 2026/27. Level is NOT a property of an age
  // category — U12 alone has HPC, Advanced White and Development teams — so it
  // lives on the team. Gap years (U7, U15, U17) play up; see placeInCategory().
  const ACADEMY_CATEGORIES = ['U6', 'U8', 'U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U16', 'U18'];
  for (const code of ACADEMY_CATEGORIES) {
    const existing = await agRepo.findOne({ where: { code } });
    if (!existing) {
      await agRepo.save(agRepo.create({ code, name: code.replace('U', 'U-'), isActive: true }));
    } else if (!existing.isActive || existing.level) {
      await agRepo.update(existing.id, { isActive: true, level: null as any });
    }
  }
  // Categories from earlier versions that the academy does not run are retired,
  // not deleted, so any child still pointing at one keeps a valid reference.
  for (const ag of await agRepo.find()) {
    if (!ACADEMY_CATEGORIES.includes(ag.code) && ag.isActive) {
      await agRepo.update(ag.id, { isActive: false });
    }
  }

  const seasonRepo = ds.getRepository(Season);
  let season = await seasonRepo.findOne({ where: { name: 'Season 10' } });
  if (!season) {
    season = await seasonRepo.save(seasonRepo.create({
      name: 'Season 10', isActive: true,
      startDate: '2026-08-31', endDate: '2027-06-11', cutoffDate: '2026-12-31',
    }));
  }
  const termRepo = ds.getRepository(Term);
  const terms = [
    ['Term 1', '2026-08-31', '2026-12-11', 15],
    ['Term 2', '2027-01-04', '2027-03-08', 10],
    ['Term 3', '2027-04-05', '2027-06-11', 10],
  ] as const;
  for (const [name, s, e, w] of terms) {
    if (!(await termRepo.findOne({ where: { name, seasonId: season.id } }))) {
      await termRepo.save(termRepo.create({
        seasonId: season.id, name, type: ProgramType.TERM, startDate: s, endDate: e, weeks: w,
      }));
    }
  }
  console.log('  reference data: locations, age groups, Season 10 + 3 terms');

  // 5) Reference sequences -------------------------------------------------
  // Created here so a fresh database issues PR-/PL-/TR-/LA- numbers from 1 even
  // before the API has booted. Families are NOT created here — see seed-academy.ts.
  for (const seq of ['guardian_ref_seq', 'player_ref_seq', 'lead_ref_seq', 'invoice_ref_seq']) {
    await ds.query(`CREATE SEQUENCE IF NOT EXISTS ${seq} START 1`);
  }

  await ds.destroy();
  console.log('Seed complete.');
}

run().catch((e) => { console.error(e); process.exit(1); });
