/**
 * CER Prisma Repository - Infrastructure Layer
 * Implementazione concreta del repository CER con Prisma ORM
 */

import { Injectable } from '@nestjs/common'
import { CERCode } from '../../domain/cer/entities/cer-code.entity'
import { ICERRepository, CERSearchFilters } from '../../domain/cer/repositories/cer-repository.interface'
import { PrismaService } from './prisma.service'

@Injectable()
export class CERPrismaRepository implements ICERRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(code: string): Promise<CERCode | null> {
    // TODO: CER codes table doesn't exist in schema yet
    // Currently cerCode is stored as a string in FIR table
    // This will need a proper CER codes table added to schema.prisma
    return null
  }

  async findById(id: string): Promise<CERCode | null> {
    // TODO: CER codes table doesn't exist in schema yet
    return null
  }

  async search(keyword: string, filters?: CERSearchFilters): Promise<CERCode[]> {
    // TODO: CER codes table doesn't exist in schema yet
    return []
  }

  async findByCategory(category: string): Promise<CERCode[]> {
    // TODO: CER codes table doesn't exist in schema yet
    return []
  }

  async findAllPericolosi(): Promise<CERCode[]> {
    // TODO: CER codes table doesn't exist in schema yet
    return []
  }

  async save(cer: CERCode): Promise<void> {
    // TODO: CER codes table doesn't exist in schema yet
    // Implementation needed when CER codes table is added
  }

  async saveMany(cers: CERCode[]): Promise<void> {
    // TODO: CER codes table doesn't exist in schema yet
    // Implementation needed when CER codes table is added
  }

  async count(): Promise<number> {
    // TODO: CER codes table doesn't exist in schema yet
    return 0
  }

  async exists(code: string): Promise<boolean> {
    // TODO: CER codes table doesn't exist in schema yet
    return false
  }

  private toDomain(record: any): CERCode {
    return CERCode.reconstitute({
      id: record.id,
      code: record.code,
      description: record.description,
      isPericoloso: record.isPericoloso,
      category: record.category,
      subcategory: record.subcategory || undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })
  }
}
