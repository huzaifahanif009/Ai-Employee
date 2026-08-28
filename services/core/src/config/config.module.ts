import { Global, Module } from '@nestjs/common';
import { AppConfig, CONFIG, loadConfig } from './config';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [CONFIG],
})
export class ConfigModule {}
