export interface ColumnOptions {
  type?: 'text' | 'integer' | 'real' | 'blob' | 'boolean' | 'datetime';
  name?: string;
  primary?: boolean;
  nullable?: boolean;
  default?: any;
  unique?: boolean;
}

export const COLUMNS_METADATA_KEY = Symbol('COLUMNS_METADATA');

export function Column(options: ColumnOptions = {}): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const columns = Reflect.getMetadata(COLUMNS_METADATA_KEY, target.constructor) || [];
    columns.push({
      property: String(propertyKey),
      columnName: options.name || String(propertyKey),
      type: options.type || 'text',
      primary: !!options.primary,
      nullable: options.nullable !== false,
      default: options.default,
      unique: !!options.unique,
    });
    Reflect.defineMetadata(COLUMNS_METADATA_KEY, columns, target.constructor);
  };
}

export function PrimaryGeneratedColumn(options: ColumnOptions = {}): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    Column({ ...options, primary: true, type: 'integer' })(target, propertyKey);
  };
}

export function PrimaryColumn(options: ColumnOptions = {}): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    Column({ ...options, primary: true })(target, propertyKey);
  };
}

export function CreateDateColumn(options: ColumnOptions = {}): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    Column({ ...options, type: 'datetime', default: () => 'datetime("now")' })(target, propertyKey);
  };
}

export function UpdateDateColumn(options: ColumnOptions = {}): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    Column({ ...options, type: 'datetime', default: () => 'datetime("now")' })(target, propertyKey);
  };
}

export function getColumnsMetadata(target: any) {
  return Reflect.getMetadata(COLUMNS_METADATA_KEY, target) || [];
}
