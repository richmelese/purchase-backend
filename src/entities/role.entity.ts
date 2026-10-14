import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('roles')
export class RoleEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true })
  name: string;

  @Column({ type: 'text' })
  label: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'integer', default: 0 })
  is_system: number;

  @Column({ type: 'text', default: '{}' })
  permissions: string;

  @CreateDateColumn()
  created_at: string;

  @UpdateDateColumn()
  updated_at: string;
}
