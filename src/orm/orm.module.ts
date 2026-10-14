import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { DataSource, DataSourceOptions } from './data-source.js';
import { Repository } from './repository.js';
import { getRepositoryToken } from './decorators/inject-repository.decorator.js';

@Global()
@Module({})
export class OrmModule {
  public static forRoot(options: DataSourceOptions): DynamicModule {
    const dataSource = new DataSource(options);
    dataSource.initialize();

    const dataSourceProvider: Provider = {
      provide: DataSource,
      useValue: dataSource,
    };

    return {
      module: OrmModule,
      providers: [dataSourceProvider],
      exports: [dataSourceProvider],
    };
  }

  public static forFeature(entities: any[] = []): DynamicModule {
    const providers: Provider[] = entities.map((entity) => ({
      provide: getRepositoryToken(entity),
      useFactory: (dataSource: DataSource) => new Repository(entity, dataSource),
      inject: [DataSource],
    }));

    return {
      module: OrmModule,
      providers,
      exports: providers,
    };
  }
}
