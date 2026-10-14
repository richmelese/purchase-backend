import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('stock_issues')
export class StockIssueEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true })
  issue_no: string;

  @Column({ type: 'text' })
  date: string;

  @Column({ type: 'integer' })
  product_id: number;

  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'text', nullable: true })
  department: string;

  @Column({ type: 'text', nullable: true })
  purpose: string;

  @Column({ type: 'text', nullable: true })
  approved_by: string;

  @CreateDateColumn()
  created_at: string;
}
