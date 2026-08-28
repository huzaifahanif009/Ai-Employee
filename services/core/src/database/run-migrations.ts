import { AppDataSource } from './data-source';

/** `npm run -w @praxis/core migration:run` / `node dist/database/run-migrations.js` */
async function main() {
  await AppDataSource.initialize();
  const applied = await AppDataSource.runMigrations({ transaction: 'all' });
  // eslint-disable-next-line no-console
  console.log(
    applied.length ? `Applied: ${applied.map((m) => m.name).join(', ')}` : 'No pending migrations.',
  );
  await AppDataSource.destroy();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
