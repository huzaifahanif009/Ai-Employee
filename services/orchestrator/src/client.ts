/**
 * Helper the core service will use (Phase 2) to start a RunWorkflow instead of
 * the in-process demo driver.
 */
import { Client, Connection } from '@temporalio/client';
import type { RunWorkflowInput } from './shared';

export async function startRunWorkflow(input: RunWorkflowInput): Promise<{ workflowId: string; runId: string }> {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  });
  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
  });
  const workflowId = `run-${input.runId}`;
  const handle = await client.workflow.start('RunWorkflow', {
    args: [input],
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'praxis-runs',
    workflowId,
  });
  return { workflowId, runId: handle.firstExecutionRunId };
}
