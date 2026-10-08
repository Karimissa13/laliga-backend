import { shouldSynchronize } from '../src/config/db-sync';

describe('shouldSynchronize', () => {
  it('honours an explicit true even in production (Docker first boot)', () => {
    expect(shouldSynchronize({ NODE_ENV: 'production', DB_SYNCHRONIZE: 'true' } as any)).toBe(true);
  });

  it('honours an explicit false in development', () => {
    expect(shouldSynchronize({ NODE_ENV: 'development', DB_SYNCHRONIZE: 'false' } as any)).toBe(false);
  });

  it('defaults off in production when the flag is absent', () => {
    expect(shouldSynchronize({ NODE_ENV: 'production' } as any)).toBe(false);
  });

  it('defaults on outside production when the flag is absent', () => {
    expect(shouldSynchronize({ NODE_ENV: 'development' } as any)).toBe(true);
    expect(shouldSynchronize({} as any)).toBe(true);
  });

  it('treats an empty flag as absent', () => {
    expect(shouldSynchronize({ NODE_ENV: 'production', DB_SYNCHRONIZE: '' } as any)).toBe(false);
  });
});
