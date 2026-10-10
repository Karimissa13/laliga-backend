/**
 * Test fixtures for the phase 3–6 e2e suite (`npm run test:fixtures`, TEST database only).
 * The data lives in src/database/demo-data.ts, which also fills the demo site.
 */
import { seedDemoData } from '../../src/database/demo-data';

seedDemoData().catch((e) => { console.error(e); process.exit(1); });
