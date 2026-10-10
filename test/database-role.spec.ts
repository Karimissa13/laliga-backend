import { claimDatabaseRole, deploymentRole } from '../src/config/database-role';

/** A tiny stand-in for the app_settings table. */
function fakeDb(initial?: unknown) {
  let value = initial;
  return {
    get value() { return value; },
    async query(sql: string, params?: any[]) {
      if (sql.startsWith('SELECT')) return value === undefined ? [] : [{ value }];
      if (sql.startsWith('INSERT') && value === undefined) value = JSON.parse(params![0]);
      return [];
    },
  } as any;
}

describe('deploymentRole', () => {
  it('reads the deployment kind', () => {
    expect(deploymentRole({ LALIGA_LIVE: 'true' } as any)).toBe('live');
    expect(deploymentRole({ LALIGA_DEMO: 'true' } as any)).toBe('demo');
    expect(deploymentRole({} as any)).toBeNull();
  });
});

describe('claimDatabaseRole', () => {
  it('marks an unmarked database', async () => {
    const db = fakeDb();
    await claimDatabaseRole(db, 'live');
    expect(db.value.role).toBe('live');
  });

  it('accepts its own database again', async () => {
    await expect(claimDatabaseRole(fakeDb({ role: 'demo' }), 'demo')).resolves.toBeUndefined();
  });

  it('a demo deploy refuses the live database, and the reverse', async () => {
    await expect(claimDatabaseRole(fakeDb({ role: 'live' }), 'demo')).rejects.toThrow(/live database — a demo deploy refuses/);
    await expect(claimDatabaseRole(fakeDb({ role: 'demo' }), 'live')).rejects.toThrow(/demo database — a live deploy refuses/);
  });
});
