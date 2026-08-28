import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * prd/11 / ADR-0006 — the source of truth for a Run's timeline.
 * `seq` is gap-free per run (assigned under an advisory lock).
 */
@Entity('run_event')
@Index(['runId', 'seq'], { unique: true })
@Index(['tenantId', 'ts'])
export class RunEventEntity {
  @PrimaryGeneratedColumn('increment')
  id!: string;

  @Column('uuid')
  tenantId!: string;

  @Column('uuid')
  runId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column()
  type!: string;

  @Column({ type: 'int', default: 1 })
  schemaVersion!: number;

  @Column({ type: 'text', nullable: true })
  traceId!: string | null;

  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  actor!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz' })
  ts!: Date;

  @Column({ type: 'boolean', default: false })
  published!: boolean;
}
