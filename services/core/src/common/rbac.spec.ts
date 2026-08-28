import { ALL_CAPABILITIES, roleHas } from './rbac';

describe('rbac matrix', () => {
  it('owner has every capability', () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(roleHas('owner', cap)).toBe(true);
    }
  });

  it('viewer can only read the dashboard', () => {
    expect(roleHas('viewer', 'dashboard:read')).toBe(true);
    expect(roleHas('viewer', 'run:start')).toBe(false);
    expect(roleHas('viewer', 'approval:decide')).toBe(false);
  });

  it('operator can start/control runs but not approve or write policy', () => {
    expect(roleHas('operator', 'run:start')).toBe(true);
    expect(roleHas('operator', 'run:control')).toBe(true);
    expect(roleHas('operator', 'approval:decide')).toBe(false);
    expect(roleHas('operator', 'policy:write')).toBe(false);
  });

  it('maintainer approves but cannot promote configs or manage members', () => {
    expect(roleHas('maintainer', 'approval:decide')).toBe(true);
    expect(roleHas('maintainer', 'approval:override')).toBe(true);
    expect(roleHas('maintainer', 'agent:promote')).toBe(false);
    expect(roleHas('maintainer', 'member:write')).toBe(false);
  });

  it('only owner has tenant:admin', () => {
    expect(roleHas('owner', 'tenant:admin')).toBe(true);
    expect(roleHas('admin', 'tenant:admin')).toBe(false);
  });
});
