/**
 * PdfGenerationJobProcessor — isolamento per azienda.
 *
 * Il job riceve `tenantId` nei dati ma interrogava il documento per solo `id`
 * (`findUnique`), sul client Prisma SENZA estensione RLS e fuori da un
 * TenantContext: un id di un'altra azienda veniva renderizzato e depositato su
 * S3 sotto la chiave dell'azienda richiedente.
 */

import { PdfGenerationJobProcessor } from './pdf-generation.job'

const TENANT_RICHIEDENTE = 'tenant-A-uuid'

function makeDeps(firDiAltraAzienda: { id: string; tenantId: string }) {
  const prisma: any = {
    fIR: {
      // Si comporta come Postgres: applica davvero il filtro passato.
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === firDiAltraAzienda.id &&
            (where.tenantId === undefined || where.tenantId === firDiAltraAzienda.tenantId)
            ? firDiAltraAzienda
            : null
        )
      ),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(where.id === firDiAltraAzienda.id ? firDiAltraAzienda : null)
      ),
    },
    mUDReport: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  }

  const pdfService: any = { generateFIRPDF: jest.fn().mockResolvedValue(Buffer.from('pdf')) }
  const s3Service: any = {
    generatePdfKey: jest.fn(() => 'chiave'),
    getCachedPdf: jest.fn().mockResolvedValue(null),
    uploadPdfWithCache: jest.fn().mockResolvedValue('https://s3/pdf'),
  }
  const logger: any = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }

  return { prisma, pdfService, s3Service, logger }
}

describe('PdfGenerationJobProcessor — isolamento per azienda', () => {
  it('non genera il PDF di un FIR di un’altra azienda', async () => {
    const firAltrui = { id: 'fir-di-azienda-B', tenantId: 'tenant-B-uuid' }
    const { prisma, pdfService, s3Service, logger } = makeDeps(firAltrui)
    const processor = new PdfGenerationJobProcessor(pdfService, s3Service, prisma, logger)

    const job: any = {
      id: 'job-1',
      data: {
        tenantId: TENANT_RICHIEDENTE,
        documentType: 'fir',
        documentIds: [firAltrui.id],
        requestedBy: 'user-uuid',
      },
      updateProgress: jest.fn(),
    }

    const result = await processor.process(job)

    expect(pdfService.generateFIRPDF).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.generatedPdfs).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
  })

  it('genera il PDF di un FIR della propria azienda', async () => {
    const firProprio = { id: 'fir-di-azienda-A', tenantId: TENANT_RICHIEDENTE }
    const { prisma, pdfService, s3Service, logger } = makeDeps(firProprio)
    const processor = new PdfGenerationJobProcessor(pdfService, s3Service, prisma, logger)

    const job: any = {
      id: 'job-2',
      data: {
        tenantId: TENANT_RICHIEDENTE,
        documentType: 'fir',
        documentIds: [firProprio.id],
        requestedBy: 'user-uuid',
      },
      updateProgress: jest.fn(),
    }

    const result = await processor.process(job)

    expect(pdfService.generateFIRPDF).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    expect(result.generatedPdfs).toHaveLength(1)
  })
})
