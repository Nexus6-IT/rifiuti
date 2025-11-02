/**
 * Prisma Service - Database connection wrapper
 * Injectable service for NestJS DI
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }

  async cleanDatabase() {
    // For testing: clean all tables
    if (process.env.NODE_ENV === 'test') {
      const tables = await this.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables WHERE schemaname='public'
      `

      for (const { tablename } of tables) {
        if (tablename !== '_prisma_migrations') {
          await this.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE;`)
        }
      }
    }
  }
}
