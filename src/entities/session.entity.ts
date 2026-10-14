import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryColumn, Column, CreateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('sessions')
export class SessionEntity {
  @PrimaryColumn({ type: 'text' })
  token_hash: string;

  @Column({ type: 'integer' })
  user_id: number;

  @Column({ type: 'integer' })
  expires_at: number;

  @CreateDateColumn()
  created_at: string;
}
