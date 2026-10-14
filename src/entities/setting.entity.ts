import { Entity } from '../orm/decorators/entity.decorator.js';
import { PrimaryColumn, Column } from '../orm/decorators/column.decorator.js';

@Entity('settings')
export class SettingEntity {
  @PrimaryColumn({ type: 'text' })
  key: string;

  @Column({ type: 'text', nullable: true })
  value: string;
}
