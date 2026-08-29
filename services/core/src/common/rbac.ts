/** prd/14 §3 — RBAC. Roles → capabilities. Enforced on every mutating route. */

export type Role = 'owner' | 'admin' | 'maintainer' | 'operator' | 'viewer' | 'service';

export type Capability =
  | 'dashboard:read'
  | 'run:start'
  | 'run:control'
  | 'approval:decide'
  | 'approval:override'
  | 'project:write'
  | 'agent:write'
  | 'agent:promote'
  | 'policy:write'
  | 'connector:write'
  | 'provider:write'
  | 'member:write'
  | 'tenant:admin';

const MATRIX: Record<Role, Capability[]> = {
  owner: [
    'dashboard:read', 'run:start', 'run:control', 'approval:decide', 'approval:override',
    'project:write', 'agent:write', 'agent:promote', 'policy:write', 'connector:write',
    'provider:write', 'member:write', 'tenant:admin',
  ],
  admin: [
    'dashboard:read', 'run:start', 'run:control', 'approval:decide', 'approval:override',
    'project:write', 'agent:write', 'agent:promote', 'policy:write', 'connector:write',
    'provider:write', 'member:write',
  ],
  maintainer: [
    'dashboard:read', 'run:start', 'run:control', 'approval:decide', 'approval:override',
    'agent:write',
  ],
  operator: ['dashboard:read', 'run:start', 'run:control'],
  viewer: ['dashboard:read'],
  service: ['dashboard:read', 'run:start', 'run:control', 'approval:decide'],
};

export function roleHas(role: Role, cap: Capability): boolean {
  return MATRIX[role]?.includes(cap) ?? false;
}

/** All capabilities — used by a test to assert every route declares one. */
export const ALL_CAPABILITIES: Capability[] = Array.from(
  new Set(Object.values(MATRIX).flat()),
);
