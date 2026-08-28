import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly ds: DataSource) {}

  @Public()
  @Get('healthz')
  live() {
    return { status: 'ok', service: 'core', ts: new Date().toISOString() };
  }

  @Public()
  @Get('readyz')
  async ready() {
    const checks: Record<string, 'ok' | 'down'> = {};
    try {
      await this.ds.query('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'down';
    }
    const ok = Object.values(checks).every((c) => c === 'ok');
    return { status: ok ? 'ok' : 'degraded', checks };
  }
}
