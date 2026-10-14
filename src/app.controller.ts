import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator.js';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'purchase-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
