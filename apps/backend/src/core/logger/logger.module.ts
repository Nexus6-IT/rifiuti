import { Global, Module } from '@nestjs/common';
import { LoggerService } from './logger.service';

/**
 * Global logger module
 *
 * This module is marked as @Global so LoggerService
 * is available throughout the application without
 * needing to import LoggerModule in every feature module.
 */
@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
