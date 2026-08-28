import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkItemState } from '@praxis/event-schemas';

@Entity('work_item')
@Index(['projectId', 'sourceConnectorId', 'externalId'], { unique: true })
export class WorkItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenantId!: string;

  @Column('uuid')
  projectId!: string;

  @Column({ default: 'manual' })
  sourceConnectorId!: string;

  @Column()
  externalId!: string;

  @Column({ type: 'text', nullable: true })
  externalUrl!: string | null;

  @Column()
  title!: string;

  @Column({ type: 'text', default: '' })
  bodyMd!: string;

  @Column({ type: 'jsonb', default: [] })
  acceptanceCriteria!: string[];

  @Column({ type: 'jsonb', default: [] })
  labels!: string[];

  @Column({ type: 'varchar', default: 'normal' })
  priority!: 'low' | 'normal' | 'high' | 'urgent';

  @Column({ type: 'text', nullable: true })
  assigneeExt!: string | null;

  @Column({ type: 'jsonb', default: [] })
  attachments!: unknown[];

  @Column({ type: 'jsonb', default: {} })
  raw!: Record<string, unknown>;

  @Column({ type: 'varchar', default: 'received' })
  state!: WorkItemState;

  @Column({ type: 'jsonb', nullable: true })
  triage!: {
    type?: string;
    size?: string;
    verdict?: string;
    reasoning?: string;
    questions?: string[];
  } | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
