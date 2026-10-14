import { Inject } from '@nestjs/common';

export function getRepositoryToken(entity: any): string {
  const name = typeof entity === 'function' ? entity.name : String(entity);
  return `${name}Repository`;
}

export function InjectRepository(entity: any): ParameterDecorator {
  return Inject(getRepositoryToken(entity));
}
