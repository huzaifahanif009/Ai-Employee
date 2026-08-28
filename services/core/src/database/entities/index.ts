export * from './tenant.entity';
export * from './user.entity';
export * from './membership.entity';
export * from './project.entity';
export * from './work-item.entity';
export * from './run.entity';
export * from './run-event.entity';
export * from './approval.entity';
export * from './audit-log.entity';
export * from './model-call.entity';
export * from './tool-call.entity';
export * from './connector.entity';

import { TenantEntity } from './tenant.entity';
import { UserEntity } from './user.entity';
import { MembershipEntity } from './membership.entity';
import { ProjectEntity } from './project.entity';
import { WorkItemEntity } from './work-item.entity';
import { RunEntity } from './run.entity';
import { RunEventEntity } from './run-event.entity';
import { ApprovalEntity } from './approval.entity';
import { AuditLogEntity } from './audit-log.entity';
import { ModelCallEntity } from './model-call.entity';
import { ToolCallEntity } from './tool-call.entity';
import { ConnectorEntity } from './connector.entity';

export const ALL_ENTITIES = [
  TenantEntity,
  UserEntity,
  MembershipEntity,
  ProjectEntity,
  WorkItemEntity,
  RunEntity,
  RunEventEntity,
  ApprovalEntity,
  AuditLogEntity,
  ModelCallEntity,
  ToolCallEntity,
  ConnectorEntity,
];
