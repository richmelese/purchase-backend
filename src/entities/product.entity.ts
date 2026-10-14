import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('products')
export class ProductEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true })
  code: string;

  @Column({ type: 'text' })
  name_en: string;

  @Column({ type: 'text', nullable: true })
  name_am: string;

  @Column({ type: 'text', nullable: true })
  category: string;

  @Column({ type: 'text', nullable: true })
  brand: string;

  @Column({ type: 'text', nullable: true })
  model: string;

  @Column({ type: 'text', nullable: true })
  serial_no: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'integer', default: 7 })
  unit: number;

  @Column({ type: 'integer', default: 1 })
  track_stock: number;

  @Column({ type: 'real', default: 0 })
  min_stock: number;

  @Column({ type: 'real', default: 0 })
  opening_stock: number;

  @Column({ type: 'real', default: 0 })
  purchase_price: number;

  @Column({ type: 'real', default: 0 })
  selling_price: number;

  @CreateDateColumn()
  created_at: string;
}
