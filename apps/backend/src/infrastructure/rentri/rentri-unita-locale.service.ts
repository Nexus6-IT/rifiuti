import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../persistence/prisma.service'
import { NUM_ISCR_SITO_PATTERN } from './rentri-credential.service'

const SEDE_CON_DATI_DI_PESA = 'La sede ha dati di pesa: non si può eliminare.'
/** Nome del vincolo violato (meta Prisma), mai il testo del messaggio. */
const FK_PESA = /^(accessi_pesa|strumenti_pesa|pesate|collegamenti_accesso)_/
const SEDE_CON_REGISTRO_CON_MOVIMENTI =
  'La sede ha un registro con movimenti, progressivo iniziale o giacenze iniziali: disattivala invece di eliminarla.'

/** Unità locale RENTRI di un tenant (mai segreti: solo dati anagrafici). */
export interface RentriUnitaLocale {
  id: string
  numIscrSito: string
  denominazione: string
  principale: boolean
  attiva: boolean
  createdAt: Date
  updatedAt: Date
  /** Blocco virtuale RENTRI predefinito per l'emissione da questa sede (R6). Null = non configurato. */
  codiceBloccoPredefinito: string | null
  /** Soglia di scorta di numeri vidimati da mantenere pronti per questa sede (R6). Null = job disattivato per questa sede. */
  dimensioneScortaDesiderata: number | null
  /** Anagrafica della sede per la sua dichiarazione MUD (F2-8). Null = non indicato. */
  indirizzo: string | null
  civico: string | null
  cap: string | null
  comune: string | null
  /** Sigla, 2 lettere maiuscole. */
  provincia: string | null
  numeroAddetti: number | null
  /** Codice dell'unità locale nel file MUD: assegnato dal database, non modificabile. */
  progressivoMud: number | null
}

/** Dati per creare una nuova unità locale. */
export interface CreateRentriUnitaLocaleInput {
  numIscrSito: string
  denominazione: string
  /**
   * Richiesta esplicita di renderla la sede di default. Ignorata (forzata a
   * true) per la primissima sede del tenant: chi ha una sola sede non deve
   * scegliere nulla.
   */
  principale?: boolean
}

/** Dati aggiornabili di un'unità locale esistente (non il numIscrSito: è l'identificativo RENTRI). */
export interface UpdateRentriUnitaLocaleInput {
  denominazione?: string
  attiva?: boolean
  /** Soglia di scorta (R6). `null` esplicito disattiva il rifornimento automatico per questa sede. */
  dimensioneScortaDesiderata?: number | null
  /** Anagrafica della sede (F2-8): stringa vuota o `null` cancella il dato. */
  indirizzo?: string | null
  civico?: string | null
  /** 5 cifre. */
  cap?: string | null
  comune?: string | null
  /** 2 lettere, salvata maiuscola. */
  provincia?: string | null
  /** Intero >= 0. */
  numeroAddetti?: number | null
}

/**
 * Gestisce le unità locali RENTRI di un tenant (R2 multi-sede). A differenza
 * del certificato (RentriCredential, uno per tenant), un'azienda può avere
 * più sedi operative iscritte a RENTRI: questo servizio ne gestisce il CRUD
 * e l'invariante "esattamente una principale per tenant".
 *
 * Isolamento multi-tenant: ogni metodo che referenzia un id riceve anche il
 * tenantId del chiamante e filtra sempre `{ id, tenantId }` — un'unità
 * locale di un altro tenant risulta "non trovata" (404), mai un 403 che
 * confermerebbe la sua esistenza. Il model è inoltre in TENANT_SCOPED_MODELS
 * (difesa in profondità via estensione Prisma RLS).
 */
@Injectable()
export class RentriUnitaLocaleService {
  constructor(private readonly prisma: PrismaService) {}

  async listForTenant(tenantId: string): Promise<RentriUnitaLocale[]> {
    const rows = await this.prisma.db.rentriUnitaLocale.findMany({
      where: { tenantId },
      orderBy: [{ principale: 'desc' }, { denominazione: 'asc' }],
    })
    return rows.map(r => this.toPlain(r))
  }

  /** Ritorna l'unità locale solo se appartiene al tenant, altrimenti null (→ 404 lato controller). */
  async findById(tenantId: string, id: string): Promise<RentriUnitaLocale | null> {
    const row = await this.prisma.db.rentriUnitaLocale.findFirst({
      where: { id, tenantId },
    })
    return row ? this.toPlain(row) : null
  }

  /** Unità locale marcata principale del tenant, o null se non ancora configurata nessuna. */
  async getPrincipale(tenantId: string): Promise<RentriUnitaLocale | null> {
    const row = await this.prisma.db.rentriUnitaLocale.findFirst({
      where: { tenantId, principale: true },
    })
    return row ? this.toPlain(row) : null
  }

  async create(tenantId: string, input: CreateRentriUnitaLocaleInput): Promise<RentriUnitaLocale> {
    this.validatePattern(input.numIscrSito)
    if (!input.denominazione?.trim()) {
      throw new BadRequestException('La denominazione della sede è obbligatoria')
    }

    const count = await this.prisma.db.rentriUnitaLocale.count({ where: { tenantId } })
    // Prima sede del tenant: nessuna scelta da fare, diventa principale a
    // prescindere da cosa è stato richiesto.
    const principale = count === 0 ? true : Boolean(input.principale)

    try {
      const row = await this.prisma.db.$transaction(async tx => {
        if (principale) {
          await tx.rentriUnitaLocale.updateMany({
            where: { tenantId, principale: true },
            data: { principale: false },
          })
        }
        return tx.rentriUnitaLocale.create({
          data: {
            tenantId,
            numIscrSito: input.numIscrSito,
            denominazione: input.denominazione.trim(),
            principale,
            attiva: true,
          },
        })
      })
      return this.toPlain(row)
    } catch (error) {
      throw this.mapPersistenceError(error)
    }
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateRentriUnitaLocaleInput
  ): Promise<RentriUnitaLocale> {
    const existing = await this.findById(tenantId, id)
    if (!existing) {
      throw new NotFoundException('Unità locale RENTRI non trovata')
    }
    if (input.denominazione !== undefined && !input.denominazione.trim()) {
      throw new BadRequestException('La denominazione della sede è obbligatoria')
    }
    if (
      input.dimensioneScortaDesiderata !== undefined &&
      input.dimensioneScortaDesiderata !== null
    ) {
      if (
        !Number.isInteger(input.dimensioneScortaDesiderata) ||
        input.dimensioneScortaDesiderata < 1
      ) {
        throw new BadRequestException('La dimensione della scorta deve essere un intero positivo')
      }
    }

    const indirizzo = this.testoOpzionale(input.indirizzo)
    const civico = this.testoOpzionale(input.civico)
    const cap = this.testoOpzionale(input.cap)
    const comune = this.testoOpzionale(input.comune)
    const provincia = this.testoOpzionale(input.provincia)
    if (cap != null && !/^[0-9]{5}$/.test(cap)) {
      throw new BadRequestException('Il CAP deve essere di 5 cifre')
    }
    if (provincia != null && !/^[A-Za-z]{2}$/.test(provincia)) {
      throw new BadRequestException('La provincia deve essere la sigla di 2 lettere')
    }
    if (
      input.numeroAddetti != null &&
      (!Number.isInteger(input.numeroAddetti) || input.numeroAddetti < 0)
    ) {
      throw new BadRequestException('Il numero di addetti deve essere un intero non negativo')
    }

    const row = await this.prisma.db.rentriUnitaLocale.update({
      where: { id },
      data: {
        ...(input.denominazione !== undefined ? { denominazione: input.denominazione.trim() } : {}),
        ...(input.attiva !== undefined ? { attiva: input.attiva } : {}),
        ...(input.dimensioneScortaDesiderata !== undefined
          ? { dimensioneScortaDesiderata: input.dimensioneScortaDesiderata }
          : {}),
        ...(indirizzo !== undefined ? { indirizzo } : {}),
        ...(civico !== undefined ? { civico } : {}),
        ...(cap !== undefined ? { cap } : {}),
        ...(comune !== undefined ? { comune } : {}),
        ...(provincia !== undefined ? { provincia: provincia?.toUpperCase() ?? null } : {}),
        ...(input.numeroAddetti !== undefined ? { numeroAddetti: input.numeroAddetti } : {}),
      },
    })
    return this.toPlain(row)
  }

  /**
   * Imposta il blocco virtuale predefinito della sede identificata da
   * `numIscrSito` (R6 — `PUT /rentri/blocchi/:codiceBlocco/predefinito`: il
   * chiamante conosce solo il codice del blocco, la sede si risolve da
   * quello). Fail-closed: nessuna sede locale con quel `numIscrSito` per
   * questo tenant → 404, mai una creazione implicita.
   */
  async impostaBloccoPredefinitoPerNumIscrSito(
    tenantId: string,
    numIscrSito: string,
    codiceBlocco: string
  ): Promise<RentriUnitaLocale> {
    const existing = await this.prisma.db.rentriUnitaLocale.findFirst({
      where: { tenantId, numIscrSito },
    })
    if (!existing) {
      throw new NotFoundException(
        `Nessuna unità locale RENTRI registrata per num_iscr_sito ${numIscrSito}: registrala prima di impostare un blocco predefinito.`
      )
    }

    const row = await this.prisma.db.rentriUnitaLocale.update({
      where: { id: existing.id },
      data: { codiceBloccoPredefinito: codiceBlocco },
    })
    return this.toPlain(row)
  }

  /**
   * Rende `id` la sede principale del tenant, spostando il flag dalla sede
   * che lo aveva prima (transazione: mai zero e mai due principali).
   */
  async setPrincipale(tenantId: string, id: string): Promise<RentriUnitaLocale> {
    const existing = await this.findById(tenantId, id)
    if (!existing) {
      throw new NotFoundException('Unità locale RENTRI non trovata')
    }
    if (existing.principale) {
      return existing
    }

    const [, row] = await this.prisma.db.$transaction([
      this.prisma.db.rentriUnitaLocale.updateMany({
        where: { tenantId, principale: true },
        data: { principale: false },
      }),
      this.prisma.db.rentriUnitaLocale.update({
        where: { id },
        data: { principale: true },
      }),
    ])
    return this.toPlain(row)
  }

  /**
   * Rimuove un'unità locale. Se è la principale e ne esistono altre, va
   * prima scelta un'altra principale esplicitamente (mai lasciare il tenant
   * senza una sede di default finché ne ha almeno una attiva).
   */
  async remove(tenantId: string, id: string): Promise<void> {
    const existing = await this.findById(tenantId, id)
    if (!existing) {
      throw new NotFoundException('Unità locale RENTRI non trovata')
    }

    if (existing.principale) {
      const totalCount = await this.prisma.db.rentriUnitaLocale.count({ where: { tenantId } })
      if (totalCount > 1) {
        throw new BadRequestException(
          "Imposta prima un'altra sede come principale: non puoi eliminare la sede principale finché il tenant ne ha altre."
        )
      }
    }

    // D8: una sede con un registro che ha movimenti, un progressivo iniziale o giacenze iniziali si disattiva,
    // non si elimina; un registro vuoto si cancella con la sede, nella stessa transazione.
    try {
      await this.prisma.db.$transaction(async tx => {
        const registri = await tx.registroRifiuti.findMany({
          where: { tenantId, unitaLocaleId: id },
          select: { id: true },
        })
        if (registri.length > 0) {
          const registroIds = registri.map(r => r.id)
          const [movimento, progressivo, apertura] = await Promise.all([
            tx.wasteMovement.findFirst({
              where: { tenantId, registroId: { in: registroIds } },
              select: { id: true },
            }),
            tx.registroProgressivoIniziale.findFirst({
              where: { tenantId, registroId: { in: registroIds } },
              select: { id: true },
            }),
            tx.giacenzaIniziale.findFirst({
              where: { tenantId, registroId: { in: registroIds } },
              select: { id: true },
            }),
          ])
          if (movimento || progressivo || apertura) {
            throw new BadRequestException(SEDE_CON_REGISTRO_CON_MOVIMENTI)
          }
          await tx.registroRifiuti.deleteMany({ where: { tenantId, id: { in: registroIds } } })
        }
        await tx.rentriUnitaLocale.deleteMany({ where: { id, tenantId } })
      })
    } catch (error) {
      // Una registrazione concorrente nel registro appena svuotato: la chiave esterna
      // RESTRICT rifiuta la cancellazione.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        const meta = (error.meta ?? {}) as { constraint?: unknown; field_name?: unknown }
        const vincolo = String(meta.constraint ?? meta.field_name ?? '')
        if (FK_PESA.test(vincolo)) throw new BadRequestException(SEDE_CON_DATI_DI_PESA)
        throw new BadRequestException(SEDE_CON_REGISTRO_CON_MOVIMENTI)
      }
      throw error
    }
  }

  /**
   * Upsert delle unità locali lette dall'ente (R4 Task 3,
   * `SincronizzaSitiUseCase`): a differenza di {@link create} NON valida
   * `numIscrSito` contro {@link NUM_ISCR_SITO_PATTERN}. Quel pattern proviene
   * da `formulari.yaml` (vincolo sull'input DIGITATO da un operatore per
   * l'acquisizione di visibilità): `anagrafiche.yaml` dichiara lo stesso
   * campo come stringa semplice, senza formato imposto, e il valore qui
   * arriva dall'ente stesso — validarlo con la regex di un contratto diverso
   * rischierebbe di scartare unità locali realmente iscritte solo perché il
   * loro formato non coincide con quello atteso da un altro servizio.
   *
   * Non cancella MAI righe assenti dall'elenco ricevuto: un'unità locale che
   * l'ente non restituisce più in un ciclo di allineamento (delega revocata,
   * errore temporaneo, filtro) non deve sparire da sotto un FIR che la
   * referenzia. Marcare esplicitamente le assenti come "non più presenti"
   * (come per i CER, Task 4) non è nello scope di questo task: le unità
   * locali sono per-tenant e a bassa cardinalità, senza il segnale
   * `presente/rimosso` che il contratto territoriale/CER offre invece
   * esplicitamente — restano quindi semplicemente quelle già note, invariate
   * finché un ciclo futuro non le riconferma o un amministratore non
   * interviene manualmente (`PUT/DELETE /rentri/unita-locali`).
   */
  async upsertFromRentri(
    tenantId: string,
    siti: { numIscrSito: string; denominazione: string; attiva: boolean }[]
  ): Promise<RentriUnitaLocale[]> {
    const risultato: RentriUnitaLocale[] = []

    for (const sito of siti) {
      const esistente = await this.prisma.db.rentriUnitaLocale.findFirst({
        where: { tenantId, numIscrSito: sito.numIscrSito },
      })

      if (esistente) {
        const row = await this.prisma.db.rentriUnitaLocale.update({
          where: { id: esistente.id },
          data: { denominazione: sito.denominazione, attiva: sito.attiva },
        })
        risultato.push(this.toPlain(row))
        continue
      }

      // Prima sede del tenant (anche qui): nessuna scelta da fare, diventa
      // principale a prescindere — stessa regola di {@link create}.
      const count = await this.prisma.db.rentriUnitaLocale.count({ where: { tenantId } })
      const row = await this.prisma.db.rentriUnitaLocale.create({
        data: {
          tenantId,
          numIscrSito: sito.numIscrSito,
          denominazione: sito.denominazione,
          principale: count === 0,
          attiva: sito.attiva,
        },
      })
      risultato.push(this.toPlain(row))
    }

    return risultato
  }

  /** `undefined` = campo non inviato; stringa vuota o solo spazi = `null`. */
  private testoOpzionale(v: string | null | undefined): string | null | undefined {
    if (v === undefined) return undefined
    if (v === null) return null
    const t = v.trim()
    return t === '' ? null : t
  }

  private validatePattern(numIscrSito: string): void {
    if (!NUM_ISCR_SITO_PATTERN.test(numIscrSito)) {
      throw new BadRequestException(
        `Numero di iscrizione dell'unità locale RENTRI non valido: deve rispettare il formato ${NUM_ISCR_SITO_PATTERN.source}`
      )
    }
  }

  private mapPersistenceError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new BadRequestException('Esiste già una sede del tenant con questo numIscrSito')
    }
    return error instanceof Error ? error : new Error(String(error))
  }

  private toPlain(row: {
    id: string
    numIscrSito: string
    denominazione: string
    principale: boolean
    attiva: boolean
    createdAt: Date
    updatedAt: Date
    codiceBloccoPredefinito?: string | null
    dimensioneScortaDesiderata?: number | null
    indirizzo?: string | null
    civico?: string | null
    cap?: string | null
    comune?: string | null
    provincia?: string | null
    numeroAddetti?: number | null
    progressivoMud?: number | null
  }): RentriUnitaLocale {
    return {
      id: row.id,
      numIscrSito: row.numIscrSito,
      denominazione: row.denominazione,
      principale: row.principale,
      attiva: row.attiva,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      codiceBloccoPredefinito: row.codiceBloccoPredefinito ?? null,
      dimensioneScortaDesiderata: row.dimensioneScortaDesiderata ?? null,
      indirizzo: row.indirizzo ?? null,
      civico: row.civico ?? null,
      cap: row.cap ?? null,
      comune: row.comune ?? null,
      provincia: row.provincia ?? null,
      numeroAddetti: row.numeroAddetti ?? null,
      progressivoMud: row.progressivoMud ?? null,
    }
  }
}
