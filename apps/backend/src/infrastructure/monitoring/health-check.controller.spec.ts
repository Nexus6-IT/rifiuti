/**
 * Health Check Controller - TDD Tests
 *
 * Unico controller su `/health` (consolidato da `api/health/health.controller.ts`,
 * rimosso perché duplicava la rotta). Il contratto della basic health check è
 * quello osservato in produzione — consumato dallo smoke test di deploy e
 * dall'healthcheck Docker — e non deve cambiare. `/health/detailed` invece deve
 * risultare protetto da JwtAuthGuard + RolesGuard (SUPER_ADMIN/ADMIN).
 */

import { Test, TestingModule } from '@nestjs/testing'
import { Reflector } from '@nestjs/core'
import { HealthCheckController } from './health-check.controller'
import { PrismaService } from '../database/prisma.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'

describe('HealthCheckController', () => {
  let controller: HealthCheckController
  let prisma: { $queryRaw: jest.Mock }

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthCheckController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile()

    controller = module.get<HealthCheckController>(HealthCheckController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('healthCheck (GET /health)', () => {
    it('should return the production contract shape', async () => {
      const result = await controller.healthCheck()

      expect(result.status).toBe('ok')
      expect(result.timestamp).toBeDefined()
      expect(result.service).toBe('wasteflow-backend')
      expect(result.version).toBe('0.1.0')
    })

    it('should return an ISO timestamp', async () => {
      const result = await controller.healthCheck()
      const timestamp = new Date(result.timestamp)

      expect(timestamp).toBeInstanceOf(Date)
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should not expose uptime/memory (moved to /health/detailed)', async () => {
      const result = await controller.healthCheck()

      expect(result).not.toHaveProperty('uptime')
      expect(result).not.toHaveProperty('memory')
    })
  })

  describe('databaseHealth (GET /health/db)', () => {
    it('should report connected when the query succeeds', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

      const result = await controller.databaseHealth()

      expect(result).toEqual({ status: 'ok', database: 'connected' })
    })

    it('should report disconnected when the query fails', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'))

      const result = await controller.databaseHealth()

      expect(result.status).toBe('error')
      expect(result.database).toBe('disconnected')
    })
  })

  describe('detailedHealth (GET /health/detailed)', () => {
    it('should require SUPER_ADMIN or ADMIN via RolesGuard metadata', () => {
      const reflector = new Reflector()
      const requiredRoles = reflector.get<string[]>(
        ROLES_KEY,
        HealthCheckController.prototype.detailedHealth
      )

      expect(requiredRoles).toEqual(['SUPER_ADMIN', 'ADMIN'])
    })

    it('should be wired behind JwtAuthGuard and RolesGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        HealthCheckController.prototype.detailedHealth
      )

      expect(guards).toBeDefined()
      const guardInstances = (guards as unknown[]).map((Guard: any) => Guard)
      expect(guardInstances).toContain(JwtAuthGuard)
      expect(guardInstances).toContain(RolesGuard)
    })

    it('should still return the detailed metrics payload when invoked', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

      const result = await controller.detailedHealth()

      expect(result.status).toBe('healthy')
      expect(result.environment).toBeDefined()
      expect(result.uptime).toBeGreaterThanOrEqual(0)
      expect(result.memory).toHaveProperty('rss')
      expect(result.database).toEqual({ status: 'ok', database: 'connected' })
    })
  })
})
