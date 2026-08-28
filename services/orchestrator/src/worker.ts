/**
 * Temporal worker bootstrap. Phase 1 skeleton — not started by default
 * (core's RUN_DRIVER=inproc drives the demo). Set RUN_DRIVER=temporal + run this in Phase 2.
 */
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'praxis-runs';

  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  // eslint-disable-next-line no-console
  console.log(`orchestrator worker: ${address} ns=${namespace} queue=${taskQueue}`);
  await worker.run();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
