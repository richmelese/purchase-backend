import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column } from '../orm/decorators/column.decorator.js';

@Entity('invoice_lines')
export class InvoiceLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  invoice_id: number;

  @Column({ type: 'integer' })
  line_no: number;

  @Column({ type: 'integer', nullable: true })
  product_id: number;

  @Column({ type: 'text', nullable: true })
  product_code: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'integer', nullable: true })
  unit: number;

  @Column({ type: 'integer' })
  tx_type: number;

  @Column({ type: 'text' })
  transaction_type: string;

  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'real' })
  unit_price: number;

  @Column({ type: 'real' })
  total: number;

  @Column({ type: 'real', default: 0 })
  excise_rate: number;

  @Column({ type: 'real', default: 0 })
  excise_amount: number;

  @Column({ type: 'real', default: 0 })
  vatable_service_fee: number;

  @Column({ type: 'real' })
  taxable_amount: number;

  @Column({ type: 'real' })
  vat_amount: number;

  @Column({ type: 'real', default: 0 })
  non_vatable_fee: number;

  @Column({ type: 'real' })
  line_total: number;
}
