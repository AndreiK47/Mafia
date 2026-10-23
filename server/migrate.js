import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { getPool } from './db.js';

const migrations = [
  ['001_initial', '../migrations/001_initial.sql'],
  ['002_extended_roles', '../migrations/002_extended_roles.sql'],
  ['003_bots', '../migrations/003_bots.sql'],
  ['004_verdict_phase', '../migrations/004_verdict_phase.sql'],
  ['005_sheriff_shoot', '../migrations/005_sheriff_shoot.sql'],
  ['006_multiplayer_stability', '../migrations/006_multiplayer_stability.sql'],
  ['007_room_host_lease', '../migrations/007_room_host_lease.sql'],
  ['008_room_lifecycle', '../migrations/008_room_lifecycle.sql'],
  ['009_private_action_reports', '../migrations/009_private_action_reports.sql'],
];
const db = getPool();
try {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(80) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
  for (const [version, file] of migrations) {
    const [rows] = await db.execute('SELECT version FROM schema_migrations WHERE version = ?', [version]);
    if (rows.length) { console.log(`${version} already applied`); continue; }
    const sql = (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
    for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await db.query(statement);
    await db.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    console.log(`Applied ${version}`);
  }
} finally { await db.end(); }
