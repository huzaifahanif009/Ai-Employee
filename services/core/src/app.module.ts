import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig, CONFIG } from './config/config';
import { ConfigModule } from './config/config.module';
import { ALL_ENTITIES } from './database/entities';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { AiModule } from './ai/ai.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { ConnectorsModule } from './connectors/connectors.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { EventsModule } from './events/events.module';
import { HealthController } from './health/health.controller';
import { IntakeModule } from './intake/intake.module';
import { ModelModule } from './model/model.module';
import { ProjectsModule } from './projects/projects.module';
import { RunsModule } from './runs/runs.module';
import { SandboxModule } from './sandbox/sandbox.module';
import { ToolsModule } from './tools/tools.module';
import { WorkItemsModule } from './work-items/work-items.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => ({
        type: 'postgres' as const,
        url: cfg.databaseUrl,
        ssl: cfg.databaseSsl ? { rejectUnauthorized: false } : false,
        entities: ALL_ENTITIES,
        synchronize: false,
        autoLoadEntities: false,
        logging: cfg.logLevel === 'debug' ? ['error', 'warn'] : ['error'],
      }),
    }),
    AuthModule,
    EventsModule,
    ProjectsModule,
    WorkItemsModule,
    AiModule,
    ApprovalsModule,
    ConnectorsModule,
    SandboxModule,
    ModelModule,
    ToolsModule,
    RunsModule,
    IntakeModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
