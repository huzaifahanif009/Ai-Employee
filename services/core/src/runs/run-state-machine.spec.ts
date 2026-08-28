import { canTransition } from '@praxis/event-schemas';
import { assertTransition, isTerminal } from './run-state-machine';

describe('run state machine', () => {
  it('allows the happy path', () => {
    const path = [
      'queued',
      'planning',
      'executing',
      'verifying',
      'reviewing',
      'delivering',
      'succeeded',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => assertTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it('rejects an illegal jump', () => {
    expect(() => assertTransition('queued', 'delivering')).toThrow(/Illegal run transition/);
    expect(canTransition('succeeded', 'executing')).toBe(false);
  });

  it('allows cancel from any non-terminal state', () => {
    for (const s of ['queued', 'planning', 'executing', 'verifying', 'reviewing'] as const) {
      expect(canTransition(s, 'cancelled')).toBe(true);
    }
  });

  it('knows terminal states', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('executing')).toBe(false);
  });

  it('treats same-state as a no-op', () => {
    expect(() => assertTransition('executing', 'executing')).not.toThrow();
  });
});
