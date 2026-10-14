import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('bank_transactions')
export class BankTransactionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  bank_account_id: number;

  @Column({ type: 'integer' })
  row_no: number;

  @Column({ type: 'text' })
  bank_code: string;

  @Column({ type: 'text', nullable: true })
  value_date: string;

  @Column({ type: 'text', nullable: true })
  purchase_code_1: string;

  @Column({ type: 'text', nullable: true })
  purchase_code_2: string;

  @Column({ type: 'real', default: 0 })
  debit: number;

  @Column({ type: 'text', nullable: true })
  purchase_remark: string;

  @Column({ type: 'text', nullable: true })
  sales_code_1: string;

  @Column({ type: 'text', nullable: true })
  sales_code_2: string;

  @Column({ type: 'real', default: 0 })
  credit: number;

  @Column({ type: 'text', nullable: true })
  sales_remark: string;

  @CreateDateColumn()
  created_at: string;

  @Column({ type: 'text', default: 'datetime("now")' })
  updated_at: string;
}
