export interface EntityOptions {
  name?: string;
}

export const ENTITY_METADATA_KEY = Symbol('ENTITY_METADATA');

export function Entity(nameOrOptions?: string | EntityOptions): ClassDecorator {
  return (target: Function) => {
    const tableName = typeof nameOrOptions === 'string'
      ? nameOrOptions
      : nameOrOptions?.name || target.name.toLowerCase().replace(/entity$/, '');
    Reflect.defineMetadata(ENTITY_METADATA_KEY, { tableName, target }, target);
  };
}

export function getEntityMetadata(target: any) {
  return Reflect.getMetadata(ENTITY_METADATA_KEY, target);
}
