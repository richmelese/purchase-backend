import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('invoices')
export class InvoiceEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  kind: 'P' | 'S';

  @Column({ type: 'text', unique: true })
  invoice_no: string;

  @Column({ type: 'text' })
  payment_type: string;

  @Column({ type: 'text' })
  vat_category: string;

  @Column({ type: 'text', default: 'G' })
  calendar_type: string;

  @Column({ type: 'integer', nullable: true })
  party_id: number;

  @Column({ type: 'text', nullable: true })
  party_tin: string;

  @Column({ type: 'text', nullable: true })
  party_name: string;

  @Column({ type: 'text' })
  date: string;

  @Column({ type: 'integer' })
  fy: number;

  @Column({ type: 'integer' })
  fy_month: number;

  @Column({ type: 'text' })
  receipt_type: string;

  @Column({ type: 'text', nullable: true })
  mrc_number: string;

  @Column({ type: 'text' })
  vat_receipt_no: string;

  @Column({ type: 'text', default: 'Not Reported' })
  report_status: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'real', default: 0 })
  total_amount: number;

  @Column({ type: 'real', default: 0 })
  excise_amount: number;

  @Column({ type: 'real', default: 0 })
  vatable_service_fee: number;

  @Column({ type: 'real', default: 0 })
  taxable_amount: number;

  @Column({ type: 'real', default: 0 })
  vat_amount: number;

  @Column({ type: 'real', default: 0 })
  non_vatable_fee: number;

  @Column({ type: 'real', default: 0 })
  grand_total: number;

  @Column({ type: 'text', nullable: true })
  wh_receipt_type: string;

  @Column({ type: 'text', nullable: true })
  wh_receipt_no: string;

  @Column({ type: 'text', nullable: true })
  wh_receipt_date: string;

  @Column({ type: 'real', default: 0 })
  wh_paid: number;

  @Column({ type: 'text', nullable: true })
  created_by: string;

  @Column({ type: 'text', nullable: true })
  updated_by: string;

  @CreateDateColumn()
  created_at: string;

  @UpdateDateColumn()
  updated_at: string;
}
