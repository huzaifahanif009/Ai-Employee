import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RunFailureCategory, RunState } from '@praxis/event-schemas';

export interface RunTotals {
  tokens: number;
  costUsd: number;
  toolCalls: number;
  filesChanged: number;
  wallMs: number;
}

@Entity('run')
@Index(['tenantId', 'state'])
@Index(['projectId', 'createdAt'])
export class RunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenantId!: string;

  @Column('uuid')
  projectId!: string;

  @Column('uuid')
  workItemId!: string;

  @Column({ type: 'int', default: 1 })
  seq!: number;

  @Column({ type: 'varchar', default: 'queued' })
  state!: RunState;

  @Column({ type: 'varchar', nullable: true })
  failureCategory!: RunFailureCategory | null;

  @Column({ type: 'text', nullable: true })
  failureMessage!: string | null;

  @Column({ type: 'text', nullable: true })
  branchName!: string | null;

  @Column({ type: 'text', nullable: true })
  baseSha!: string | null;

  @Column({ type: 'text', nullable: true })
  headSha!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  prRef!: { number: number; url: string; state: string } | null;

  @Column({ type: 'jsonb', nullable: true })
  sandboxId!: string | null;

  @Column({ type: 'jsonb', default: {} })
  budgetSnapshot!: Record<string, number>;

  @Column({
    type: 'jsonb',
    default: { tokens: 0, costUsd: 0, toolCalls: 0, filesChanged: 0, wallMs: 0 },
  })
  totals!: RunTotals;

  @Column({ type: 'text', nullable: true })
  temporalWorkflowId!: string | null;

  @Column({ type: 'text', nullable: true })
  temporalRunId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
