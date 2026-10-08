/**
 * Passwords written in this repository (README, docker-compose, .env.example, seeds, tests).
 * They are public once the code is on GitHub, so the live system (LALIGA_LIVE=true) refuses them.
 */
export const DEMO_PASSWORDS = ['LaLiga@2026!', 'Admin@12345', 'Coach@12345'];

/** Why a first password can't be used on the live system, or null when it can. */
export function livePasswordProblem(value: string | undefined): string | null {
  const v = value || '';
  if (v.length < 12) return 'must be at least 12 characters';
  if (DEMO_PASSWORDS.some((d) => d.toLowerCase() === v.toLowerCase())) return 'is a demo password written in the code';
  return null;
}
