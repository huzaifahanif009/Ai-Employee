import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** prd/14 §8 — append-only, hash-chained. */
@Entity('audit_log')
@Index(['tenantId', 'ts'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('increment')
  id!: string;

  @Column('uuid')
  tenantId!: string;

  @Column({ type: 'jsonb' })
  actor!: { kind: string; id: string; display?: string };

  @Column()
  action!: string;

  @Column({ type: 'jsonb' })
  target!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz' })
  ts!: Date;

  @Column({ type: 'text', nullable: true })
  prevHash!: string | null;

  @Column({ type: 'text' })
  hash!: string;
}
