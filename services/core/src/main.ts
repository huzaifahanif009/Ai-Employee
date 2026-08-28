import 'reflect-metadata';
import './config/load-env';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix(cfg.apiPrefix, { exclude: ['healthz', 'readyz'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('Praxis Core API')
    .setDescription('Control-plane API — prd/13')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(`${cfg.apiPrefix}/docs`, app, SwaggerModule.createDocument(app, swagger));

  await app.listen(cfg.httpPort, '0.0.0.0');
  new Logger('Bootstrap').log(
    `core listening on :${cfg.httpPort}${cfg.apiPrefix}  (run driver: ${cfg.runDriver}, bus: ${cfg.eventBusDriver})`,
  );
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
