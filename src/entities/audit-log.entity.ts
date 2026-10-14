import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('audit_log')
export class AuditLogEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn()
  at: string;

  @Column({ type: 'integer', nullable: true })
  user_id: number;

  @Column({ type: 'text', nullable: true })
  username: string;

  @Column({ type: 'text' })
  action: string;

  @Column({ type: 'text' })
  entity: string;

  @Column({ type: 'integer', nullable: true })
  entity_id: number;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'text', nullable: true })
  ip: string;
}
