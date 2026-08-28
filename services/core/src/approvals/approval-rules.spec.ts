import { requiresNote } from './approval-rules';

describe('approval rules', () => {
  it('requires a note to reject', () => {
    expect(requiresNote('reject')).toBe(true);
  });
  it('requires a note to override a review block', () => {
    expect(requiresNote('deliver_anyway')).toBe(true);
  });
  it('does not require a note to approve', () => {
    expect(requiresNote('approve')).toBe(false);
  });
  it('does not require a note to grant more budget', () => {
    expect(requiresNote('grant_budget')).toBe(false);
  });
  it('does not require a note to request a re-plan', () => {
    expect(requiresNote('request_replan')).toBe(false);
  });
});
