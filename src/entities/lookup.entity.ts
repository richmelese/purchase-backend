import { Entity } from '../orm/decorators/entity.decorator.js';
import { Column } from '../orm/decorators/column.decorator.js';

@Entity('lookups')
export class LookupEntity {
  @Column({ type: 'text', primary: true })
  list: string;

  @Column({ type: 'text', primary: true })
  value: string;

  @Column({ type: 'text' })
  label: string;

  @Column({ type: 'integer', default: 0 })
  sort: number;

  @Column({ type: 'integer', default: 0 })
  locked: number;
}
