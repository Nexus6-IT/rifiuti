import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { DomainError } from '../../core/domain/errors'
import { LoggerService } from '../../core/logger/logger.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { TenantContext } from '../../core/context/tenant-context'

export interface RegistroVista {
  id: string
  unitaLocaleId: string | null
  /** Valorizzato solo se il registro ha una sede. */
  numIscrSito: string | null
  denominazione: string
  codice: string
  attivo: boolean
  /** true se la sede del registro è la sede principale dell'azienda E è attiva. */
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
const TENTATIVI_PREDEFINITI = 3

type LettoreRegistri = Pick<Prisma.TransactionClient, 'registroRifiuti'>

const INCLUDE_SEDE = {
  unitaLocale: {
    select: { numIscrSito: true, denominazione: true, principale: true, attiva: true },
  },
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
    principale: (r.unitaLocale?.principale && r.unitaLocale.attiva) ?? false,
  }
}

function eViolazioneUnico(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

/**
 * Registri per sede (Fase 2 pezzo 1, D1/D2/D3/D4/D10).
 *
 * Tenant e RLS: il tenant lo imposta SOLO l'estensione del `PrismaService`, dal contesto
 * (`app.tenant_id` come primo statement di ogni transazione); il service non lo sovrascrive
 * mai, quindi la RLS resta una rete anche se un chiamante sbaglia `tenantId`. I metodi che
 * leggono o scrivono per conto proprio (`assicuraRegistri`, `elenca`, `preparaRegistri`,
 * `sedeRentri`) rifiutano un `tenantId` diverso da quello del contesto e, senza contesto
 * (job), lavorano in `TenantContext.run({ tenantId })`. `risolvi` e `risolviPerFir` usano il
 * `tx` del chiamante, che ha già il tenant. Nessun client di sistema.
 */
@Injectable()
export class RegistriService {
  /** Solo per i test (si sovrascrive dopo la creazione): quante volte si riesegue la transazione dopo una P2002. */
  tentativiMassimi: number = TENTATIVI_PREDEFINITI

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
    return this.nelContesto(tenantId, async () => {
      for (let tentativo = 1; ; tentativo++) {
        try {
          return await this.prisma.$transaction(tx => this.assicuraInTransazione(tx, tenantId))
        } catch (err) {
          // Creazione concorrente da un'altra transazione: si rilegge, mai un errore all'utente.
          if (eViolazioneUnico(err) && tentativo < this.tentativiMassimi) continue
          throw err
        }
      }
    })
  }

  /**
   * Il tenant lo imposta l'estensione del PrismaService dal contesto: il service non lo
   * sovrascrive mai, cosi' la RLS resta una rete anche se un chiamante sbaglia `tenantId`.
   * Contesto di un'altra azienda: errore, nessuna scrittura. Nessun contesto (job): si
   * lavora in `TenantContext.run({ tenantId })`.
   */
  private nelContesto<R>(tenantId: string, fn: () => Promise<R>): Promise<R> {
    const corrente = TenantContext.getStoreTenantId()
    if (corrente === null) return TenantContext.run({ tenantId }, fn)
    if (corrente !== tenantId) {
      return Promise.reject(
        new Error('RegistriService: il tenant richiesto non coincide con quello del contesto.')
      )
    }
    return fn()
  }

  private async assicuraInTransazione(
    tx: Prisma.TransactionClient,
    tenantId: string
  ): Promise<RegistroVista[]> {
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
    return this.nelContesto(tenantId, () => this.leggiViste(this.prisma, tenantId, false))
  }

  /**
   * Prima della transazione di registrazione. Lettura senza lock: se il registro richiesto
   * (o, senza `registroId`, quello predefinito) esiste, non fa altro; altrimenti chiama
   * `assicuraRegistri`.
   */
  async preparaRegistri(tenantId: string, registroId?: string): Promise<void> {
    return this.nelContesto(tenantId, () => this.preparaNelContesto(tenantId, registroId))
  }

  private async preparaNelContesto(tenantId: string, registroId?: string): Promise<void> {
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
   * `risolvi` per una lettura fuori da una transazione (es. la verifica della catena), nel
   * contesto del tenant. Nessuna scrittura, nessun lock. Con un `registroId` esplicito accetta
   * anche un registro DISATTIVATO dell'azienda (la verifica d'integrita' riguarda lo storico);
   * di un'altra azienda e' RegistroNonTrovatoError. Senza, vale la risoluzione di `risolvi`.
   */
  async risolviInLettura(tenantId: string, registroId?: string): Promise<RegistroVista> {
    return this.nelContesto(tenantId, () =>
      this.prisma.$transaction(async tx => {
        if (!registroId) return this.risolvi(tx, tenantId)
        const r = await tx.registroRifiuti.findFirst({
          where: { id: registroId, tenantId },
          include: INCLUDE_SEDE,
        })
        if (!r) throw new RegistroNonTrovatoError()
        return comeVista(r)
      })
    )
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
    return this.nelContesto(tenantId, async () => {
      const r = await this.prisma.registroRifiuti.findFirst({
        where: { id: registroId, tenantId },
        include: INCLUDE_SEDE,
      })
      if (!r) throw new RegistroNonTrovatoError()
      if (!r.unitaLocale) throw new RegistroSenzaSedeRentriError()
      return { numIscrSito: r.unitaLocale.numIscrSito, denominazione: r.unitaLocale.denominazione }
    })
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
