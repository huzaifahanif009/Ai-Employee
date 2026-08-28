import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from '../../common/rbac';

@Entity('membership')
@Index(['tenantId', 'userId'], { unique: true })
export class MembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenantId!: string;

  @Column('uuid')
  userId!: string;

  @Column({ type: 'varchar' })
  role!: Role;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
