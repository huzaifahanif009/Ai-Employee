import 'reflect-metadata';
import '../config/load-env';
import { DataSource } from 'typeorm';
import { loadConfig } from '../config/config';
import { ALL_ENTITIES } from './entities';
import { Init1724900000000 } from './migrations/1724900000000-init';
import { ModelCall1725100000000 } from './migrations/1725100000000-model-call';
import { ToolCall1725200000000 } from './migrations/1725200000000-tool-call';

const cfg = loadConfig();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: cfg.databaseUrl,
  ssl: cfg.databaseSsl ? { rejectUnauthorized: false } : false,
  entities: ALL_ENTITIES,
  migrations: [Init1724900000000, ModelCall1725100000000, ToolCall1725200000000],
  migrationsRun: false,
  synchronize: false,
  logging: cfg.logLevel === 'debug' ? ['query', 'error'] : ['error'],
});
