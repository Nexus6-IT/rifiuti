import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { DomainError } from '../../core/domain/errors'
import { LoggerService } from '../../core/logger/logger.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { impostaTenant } from '../../infrastructure/persistence/prisma-tenant-transazione'

export interface RegistroVista {
  id: string
  unitaLocaleId: string | null
  /** Valorizzato solo se il registro ha una sede. */
  numIscrSito: string | null
  denominazione: string
  codice: string
  attivo: boolean
  /** true se la sede del registro è la sede principale dell'azienda. */
  principale: boolean
}

export class RegistroNonTrovatoError extends DomainError {
  constructor() {
    super('Registro non trovato o non attivo.')
    this.name = 'RegistroNonTrovatoError'
  }
}

/** Più registri e nessuna sede principale: la scelta spetta all'utente. */
export class RegistroDaIndicareError extends DomainError {
  constructor() {
    super("L'azienda ha più registri e nessuna sede principale: indica il registro.")
    this.name = 'RegistroDaIndicareError'
  }
}

export class RegistroSenzaSedeRentriError extends DomainError {
  constructor() {
    super(
      'Il registro non ha una sede RENTRI collegata: imposta una sede principale nella sezione Unità locali.'
    )
    this.name = 'RegistroSenzaSedeRentriError'
  }
}

/** D10: un movimento collegato a un FIR non può stare in un registro diverso da quello trasmesso. */
export class RegistroNonCoerenteConFirError extends DomainError {
  constructor() {
    super(
      'Un movimento collegato a un FIR si registra nel registro della sede principale, la stessa trasmessa a RENTRI nel FIR.'
    )
    this.name = 'RegistroNonCoerenteConFirError'
  }
}

const CODICE_REGISTRO = 'CARICO_SCARICO'
const DESCRIZIONE_SENZA_SEDE = 'Registro cronologico'
const TENTATIVI_MASSIMI = 3

type LettoreRegistri = Pick<Prisma.TransactionClient, 'registroRifiuti'>

const INCLUDE_SEDE = {
  unitaLocale: { select: { numIscrSito: true, denominazione: true, principale: true } },
} as const

type RegistroConSede = Prisma.RegistroRifiutiGetPayload<{ include: typeof INCLUDE_SEDE }>

function comeVista(r: RegistroConSede): RegistroVista {
  return {
    id: r.id,
    unitaLocaleId: r.unitaLocaleId,
    numIscrSito: r.unitaLocale?.numIscrSito ?? null,
    denominazione: r.unitaLocale?.denominazione ?? r.descrizione,
    codice: r.codice,
    attivo: r.attivo,
    principale: r.unitaLocale?.principale ?? false,
  }
}

function eViolazioneUnico(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

/**
 * Registri per sede (Fase 2 pezzo 1, D1/D2/D3/D4/D10).
 *
 * Tenant e RLS: il `PrismaService` imposta `app.tenant_id` da solo quando c'è un contesto
 * (richiesta o job) e le letture semplici (`elenca`, `preparaRegistri`, `sedeRentri`) si
 * affidano a quello, insieme al filtro esplicito per `tenantId`. `assicuraRegistri` apre una
 * transazione propria e imposta il tenant come primo statement (`impostaTenant`): funziona
 * quindi sotto `wasteflow_app` anche se il contesto manca o è di un'altra azienda. `risolvi`
 * e `risolviPerFir` usano il `tx` del chiamante, che ha già il tenant. Nessun client di sistema.
 */
@Injectable()
export class RegistriService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RegistriService.name)
  }

  /**
   * Un registro per ogni sede attiva; lega il registro senza sede alla principale (D2). Idempotente.
   * Apre una transazione PROPRIA e breve con il lock `registro-init|<tenantId>`: mai dentro la
   * transazione di registrazione.
   */
  async assicuraRegistri(tenantId: string): Promise<RegistroVista[]> {
    for (let tentativo = 1; ; tentativo++) {
      try {
        return await this.prisma.$transaction(tx => this.assicuraInTransazione(tx, tenantId))
      } catch (err) {
        // Creazione concorrente da un'altra transazione: si rilegge, mai un errore all'utente.
        if (eViolazioneUnico(err) && tentativo < TENTATIVI_MASSIMI) continue
        throw err
      }
    }
  }

  private async assicuraInTransazione(
    tx: Prisma.TransactionClient,
    tenantId: string
  ): Promise<RegistroVista[]> {
    await impostaTenant(tx, tenantId)
    const chiave = `registro-init|${tenantId}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`

    const sedi = await tx.rentriUnitaLocale.findMany({
      where: { tenantId, attiva: true },
      orderBy: [{ principale: 'desc' }, { createdAt: 'asc' }],
    })
    const registri = await tx.registroRifiuti.findMany({
      where: { tenantId, codice: CODICE_REGISTRO },
    })

    if (sedi.length === 0 && registri.length === 0) {
      await tx.registroRifiuti.create({
        data: { tenantId, descrizione: DESCRIZIONE_SENZA_SEDE, codice: CODICE_REGISTRO },
      })
    }

    let senzaSede = registri.find(r => r.unitaLocaleId === null)
    for (const s of sedi) {
      if (registri.some(r => r.unitaLocaleId === s.id)) continue
      if (s.principale && senzaSede) {
        // D2: solo da NULL a un valore, mai da una sede a un'altra (il filtro lo garantisce).
        const { count } = await tx.registroRifiuti.updateMany({
          where: { id: senzaSede.id, tenantId, unitaLocaleId: null },
          data: { unitaLocaleId: s.id },
        })
        if (count === 1) {
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: null,
              action: 'REGISTRO_COLLEGATO_SEDE',
              description: `Il registro cronologico è stato collegato alla sede principale ${s.denominazione}`,
              metadata: {
                registroId: senzaSede.id,
                unitaLocaleId: s.id,
                numIscrSito: s.numIscrSito,
              },
            },
          })
          this.logger.info(
            `Registro ${senzaSede.id} collegato alla sede ${s.id} (tenant ${tenantId})`
          )
          senzaSede = undefined
          continue
        }
      }
      await tx.registroRifiuti.create({
        data: {
          tenantId,
          unitaLocaleId: s.id,
          codice: CODICE_REGISTRO,
          descrizione: `Registro ${s.denominazione}`,
        },
      })
    }

    return this.leggiViste(tx, tenantId, false)
  }

  /** Solo lettura, nessun lock, nessuna scrittura. Per `GET /registro/registri`. */
  async elenca(tenantId: string): Promise<RegistroVista[]> {
    return this.leggiViste(this.prisma, tenantId, false)
  }

  /**
   * Prima della transazione di registrazione. Lettura senza lock: se il registro richiesto
   * (o, senza `registroId`, quello predefinito) esiste, non fa altro; altrimenti chiama
   * `assicuraRegistri`.
   */
  async preparaRegistri(tenantId: string, registroId?: string): Promise<void> {
    if (registroId) {
      const esiste = await this.prisma.registroRifiuti.findFirst({
        where: { id: registroId, tenantId, attivo: true },
        select: { id: true },
      })
      if (esiste) return
      await this.assicuraRegistri(tenantId)
      return
    }

    const attivi = await this.leggiViste(this.prisma, tenantId, true)
    if (attivi.length === 0) {
      await this.assicuraRegistri(tenantId)
      return
    }
    // Una sede principale attiva senza registro (appena impostata) non deve cedere il posto
    // di "predefinito" a un registro di un'altra sede.
    const principale = await this.prisma.rentriUnitaLocale.findFirst({
      where: { tenantId, principale: true, attiva: true },
      select: { id: true },
    })
    if (principale && !attivi.some(v => v.unitaLocaleId === principale.id)) {
      await this.assicuraRegistri(tenantId)
    }
  }

  /** D3. Dentro la transazione del chiamante. SOLA LETTURA, nessun lock. */
  async risolvi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    registroId?: string
  ): Promise<RegistroVista> {
    if (registroId) {
      const r = await tx.registroRifiuti.findFirst({
        where: { id: registroId, tenantId, attivo: true },
        include: INCLUDE_SEDE,
      })
      if (!r) throw new RegistroNonTrovatoError()
      return comeVista(r)
    }
    const attivi = await this.leggiViste(tx, tenantId, true)
    const principale = attivi.find(v => v.principale)
    if (principale) return principale
    if (attivi.length === 1) return attivi[0]
    if (attivi.length === 0) throw new RegistroNonTrovatoError()
    throw new RegistroDaIndicareError()
  }

  /**
   * D10 (solo FIR emessi dall'azienda). Movimento con `firId`: il registro della sede principale;
   * `registroId` diverso → errore. Senza principale e con più registri accetta il `registroId` indicato.
   */
  async risolviPerFir(
    tx: Prisma.TransactionClient,
    tenantId: string,
    registroId?: string
  ): Promise<RegistroVista> {
    let predefinito: RegistroVista
    try {
      predefinito = await this.risolvi(tx, tenantId)
    } catch (err) {
      if (err instanceof RegistroDaIndicareError && registroId) {
        return this.risolvi(tx, tenantId, registroId)
      }
      throw err
    }
    if (registroId && registroId !== predefinito.id) {
      throw new RegistroNonCoerenteConFirError()
    }
    return predefinito
  }

  /** Per la trasmissione del registro a RENTRI (F2-9). */
  async sedeRentri(
    tenantId: string,
    registroId: string
  ): Promise<{ numIscrSito: string; denominazione: string }> {
    const r = await this.prisma.registroRifiuti.findFirst({
      where: { id: registroId, tenantId },
      include: INCLUDE_SEDE,
    })
    if (!r) throw new RegistroNonTrovatoError()
    if (!r.unitaLocale) throw new RegistroSenzaSedeRentriError()
    return { numIscrSito: r.unitaLocale.numIscrSito, denominazione: r.unitaLocale.denominazione }
  }

  private async leggiViste(
    client: LettoreRegistri,
    tenantId: string,
    soloAttivi: boolean
  ): Promise<RegistroVista[]> {
    const registri = await client.registroRifiuti.findMany({
      where: { tenantId, ...(soloAttivi ? { attivo: true } : {}) },
      include: INCLUDE_SEDE,
      orderBy: { createdAt: 'asc' },
    })
    return registri.map(comeVista)
  }
}
