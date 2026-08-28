import { PraxisError } from '@praxis/contracts';
import { canTransition, RunState, TERMINAL_RUN_STATES } from '@praxis/event-schemas';

export function assertTransition(from: RunState, to: RunState): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new PraxisError(
      'CONFLICT',
      `Illegal run transition ${from} → ${to}`,
      409,
      { from, to },
    );
  }
}

export const isTerminal = (s: RunState): boolean => TERMINAL_RUN_STATES.includes(s);
