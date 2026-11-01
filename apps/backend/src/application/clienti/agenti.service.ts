// Agenti (4.1b, D13, D17, D22): ruolo sulla ditta di F2-10. La ditta e la sede si risolvono come per
// produttore, trasportatore e destinatario (`creaRuoloSuDitta`); qui stanno codice, note, sede
// predefinita, disattivazione, lock ottimistico (D14) e audit (D16).
//
// L'agente privato (senza partita IVA) non e' ammesso: lo rifiuta `DitteService.risolviPerRuolo`
// con il messaggio di D18. Nessun audit riporta partita IVA, codice fiscale o note.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { SedeNonValidaPerRuoloError } from '../../core/domain/errors'
import { validaCodiceTabella } from '../../domain/clienti/codice-tabella'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  RuoloGiaPresenteError,
  creaRuoloSuDitta,
  messaggioRuoloPresente,
} from '../registry/crea-ruolo-su-ditta'
import { DatiRisoluzioneRuolo, DitteService, SedeDto } from '../registry/ditte/ditte.service'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from './anagrafica-versionata'

const ENTITA: DescrizioneEntita = {
  prefisso: 'AGENTE',
  soggetto: "L'agente",
  femminile: false,
  inUso: {
    codice: 'AGENTE_IN_USO',
    messaggio: "L'agente è indicato su clienti o contratti: disattivalo invece di eliminarlo.",
  },
}

const VINCOLO_CODICE = 'agenti_tenant_id_codice_key'
const VINCOLO_DITTA = 'agenti_tenant_id_ditta_id_key'
const CODICE_RUOLO_PRESENTE = 'AGENTE_GIA_PRESENTE'

/** Tutte le chiavi uniche di business della tabella: codice e ditta (R22). */
const VINCOLI: VincoliNoti = {
  [VINCOLO_CODICE]: {
    codice: 'AGENTE_CODICE_DUPLICATO',
    messaggio: 'Esiste già un agente con questo codice.',
  },
  [VINCOLO_DITTA]: {
    codice: CODICE_RUOLO_PRESENTE,
    messaggio: messaggioRuoloPresente('agente'),
  },
}

export interface AgenteVista {
  id: string
  versione: number
  attivo: boolean
  codice: string | null
  note: string | null
  ditta: {
    id: string
    ragioneSociale: string
    partitaIva: string | null
    codiceFiscale: string | null
  }
  sede: SedeDto
  /** Clienti che lo indicano. */
  clienti: number
  /** Contratti non eliminati che lo indicano. */
  contratti: number
  /** Nessuna riga lo cita (contratti eliminati compresi): si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

export type NuovoAgente = DatiRisoluzioneRuolo & {
  codice?: string | null
  note?: string | null
  sedeId?: string
}

export interface ModificaAgente {
  codice?: string | null
  note?: string | null
  sedeId?: string
  attivo?: boolean
  versione: number
}

export interface FiltroAgenti {
  testo?: string
  soloAttivi?: boolean
  pagina: number
  dimensione: number
}

type RigaAgente = Prisma.AgenteGetPayload<{ include: { ditta: true; sede: true } }>

const INCLUDE = { ditta: true, sede: true } as const

const nonTrovato = () =>
  new NotFoundException({ message: 'Agente non trovato.', error: 'AGENTE_NON_TROVATO' })

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Testo libero: spazi ai bordi tolti, vuoto = assente. */
function pulisci(v: string | null | undefined): string | null {
  const t = v?.trim()
  return t ? t : null
}

function validaCodice(codice: string | null): void {
  if (codice === null) return
  const m = validaCodiceTabella(codice, 20, 'Il codice agente')
  if (m) throw new BadRequestException({ message: [m], error: 'AGENTE_NON_VALIDO' })
}

function comeSede(s: RigaAgente['sede']): SedeDto {
  return {
    id: s.id,
    denominazione: s.denominazione,
    via: s.via,
    civico: s.civico,
    cap: s.cap,
    citta: s.comune,
    provincia: s.provincia,
    referente: s.referente,
    email: s.email,
    telefono: s.telefono,
    pec: s.pec,
    principale: s.principale,
    attiva: s.attiva,
  }
}

interface AgenteInCreazione {
  id?: string
  dittaId: string
  sedeId: string
  dittaEsistente: boolean
}

@Injectable()
export class AgentiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ditte: DitteService
  ) {}

  async crea(
    tenantId: string,
    utenteId: string,
    d: NuovoAgente
  ): Promise<{ agente: AgenteVista; dittaEsistente: boolean; avvisi: string[] }> {
    const { codice: codiceRicevuto, note: noteRicevute, sedeId, ...datiDitta } = d
    const codice = pulisci(codiceRicevuto)
    const note = pulisci(noteRicevute)
    validaCodice(codice)

    return nelContestoTenant(tenantId, async () => {
      let esito
      try {
        esito = await creaRuoloSuDitta<AgenteInCreazione>(this.prisma, this.ditte, {
          ruolo: 'AGENTE',
          nome: 'agente',
          dati: datiDitta,
          esistente: (tx, dittaId) =>
            tx.agente.findFirst({ where: { tenantId, dittaId }, select: { id: true } }),
          costruisci: r => ({
            dittaId: r.dittaId,
            sedeId: r.sedeId,
            dittaEsistente: r.dittaEsistente,
          }),
          inserisci: async (tx, entita) => {
            if (sedeId) {
              const sede = await tx.sedeDitta.findFirst({
                where: { id: sedeId, dittaId: entita.dittaId, tenantId, attiva: true },
                select: { id: true },
              })
              if (!sede) throw new SedeNonValidaPerRuoloError('agente')
              entita.sedeId = sede.id
            }
            const riga = await tx.agente.create({
              data: { tenantId, dittaId: entita.dittaId, sedeId: entita.sedeId, codice, note },
              select: { id: true },
            })
            entita.id = riga.id
            // Solo id e flag: niente identificativi fiscali, codice o note.
            await this.audit(tx, tenantId, utenteId, 'AGENTE_CREATO', 'creato', {
              agenteId: riga.id,
              dittaId: entita.dittaId,
              dittaEsistente: entita.dittaEsistente,
            })
          },
        })
      } catch (err) {
        return this.traduciCreazione(err, tenantId, codice)
      }
      const agente = await this.leggi(tenantId, esito.ruolo.id as string)
      return { agente, dittaEsistente: esito.dittaEsistente, avvisi: esito.avvisi }
    })
  }

  async list(
    tenantId: string,
    f: FiltroAgenti
  ): Promise<{ elementi: AgenteVista[]; totale: number }> {
    const testo = f.testo?.trim()
    const where: Prisma.AgenteWhereInput = {
      tenantId,
      ...(f.soloAttivi ? { attivo: true } : {}),
      ...(testo
        ? {
            OR: [
              { codice: { contains: testo, mode: 'insensitive' } },
              { ditta: { ragioneSociale: { contains: testo, mode: 'insensitive' } } },
              { ditta: { partitaIva: { contains: testo } } },
            ],
          }
        : {}),
    }
    return nelContestoTenant(tenantId, async () => {
      const [righe, totale] = await Promise.all([
        this.prisma.agente.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ attivo: 'desc' }, { ditta: { ragioneSociale: 'asc' } }, { id: 'asc' }],
          skip: (f.pagina - 1) * f.dimensione,
          take: f.dimensione,
        }),
        this.prisma.agente.count({ where }),
      ])
      return { elementi: await this.comeViste(this.prisma, tenantId, righe), totale }
    })
  }

  async getById(tenantId: string, id: string): Promise<AgenteVista> {
    return nelContestoTenant(tenantId, () => this.leggi(tenantId, id))
  }

  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaAgente
  ): Promise<AgenteVista> {
    const codiceNuovo = m.codice === undefined ? undefined : pulisci(m.codice)
    if (codiceNuovo !== undefined) validaCodice(codiceNuovo)
    const noteNuove = m.note === undefined ? undefined : pulisci(m.note)

    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.agente.findFirst({ where: { id, tenantId }, include: INCLUDE })
          if (!prima) throw nonTrovato()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          let sedeId = prima.sedeId
          if (m.sedeId !== undefined && m.sedeId !== prima.sedeId) {
            const sede = await tx.sedeDitta.findFirst({
              where: { id: m.sedeId, dittaId: prima.dittaId, tenantId, attiva: true },
              select: { id: true },
            })
            if (!sede) throw new SedeNonValidaPerRuoloError('agente')
            sedeId = sede.id
          }

          const nuovi = {
            codice: codiceNuovo === undefined ? prima.codice : codiceNuovo,
            note: noteNuove === undefined ? prima.note : noteNuove,
            sedeId,
            attivo: m.attivo ?? prima.attivo,
          }
          const originali = {
            codice: prima.codice,
            note: prima.note,
            sedeId: prima.sedeId,
            attivo: prima.attivo,
          }
          const campi = (Object.keys(nuovi) as Array<keyof typeof nuovi>).filter(
            c => !uguali(nuovi[c], originali[c])
          )
          if (campi.length === 0) return (await this.comeViste(tx, tenantId, [prima]))[0]

          await scriviCondizionato(
            () =>
              tx.agente.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c]])),
                  versione: { increment: 1 },
                },
              }),
            ENTITA
          )
          const dopo = await tx.agente.findFirst({ where: { id, tenantId }, include: INCLUDE })
          if (!dopo) throw nonTrovato()

          // Solo id e nomi dei campi: mai codice o note.
          const resto = campi.filter(c => c !== 'attivo')
          if (resto.length > 0) {
            await this.audit(tx, tenantId, utenteId, 'AGENTE_MODIFICATO', 'modificato', {
              agenteId: id,
              campi: resto,
            })
          }
          if (campi.includes('attivo')) {
            await this.audit(
              tx,
              tenantId,
              utenteId,
              nuovi.attivo ? 'AGENTE_RIATTIVATO' : 'AGENTE_DISATTIVATO',
              nuovi.attivo ? 'riattivato' : 'disattivato',
              { agenteId: id }
            )
          }
          return (await this.comeViste(tx, tenantId, [dopo]))[0]
        })
        .catch(err =>
          this.traduci(err, () => this.rileggiVincolo(tenantId, codiceNuovo ?? null, id))
        )
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.agente.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovato()
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.agente.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'AGENTE_ELIMINATO', 'eliminato', {
            agenteId: id,
            dittaId: riga.dittaId,
          })
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /**
   * Per i Task 14 e 16: stato di attivazione degli agenti scelti, nella transazione del
   * chiamante. Un id assente dalla mappa non esiste (o e' di un'altra azienda).
   */
  async attiviPerId(
    tx: Prisma.TransactionClient,
    ids: string[]
  ): Promise<Map<string, { id: string; attivo: boolean }>> {
    const tenantId = TenantContext.requireTenantId()
    if (ids.length === 0) return new Map()
    const righe = await tx.agente.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, attivo: true },
    })
    return new Map(righe.map(r => [r.id, r]))
  }

  // ---------------------------------------------------------------------------------------------

  private async leggi(tenantId: string, id: string): Promise<AgenteVista> {
    const riga = await this.prisma.agente.findFirst({
      where: { id, tenantId },
      include: INCLUDE,
    })
    if (!riga) throw nonTrovato()
    return (await this.comeViste(this.prisma, tenantId, [riga]))[0]
  }

  /** Viste con i conteggi: tre `groupBy` per tutta la pagina, non una query per riga. */
  private async comeViste(
    client: Pick<PrismaService, 'cliente' | 'contrattoCliente'>,
    tenantId: string,
    righe: RigaAgente[]
  ): Promise<AgenteVista[]> {
    if (righe.length === 0) return []
    const ids = righe.map(r => r.id)
    const sono = { tenantId, agenteId: { in: ids } }
    const [clienti, contrattiVivi, contrattiTutti] = await Promise.all([
      client.cliente.groupBy({ by: ['agenteId'], where: sono, _count: { _all: true } }),
      client.contrattoCliente.groupBy({
        by: ['agenteId'],
        where: { ...sono, eliminatoIl: null },
        _count: { _all: true },
      }),
      client.contrattoCliente.groupBy({ by: ['agenteId'], where: sono, _count: { _all: true } }),
    ])
    const conta = (g: Array<{ agenteId: string | null; _count: { _all: number } }>) =>
      new Map(g.map(x => [x.agenteId, x._count._all]))
    const nClienti = conta(clienti)
    const nVivi = conta(contrattiVivi)
    const nTutti = conta(contrattiTutti)
    return righe.map(r => ({
      id: r.id,
      versione: r.versione,
      attivo: r.attivo,
      codice: r.codice,
      note: r.note,
      ditta: {
        id: r.ditta.id,
        ragioneSociale: r.ditta.ragioneSociale,
        partitaIva: r.ditta.partitaIva,
        codiceFiscale: r.ditta.codiceFiscale,
      },
      sede: comeSede(r.sede),
      clienti: nClienti.get(r.id) ?? 0,
      contratti: nVivi.get(r.id) ?? 0,
      eliminabile: (nClienti.get(r.id) ?? 0) + (nTutti.get(r.id) ?? 0) === 0,
    }))
  }

  /** Il ruolo c'e' gia' per la ditta e' un 400 (come per le altre anagrafiche), non un 409. */
  private async traduci(err: unknown, rileggi?: () => Promise<string | null>): Promise<never> {
    if (err instanceof RuoloGiaPresenteError) {
      throw new BadRequestException({ message: err.message, error: CODICE_RUOLO_PRESENTE })
    }
    try {
      return await traduciErrorePrisma(err, ENTITA, VINCOLI, rileggi)
    } catch (tradotto) {
      const risposta = (tradotto as { getResponse?: () => unknown }).getResponse?.()
      if ((risposta as { error?: string } | undefined)?.error === CODICE_RUOLO_PRESENTE) {
        throw new BadRequestException(risposta as object)
      }
      throw tradotto
    }
  }

  private traduciCreazione(err: unknown, tenantId: string, codice: string | null): Promise<never> {
    return this.traduci(err, () => this.rileggiVincolo(tenantId, codice))
  }

  /**
   * Dopo una P2002 senza `meta.target` (RLS), FUORI dalla transazione abortita: il codice e' gia'
   * di un altro agente? Se si', e' il vincolo del codice; altrimenti l'unica altra chiave unica e'
   * quella della ditta (ruolo gia' presente).
   */
  private async rileggiVincolo(
    tenantId: string,
    codice: string | null,
    escludiId?: string
  ): Promise<string | null> {
    if (codice !== null) {
      const altro = await this.prisma.agente.findFirst({
        where: { tenantId, codice, ...(escludiId ? { id: { not: escludiId } } : {}) },
        select: { id: true },
      })
      if (altro) return VINCOLO_CODICE
    }
    return escludiId ? VINCOLO_CODICE : VINCOLO_DITTA
  }

  /** Audit nella stessa transazione: solo id e nomi dei campi, mai codice, note o dati fiscali. */
  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    action: string,
    esito: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action,
        description: `Agente ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
