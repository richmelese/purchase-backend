import { Entity } from '../orm/decorators/entity.decorator.js';
import { Column } from '../orm/decorators/column.decorator.js';

@Entity('vat_adjustments')
export class VatAdjustmentEntity {
  @Column({ type: 'integer', primary: true })
  fy: number;

  @Column({ type: 'integer', primary: true })
  fy_month: number;

  @Column({ type: 'integer', primary: true })
  line_no: number;

  @Column({ type: 'real', default: 0 })
  amount: number;
}
