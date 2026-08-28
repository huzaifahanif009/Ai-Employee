/**
 * Load .env before config validation. Checks the repo root then the service dir,
 * so `npm run -w @praxis/core ...` (cwd = services/core) and container runs both work.
 * Real env vars always win (12-factor).
 */
import { config as dotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const candidates = [
  resolve(process.cwd(), '../../.env'), // repo root when cwd = services/core
  resolve(process.cwd(), '.env'), // service dir / container workdir
  resolve(__dirname, '../../../../.env'), // dist depth fallback
];

for (const path of candidates) {
  if (existsSync(path)) dotenv({ path, override: false });
}
