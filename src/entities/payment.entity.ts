import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('payments')
export class PaymentEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  invoice_id: number;

  @Column({ type: 'text' })
  date: string;

  @Column({ type: 'real' })
  amount: number;

  @Column({ type: 'text', nullable: true })
  method: string;

  @Column({ type: 'text', nullable: true })
  reference: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: string;
}
