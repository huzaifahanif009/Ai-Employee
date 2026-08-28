import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventBus } from '@praxis/contracts';
import { AppConfig, CONFIG } from '../config/config';
import { RunEventEntity } from '../database/entities';
import { MemoryEventBus } from './event-bus.memory';
import { RedisStreamsEventBus } from './event-bus.redis-streams';
import { RunEventsService } from './run-events.service';
import { SseController } from './sse.controller';
import { EVENT_BUS } from './tokens';

export { EVENT_BUS };

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([RunEventEntity])],
  controllers: [SseController],
  providers: [
    {
      provide: EVENT_BUS,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig): EventBus =>
        cfg.eventBusDriver === 'memory'
          ? new MemoryEventBus()
          : new RedisStreamsEventBus(cfg.redisUrl, cfg.eventBusStreamMaxlen),
    },
    RunEventsService,
  ],
  exports: [EVENT_BUS, RunEventsService],
})
export class EventsModule implements OnModuleDestroy {
  constructor() {}
  async onModuleDestroy() {
    /* bus closed by DI scope teardown in tests; prod relies on process exit */
  }
}
