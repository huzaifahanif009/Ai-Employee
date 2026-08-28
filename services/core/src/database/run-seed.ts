import 'reflect-metadata';
import '../config/load-env';
import * as argon2 from 'argon2';
import { loadConfig } from '../config/config';
import { AppDataSource } from './data-source';
import {
  MembershipEntity,
  ProjectEntity,
  TenantEntity,
  UserEntity,
  WorkItemEntity,
} from './entities';

/** Idempotent demo seed (prd/10 §6). `npm run -w @praxis/core seed`. */
async function main() {
  const cfg = loadConfig();
  if (!cfg.seedDemo) {
    // eslint-disable-next-line no-console
    console.log('SEED_DEMO=false — nothing to do.');
    return;
  }
  await AppDataSource.initialize();
  const tenants = AppDataSource.getRepository(TenantEntity);
  const users = AppDataSource.getRepository(UserEntity);
  const memberships = AppDataSource.getRepository(MembershipEntity);
  const projects = AppDataSource.getRepository(ProjectEntity);
  const workItems = AppDataSource.getRepository(WorkItemEntity);

  let tenant = await tenants.findOne({ where: { slug: slugify(cfg.demoTenantName) } });
  if (!tenant) {
    tenant = await tenants.save(
      tenants.create({ name: cfg.demoTenantName, slug: slugify(cfg.demoTenantName) }),
    );
  }

  let admin = await users.findOne({ where: { email: cfg.demoAdminEmail.toLowerCase() } });
  if (!admin) {
    admin = await users.save(
      users.create({
        email: cfg.demoAdminEmail.toLowerCase(),
        name: 'Demo Admin',
        passwordHash: await argon2.hash(cfg.demoAdminPassword, { type: argon2.argon2id }),
      }),
    );
  }

  const hasMembership = await memberships.findOne({
    where: { tenantId: tenant.id, userId: admin.id },
  });
  if (!hasMembership) {
    await memberships.save(
      memberships.create({ tenantId: tenant.id, userId: admin.id, role: 'owner' }),
    );
  }

  let project = await projects.findOne({ where: { tenantId: tenant.id, slug: 'demo-app' } });
  if (!project) {
    project = await projects.save(
      projects.create({
        tenantId: tenant.id,
        name: 'Demo App',
        slug: 'demo-app',
        repoRef: { provider: 'github', owner: 'demo', name: 'app' },
        baseBranch: 'main',
        verifyPipeline: { build: 'npm run build', lint: 'npm run lint', unit: 'npm test' },
        intake: { mode: 'manual', labelAllowlist: ['praxis'] },
        policyPreset: 'Balanced',
        budgets: { usd: 5, iterations: 12, wallMs: 2_700_000 },
      }),
    );
  }

  const existingWi = await workItems.findOne({
    where: { projectId: project.id, sourceConnectorId: 'manual', externalId: 'demo-001' },
  });
  if (!existingWi) {
    await workItems.save(
      workItems.create({
        tenantId: tenant.id,
        projectId: project.id,
        sourceConnectorId: 'manual',
        externalId: 'demo-001',
        title: 'Add retry policy to notification sending',
        bodyMd:
          'The notification `send()` call has no retry. Wrap it with an exponential backoff policy (max 3 attempts) and add a unit test.',
        acceptanceCriteria: [
          'send() retries up to 3 times with backoff',
          'retry count is configurable',
          'a unit test covers the retry path',
        ],
        labels: ['praxis', 'bug'],
        priority: 'high',
        state: 'ready',
      }),
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded: tenant=${tenant.slug} admin=${cfg.demoAdminEmail} project=${project.slug} workItem=demo-001`,
  );
  await AppDataSource.destroy();
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 't';
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
