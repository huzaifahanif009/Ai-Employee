import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface VerifyPipeline {
  build?: string;
  lint?: string;
  unit?: string;
  integration?: string;
  e2e?: string;
  composeFile?: string;
}

export interface IntakeConfig {
  mode: 'auto' | 'manual';
  labelAllowlist: string[];
  assigneeIsBot?: boolean;
  keyword?: string;
}

@Entity('project')
@Index(['tenantId', 'slug'], { unique: true })
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenantId!: string;

  @Column()
  name!: string;

  @Column()
  slug!: string;

  @Column({ type: 'jsonb', nullable: true })
  repoRef!: { provider: string; owner: string; name: string; path?: string } | null;

  @Column({ type: 'uuid', nullable: true })
  vcsConnectorId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  trackerConnectorId!: string | null;

  /** last tracker poll cursor (ISO ts) */
  @Column({ type: 'text', nullable: true })
  intakeCursor!: string | null;

  @Column({ default: 'main' })
  baseBranch!: string;

  @Column({ type: 'text', nullable: true })
  pathScope!: string | null;

  @Column({ type: 'jsonb', default: {} })
  verifyPipeline!: VerifyPipeline;

  @Column({ type: 'jsonb', default: { mode: 'manual', labelAllowlist: [] } })
  intake!: IntakeConfig;

  @Column({ default: 'praxis/{{tracker-key}}-{{slug}}' })
  branchTemplate!: string;

  @Column({ default: 'Balanced' })
  policyPreset!: 'Conservative' | 'Balanced' | 'Autonomous';

  @Column({ type: 'jsonb', default: {} })
  budgets!: Record<string, number>;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
