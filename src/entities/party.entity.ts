import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryGeneratedColumn, Column, CreateDateColumn } from '../orm/decorators/column.decorator.js';

@Entity('parties')
export class PartyEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true, nullable: true })
  tin: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', default: 'Supplier' })
  type: string;

  @Column({ type: 'text', nullable: true })
  mrc1: string;

  @Column({ type: 'text', nullable: true })
  mrc2: string;

  @Column({ type: 'text', nullable: true })
  mrc3: string;

  @Column({ type: 'text', nullable: true })
  phone: string;

  @Column({ type: 'text', nullable: true })
  email: string;

  @Column({ type: 'text', nullable: true })
  address: string;

  /** Company Profile Other Detail Registration (Form 00001), stored as JSON. */
  @Column({ type: 'text', nullable: true })
  profile: string;

  @CreateDateColumn()
  created_at: string;
}
