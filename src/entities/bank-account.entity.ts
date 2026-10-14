import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('bank_accounts')
export class BankAccountEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', unique: true })
  account_no: number;

  @Column({ type: 'text' })
  bank_name: string;

  @Column({ type: 'text', nullable: true })
  account_name: string;

  @Column({ type: 'text', nullable: true })
  account_number: string;

  @Column({ type: 'text', default: 'ETB' })
  currency: string;

  @Column({ type: 'real', default: 0 })
  opening_balance: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: string;
}
