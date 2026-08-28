import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ApprovalType =
  | 'plan'
  | 'risky_action'
  | 'budget'
  | 'review_block'
  | 'policy_exception'
  | 'non_progress'
  | 'delivery';

export type ApprovalState = 'open' | 'approved' | 'rejected' | 'expired' | 'auto_resolved';

@Entity('approval')
@Index(['tenantId', 'state'])
@Index(['tenantId', 'slaAt'], { where: `"state" = 'open'` })
export class ApprovalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenantId!: string;

  @Column('uuid')
  runId!: string;

  @Column({ type: 'uuid', nullable: true })
  runStepId!: string | null;

  @Column({ type: 'varchar' })
  type!: ApprovalType;

  @Column({ type: 'varchar', default: 'open' })
  state!: ApprovalState;

  @Column({ type: 'jsonb', default: {} })
  evidence!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  actionPreview!: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  slaAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  decidedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  decisionNote!: string | null;

  @Column({ type: 'varchar', default: 'dashboard' })
  channel!: 'dashboard' | 'slack' | 'api';
}
