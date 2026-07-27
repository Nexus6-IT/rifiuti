import { HttpException } from '@nestjs/common'
import { RentriCodificheController } from './rentri-codifiche.controller'
import {
  RentriCodificheSyncService,
  AllineamentoRentriGiaInCorsoError,
} from '../../application/reference-data/rentri-codifiche-sync.service'
import { RentriCerSyncService } from '../../application/reference-data/rentri-cer-sync.service'
import { CERCode } from '../../domain/cer/entities/cer-code.entity'
import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

/**
 * Repository CER finto in memoria — stessa forma di `MockCERRepository` in
 * `rentri-cer-sync.service.spec.ts` (non condivisa: replica minima per
 * questo file, come indicato dal brief del Task 6).
 */
class MockCERRepository implements ICERRepository {
  private cers = new Map<string, CERCode>()

  seed(cer: CERCode) {
    this.cers.set(cer.code, cer)
  }

  get(code: string): CERCode | undefined {
    return this.cers.get(code)
  }

  async findByCode(code: string): Promise<CERCode | null> {
    return this.cers.get(code) ?? null
  }

  async findById(): Promise<CERCode | null> {
    return null
  }

  async search(): Promise<CERCode[]> {
    return []
  }

  async findByCategory(): Promise<CERCode[]> {
    return []
  }

  async findAllPericolosi(): Promise<CERCode[]> {
    return []
  }

  async findPaginated(): Promise<{ items: CERCode[]; total: number }> {
    return { items: [], total: 0 }
  }

  async save(cer: CERCode): Promise<void> {
    this.cers.set(cer.code, cer)
  }

  async saveMany(cers: CERCode[]): Promise<void> {
    for (const cer of cers) await this.save(cer)
  }

  async count(): Promise<number> {
    return this.cers.size
  }

  async exists(code: string): Promise<boolean> {
    return this.cers.has(code)
  }

  async isUtilizzabilePerNuovoFormulario(code: string): Promise<boolean> {
    return this.cers.get(code)?.presenteInRentri === true
  }

  async upsertFromRentri(data: {
    code: string
    description: string
    isPericoloso: boolean
  }): Promise<void> {
    const esistente = this.cers.get(data.code)
    this.cers.set(
      data.code,
      CERCode.reconstitute({
        id: esistente?.id ?? data.code,
        code: data.code,
        description: data.description,
        isPericoloso: data.isPericoloso,
        category: esistente?.category ?? data.code.slice(0, 2),
        subcategory: esistente?.subcategory ?? undefined,
        createdAt: esistente?.createdAt ?? new Date(),
        updatedAt: new Date(),
        presenteInRentri: true,
        rimossoDaRentriAl: null,
        fonte: 'rentri',
      })
    )
  }

  async marcaRimossoDaRentriSeAttivo(code: string, rimossoAl: Date): Promise<boolean> {
    const esistente = this.cers.get(code)
    if (!esistente || !esistente.presenteInRentri) return false
    this.cers.set(
      code,
      CERCode.reconstitute({
        id: esistente.id,
        code: esistente.code,
        description: esistente.description,
        isPericoloso: esistente.isPericoloso,
        category: esistente.category,
        subcategory: esistente.subcategory ?? undefined,
        createdAt: esistente.createdAt,
        updatedAt: new Date(),
        presenteInRentri: false,
        rimossoDaRentriAl: rimossoAl,
        fonte: esistente.fonte,
      })
    )
    return true
  }

  async listTuttiICodici(): Promise<string[]> {
    return Array.from(this.cers.keys())
  }
}

/** Mock minimo di `CERPrismaRepository` per i test che non riguardano la diagnostica. */
function cerRepositoryMock() {
  return { listNonPresenti: jest.fn().mockResolvedValue([]) }
}

const user: CurrentUserPayload = {
  id: 'u1',
  email: 'admin@example.com',
  tenantId: 'tenant-1',
  role: 'ADMIN',
  permissions: [],
}

describe('RentriCodificheController', () => {
  it('chiama sync.allineaTutto con user.tenantId e risponde { eseguito: true }', async () => {
    const sync = { allineaTutto: jest.fn().mockResolvedValue(undefined) }
    const controller = new RentriCodificheController(sync as any, cerRepositoryMock() as any)

    const risposta = await controller.allinea(user)

    expect(sync.allineaTutto).toHaveBeenCalledWith('tenant-1')
    expect(risposta).toEqual({ eseguito: true })
  })

  // 409 e NON 423: nel resto del progetto il 423 significa «RENTRI ha bandito
  // il chiamante» e da quel codice dipendono ritentativi, stato del formulario
  // e allarmi. Qui verso l'ente non è partita alcuna richiesta.
  it('traduce AllineamentoRentriGiaInCorsoError in HttpException 409 con lo stesso messaggio', async () => {
    const erroreOriginale = new AllineamentoRentriGiaInCorsoError()
    const sync = { allineaTutto: jest.fn().mockRejectedValue(erroreOriginale) }
    const controller = new RentriCodificheController(sync as any, cerRepositoryMock() as any)

    let errore: unknown
    try {
      await controller.allinea(user)
    } catch (e) {
      errore = e
    }

    expect(errore).toBeInstanceOf(HttpException)
    expect((errore as HttpException).getStatus()).toBe(409)
    expect((errore as HttpException).message).toBe(erroreOriginale.message)
  })

  describe('non-distruttività end-to-end attraverso il controller (IL TEST CHE CONTA)', () => {
    it('un CER referenziato da un FIR storico sopravvive quando RENTRI smette di confermarlo: marcato, non cancellato', async () => {
      const repository = new MockCERRepository()
      repository.seed(
        CERCode.create({
          code: '20 03 01',
          description: 'Rifiuti urbani non differenziati',
          isPericoloso: false,
          category: '20',
        })
      )

      const client = { codiciEer: jest.fn() }
      const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

      const cerSync = new RentriCerSyncService(client as any, repository, logger as any)
      const codificheSempliciSync = { allinea: jest.fn().mockResolvedValue([]) }
      const territorialiSync = { allinea: jest.fn().mockResolvedValue([]) }

      const syncService = new RentriCodificheSyncService(
        cerSync,
        codificheSempliciSync as any,
        territorialiSync as any,
        logger as any
      )
      const controller = new RentriCodificheController(syncService, cerRepositoryMock() as any)

      // Primo ciclo: RENTRI conferma ancora il codice.
      client.codiciEer.mockResolvedValueOnce([
        {
          code: '200301',
          name: 'Rifiuti urbani non differenziati',
          properties: { pericoloso: false },
        },
      ])
      await expect(controller.allinea(user)).resolves.toEqual({ eseguito: true })

      // Secondo ciclo: l'ente smette di restituirlo.
      client.codiciEer.mockResolvedValueOnce([])
      await expect(controller.allinea(user)).resolves.toEqual({ eseguito: true })

      const cer = repository.get('20 03 01')
      expect(cer).toBeDefined() // non cancellato
      expect(cer?.presenteInRentri).toBe(false)
      expect(cer?.rimossoDaRentriAl).not.toBeNull()
      await expect(repository.exists('20 03 01')).resolves.toBe(true)
      await expect(repository.isUtilizzabilePerNuovoFormulario('20 03 01')).resolves.toBe(false)
    })
  })

  describe('GET /rentri/codifiche/diagnostica (Task 7 Step 2)', () => {
    it('nessun ciclo concluso in questo processo: ultimoAllineamento null, codiciAggiornati 0', async () => {
      const sync = { ottieniUltimoEsito: jest.fn().mockReturnValue(null) }
      const cerRepository = { listNonPresenti: jest.fn().mockResolvedValue([]) }
      const controller = new RentriCodificheController(sync as any, cerRepository as any)

      const risposta = await controller.diagnostica()

      expect(risposta).toEqual({
        ultimoAllineamento: null,
        codiciAggiornati: 0,
        codiciNonPresenti: [],
      })
    })

    it('somma nuovi+aggiornati di CER, codifiche semplici e territoriali dell’ultimo ciclo', async () => {
      const quando = new Date('2026-07-26T00:00:00.000Z')
      const sync = {
        ottieniUltimoEsito: jest.fn().mockReturnValue({
          quando,
          cer: { nuovi: 2, aggiornati: 3, rimossi: 1 },
          codificheSemplici: [{ tabella: 'stati-fisici', nuovi: 1, aggiornati: 0, rimossi: 0 }],
          territoriali: [{ tabella: 'comuni', nuovi: 0, aggiornati: 4, rimossi: 0 }],
        }),
      }
      const cerRepository = {
        listNonPresenti: jest
          .fn()
          .mockResolvedValue([
            { code: '20 03 01', description: 'Rifiuti urbani', rimossoDaRentriAl: quando },
          ]),
      }
      const controller = new RentriCodificheController(sync as any, cerRepository as any)

      const risposta = await controller.diagnostica()

      // 2+3 (CER) + 1 (semplici) + 4 (territoriali) = 10
      expect(risposta.codiciAggiornati).toBe(10)
      expect(risposta.ultimoAllineamento).toBe(quando.toISOString())
      expect(risposta.codiciNonPresenti).toEqual([
        {
          code: '20 03 01',
          description: 'Rifiuti urbani',
          rimossoDaRentriAl: quando.toISOString(),
        },
      ])
    })

    it('un passo fallito (null nell’esito) non contribuisce al totale', async () => {
      const quando = new Date()
      const sync = {
        ottieniUltimoEsito: jest.fn().mockReturnValue({
          quando,
          cer: null, // il passo CER è fallito in quel ciclo
          codificheSemplici: [{ tabella: 'stati-fisici', nuovi: 1, aggiornati: 0, rimossi: 0 }],
          territoriali: null,
        }),
      }
      const cerRepository = { listNonPresenti: jest.fn().mockResolvedValue([]) }
      const controller = new RentriCodificheController(sync as any, cerRepository as any)

      const risposta = await controller.diagnostica()

      expect(risposta.codiciAggiornati).toBe(1)
    })
  })
})
