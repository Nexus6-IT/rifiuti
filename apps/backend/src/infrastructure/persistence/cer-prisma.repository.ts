/**
 * CER Prisma Repository - Infrastructure Layer
 * Implementazione concreta del repository CER con Prisma ORM.
 * Il catalogo CER è dato GLOBALE (non tenant-scoped): usa il client base.
 */

import { Injectable } from '@nestjs/common'
import { CERCode } from '../../domain/cer/entities/cer-code.entity'
import { ICERRepository, CERSearchFilters } from '../../domain/cer/repositories/cer-repository.interface'
import { PrismaService } from './prisma.service'

@Injectable()
export class CERPrismaRepository implements ICERRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(code: string): Promise<CERCode | null> {
    const record = await this.prisma.cERCode.findUnique({ where: { code } })
    return record ? this.toDomain(record) : null
  }

  async findById(id: string): Promise<CERCode | null> {
    const record = await this.prisma.cERCode.findUnique({ where: { id } })
    return record ? this.toDomain(record) : null
  }

  async search(keyword: string, filters?: CERSearchFilters): Promise<CERCode[]> {
    const records = await this.prisma.cERCode.findMany({
      where: {
        ...this.filterWhere(filters),
        OR: [
          { code: { contains: keyword, mode: 'insensitive' } },
          { description: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      orderBy: { code: 'asc' },
      take: 50,
    })
    return records.map((r) => this.toDomain(r))
  }

  async findByCategory(category: string): Promise<CERCode[]> {
    const records = await this.prisma.cERCode.findMany({
      where: { category },
      orderBy: { code: 'asc' },
    })
    return records.map((r) => this.toDomain(r))
  }

  async findAllPericolosi(): Promise<CERCode[]> {
    const records = await this.prisma.cERCode.findMany({
      where: { isPericoloso: true },
      orderBy: { code: 'asc' },
    })
    return records.map((r) => this.toDomain(r))
  }

  /**
   * Lista paginata del catalogo (con filtri opzionali categoria/pericoloso).
   */
  async findPaginated(
    page: number,
    limit: number,
    filters?: CERSearchFilters,
  ): Promise<{ items: CERCode[]; total: number }> {
    const where = this.filterWhere(filters)
    const [records, total] = await Promise.all([
      this.prisma.cERCode.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cERCode.count({ where }),
    ])
    return { items: records.map((r) => this.toDomain(r)), total }
  }

  async save(cer: CERCode): Promise<void> {
    await this.prisma.cERCode.upsert({
      where: { code: cer.code },
      create: {
        code: cer.code,
        description: cer.description,
        isPericoloso: cer.isPericoloso,
        category: cer.category,
        subcategory: cer.subcategory ?? '',
      },
      update: {
        description: cer.description,
        isPericoloso: cer.isPericoloso,
        category: cer.category,
        subcategory: cer.subcategory ?? '',
      },
    })
  }

  async saveMany(cers: CERCode[]): Promise<void> {
    for (const cer of cers) {
      await this.save(cer)
    }
  }

  async count(): Promise<number> {
    return this.prisma.cERCode.count()
  }

  async exists(code: string): Promise<boolean> {
    return (await this.prisma.cERCode.count({ where: { code } })) > 0
  }

  private filterWhere(filters?: CERSearchFilters): Record<string, unknown> {
    const where: Record<string, unknown> = {}
    if (filters?.pericoloso !== undefined) where['isPericoloso'] = filters.pericoloso
    if (filters?.category) where['category'] = filters.category
    return where
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
