import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { livePasswordProblem } from '../config/live-passwords';

/**
 * Owner password reset at deploy time, for when the owner can't sign in (the first password came
 * from SEED_OWNER_PASSWORD, which the host stores write-only). The owner types the new password
 * into OWNER_PASSWORD_RESET in the hosting settings; the next deploy sets it, signs the owner out
 * everywhere and writes the audit log. Same rules as the first password (12+, no demo password).
 *
 * While the setting exists every deploy re-applies it (a no-op when unchanged), so it must be
 * deleted once the owner has signed in — otherwise it would undo a later change made in the app.
 */
export const FROM_SEED = 'from-SEED_OWNER_PASSWORD';

/**
 * The new password: OWNER_PASSWORD_RESET itself, or — when it is the switch FROM_SEED (no password
 * in it, so it can be set by anyone with access) — the value the owner typed into SEED_OWNER_PASSWORD.
 */
export function ownerResetPassword(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env.OWNER_PASSWORD_RESET;
  if (v === FROM_SEED) {
    if (!env.SEED_OWNER_PASSWORD) throw new Error(`OWNER_PASSWORD_RESET=${FROM_SEED} but SEED_OWNER_PASSWORD is not set.`);
    return env.SEED_OWNER_PASSWORD;
  }
  return v || undefined;
}

export async function applyOwnerPasswordReset(ds: DataSource, ownerEmail: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const next = ownerResetPassword(env);
  if (!next) return null;
  const problem = livePasswordProblem(next);
  if (problem) throw new Error(`OWNER_PASSWORD_RESET ${problem}.`);

  const [owner] = await ds.query(`SELECT id, "passwordHash" FROM users WHERE lower(email) = $1`, [ownerEmail.toLowerCase()]);
  if (!owner) throw new Error(`OWNER_PASSWORD_RESET: there is no account for ${ownerEmail}.`);
  if (await bcrypt.compare(next, owner.passwordHash)) {
    return 'owner password: already set from OWNER_PASSWORD_RESET (delete that setting now)';
  }

  await ds.transaction(async (m) => {
    await m.query(`UPDATE users SET "passwordHash" = $1, "updatedAt" = now() WHERE id = $2`, [await bcrypt.hash(next, 10), owner.id]);
    await m.query(`UPDATE refresh_tokens SET "revokedAt" = now() WHERE "userId" = $1 AND "revokedAt" IS NULL`, [owner.id]);
    await m.query(
      `INSERT INTO audit_logs ("actorType", action, entity, "entityId", metadata) VALUES ('system', 'auth.owner_password_reset', 'user', $1, $2::jsonb)`,
      [owner.id, JSON.stringify({ source: 'OWNER_PASSWORD_RESET hosting setting, applied at deploy' })],
    );
  });
  return 'owner password: RESET from OWNER_PASSWORD_RESET — sign in, then delete OWNER_PASSWORD_RESET and SEED_OWNER_PASSWORD';
}
