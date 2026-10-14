import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true })
  username: string;

  @Column({ type: 'text' })
  full_name: string;

  @Column({ type: 'text' })
  password_hash: string;

  @Column({ type: 'text', default: 'user' })
  role: string;

  @Column({ type: 'integer', nullable: true })
  role_id?: number;

  @Column({ type: 'integer', default: 1 })
  access_all_parties: number;

  @Column({ type: 'integer', default: 1 })
  active: number;

  /** Set for company (portal) accounts: the supplier / customer this login belongs to. */
  @Column({ type: 'integer', nullable: true })
  party_id?: number;

  /** 1 = must choose a new password before using the app (generated / reset passwords). */
  @Column({ type: 'integer', default: 0 })
  must_change_password: number;

  @Column({ type: 'text', nullable: true })
  last_login: string;

  @CreateDateColumn()
  created_at: string;
}
