import * as Joi from 'joi';

/** 12-factor config. Validated at boot — missing REQUIRED values fail fast (prd/16 §3). */
export interface AppConfig {
  nodeEnv: string;
  httpPort: number;
  apiPrefix: string;
  publicUrl: string;
  logLevel: string;

  jwtSecret: string;
  jwtAccessTtl: number;
  jwtRefreshTtl: number;

  databaseUrl: string;
  databaseSsl: boolean;

  redisUrl: string;
  eventBusDriver: 'memory' | 'redis-streams';
  eventBusStreamMaxlen: number;

  temporalAddress: string;
  temporalNamespace: string;
  temporalTaskQueue: string;
  runDriver: 'temporal' | 'inproc';
  requirePlanApproval: boolean;
  requireDeliveryApproval: boolean;

  /** reject inbound webhooks that fail signature/token verification (prd/09 §5). */
  webhookRequireSignature: boolean;

  /** use the iterative read→edit→run agent loop (needs a model with solid JSON/tool-calling; default off). */
  agentLoop: boolean;

  agentRuntimeUrl: string;
  litellmBaseUrl: string;
  litellmMasterKey: string;

  sandboxBackend: 'docker' | 'none';
  sandboxImage: string;
  sandboxWorkdir: string;
  sandboxDockerNetwork: string;

  /** base64 32-byte key for connector-secret encryption at rest; derived from JWT_SECRET if unset (dev). */
  secretsEncryptionKey: string;

  seedDemo: boolean;
  demoTenantName: string;
  demoAdminEmail: string;
  demoAdminPassword: string;
}

const schema = Joi.object({
  NODE_ENV: Joi.string().default('development'),
  CORE_HTTP_PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('/api/v1'),
  PRAXIS_PUBLIC_URL: Joi.string().uri().default('http://localhost:3000'),
  LOG_LEVEL: Joi.string().default('info'),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.number().default(900),
  JWT_REFRESH_TTL: Joi.number().default(1209600),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  DATABASE_SSL: Joi.boolean().truthy('true').falsy('false').default(false),

  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
  EVENT_BUS_DRIVER: Joi.string().valid('memory', 'redis-streams').default('redis-streams'),
  EVENT_BUS_STREAM_MAXLEN: Joi.number().default(100000),

  TEMPORAL_ADDRESS: Joi.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: Joi.string().default('default'),
  TEMPORAL_TASK_QUEUE: Joi.string().default('praxis-runs'),
  RUN_DRIVER: Joi.string().valid('temporal', 'inproc').default('inproc'),
  REQUIRE_PLAN_APPROVAL: Joi.boolean().truthy('true').falsy('false').default(true),
  REQUIRE_DELIVERY_APPROVAL: Joi.boolean().truthy('true').falsy('false').default(false),
  WEBHOOK_REQUIRE_SIGNATURE: Joi.boolean().truthy('true').falsy('false').default(true),
  AGENT_LOOP: Joi.boolean().truthy('true').falsy('false').default(false),

  AGENT_RUNTIME_URL: Joi.string().uri().default('http://localhost:8081'),
  LITELLM_BASE_URL: Joi.string().uri().default('http://localhost:4000'),
  LITELLM_MASTER_KEY: Joi.string().default('sk-praxis-dev'),

  SANDBOX_BACKEND: Joi.string().valid('docker', 'none').default('docker'),
  SANDBOX_IMAGE: Joi.string().default('praxis/sandbox:local'),
  SANDBOX_WORKDIR: Joi.string().default('/workspace'),
  SANDBOX_DOCKER_NETWORK: Joi.string().default('bridge'),

  SECRETS_ENCRYPTION_KEY: Joi.string().allow('').default(''),

  SEED_DEMO: Joi.boolean().truthy('true').falsy('false').default(true),
  DEMO_TENANT_NAME: Joi.string().default('Acme'),
  DEMO_ADMIN_EMAIL: Joi.string().email({ tlds: false }).default('admin@praxis.local'),
  DEMO_ADMIN_PASSWORD: Joi.string().default('ChangeMe123!'),
}).unknown(true);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const { value, error } = schema.validate(env, { abortEarly: false });
  if (error) {
    const lines = error.details.map((d) => `  - ${d.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`\nInvalid configuration:\n${lines}\n\nSee .env.example.\n`);
    process.exit(1);
  }
  return {
    nodeEnv: value.NODE_ENV,
    httpPort: value.CORE_HTTP_PORT,
    apiPrefix: value.API_PREFIX,
    publicUrl: value.PRAXIS_PUBLIC_URL,
    logLevel: value.LOG_LEVEL,
    jwtSecret: value.JWT_SECRET,
    jwtAccessTtl: value.JWT_ACCESS_TTL,
    jwtRefreshTtl: value.JWT_REFRESH_TTL,
    databaseUrl: value.DATABASE_URL,
    databaseSsl: value.DATABASE_SSL,
    redisUrl: value.REDIS_URL,
    eventBusDriver: value.EVENT_BUS_DRIVER,
    eventBusStreamMaxlen: value.EVENT_BUS_STREAM_MAXLEN,
    temporalAddress: value.TEMPORAL_ADDRESS,
    temporalNamespace: value.TEMPORAL_NAMESPACE,
    temporalTaskQueue: value.TEMPORAL_TASK_QUEUE,
    runDriver: value.RUN_DRIVER,
    requirePlanApproval: value.REQUIRE_PLAN_APPROVAL,
    requireDeliveryApproval: value.REQUIRE_DELIVERY_APPROVAL,
    webhookRequireSignature: value.WEBHOOK_REQUIRE_SIGNATURE,
    agentLoop: value.AGENT_LOOP,
    agentRuntimeUrl: value.AGENT_RUNTIME_URL,
    litellmBaseUrl: value.LITELLM_BASE_URL,
    litellmMasterKey: value.LITELLM_MASTER_KEY,
    sandboxBackend: value.SANDBOX_BACKEND,
    sandboxImage: value.SANDBOX_IMAGE,
    sandboxWorkdir: value.SANDBOX_WORKDIR,
    sandboxDockerNetwork: value.SANDBOX_DOCKER_NETWORK,
    secretsEncryptionKey: value.SECRETS_ENCRYPTION_KEY,
    seedDemo: value.SEED_DEMO,
    demoTenantName: value.DEMO_TENANT_NAME,
    demoAdminEmail: value.DEMO_ADMIN_EMAIL,
    demoAdminPassword: value.DEMO_ADMIN_PASSWORD,
  };
}

export const CONFIG = Symbol('APP_CONFIG');
