// Clienti (4.1b, D3, D4, D13, D17): ruolo sulla ditta di F2-10, come produttore, trasportatore,
// destinatario e agente. La ditta e la sede si risolvono con `creaRuoloSuDitta`; qui stanno i dati
// fiscali e di fatturazione (D3, regole pure in `domain/clienti/dati-fiscali-cliente`), i
// riferimenti alle tabelle di fatturazione e all'agente (`controllaRiferimenti`), l'audit (D16).
//
// Il cliente privato (senza partita IVA, solo codice fiscale di 16 caratteri) e' ammesso (D3) con
// nome e cognome obbligatori. Il codice fiscale e' un dato personale: non entra in query string,
// audit, log o messaggi. Modifica (D13, D14) e eliminazione (R25): un cliente citato da un
// contratto, anche eliminato, non si elimina ma si disattiva; la modifica non tocca i contratti (D4).
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { SedeNonValidaPerRuoloError } from '../../core/domain/errors'
import {
  normalizzaDatiFiscali,
  validaDatiFiscali,
  type DatiFiscaliCliente,
} from '../../domain/clienti/dati-fiscali-cliente'
import { CAMPI_EREDITATI_DAL_CLIENTE } from '../../domain/contratti-cliente/regole-contratto-cliente'
import { IdentificativoFiscale } from '../../domain/registry/value-objects/identificativo-fiscale'
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
import { controllaRiferimenti, type RiferimentiDaControllare } from './riferimenti-fatturazione'

const ENTITA: DescrizioneEntita = {
  prefisso: 'CLIENTE',
  soggetto: 'Il cliente',
  femminile: false,
  inUso: {
    codice: 'CLIENTE_CON_CONTRATTI',
    messaggio:
      'Il cliente ha dei contratti: non si elimina. Disattivalo per non usarlo nei contratti nuovi.',
  },
}

const VINCOLO_CODICE = 'clienti_tenant_id_codice_key'
const VINCOLO_DITTA = 'clienti_tenant_id_ditta_id_key'
const CODICE_RUOLO_PRESENTE = 'CLIENTE_GIA_PRESENTE'

/** Tutte le chiavi uniche di business della tabella: codice e ditta (R22). */
const VINCOLI: VincoliNoti = {
  [VINCOLO_CODICE]: {
    codice: 'CLIENTE_CODICE_DUPLICATO',
    messaggio: 'Esiste già un cliente con questo codice.',
  },
  [VINCOLO_DITTA]: {
    codice: CODICE_RUOLO_PRESENTE,
    messaggio: messaggioRuoloPresente('cliente'),
  },
}

/** Campi del cliente che arrivano nel corpo della richiesta accanto a quelli della ditta. */
const CAMPI_FISCALI: ReadonlyArray<keyof DatiFiscaliCliente> = [
  'codice',
  'codiceDestinatario',
  'pecFatturazione',
  'riferimentoAmministrazione',
  'iban',
  'contoCorrenteId',
  'condizionePagamentoId',
  'esigibilitaIva',
  'registroIvaId',
  'speseIncassoId',
  'bolloId',
  'agenteId',
  'ritenutaPercentuale',
  'nome',
  'cognome',
  'note',
]

/** Riferimento a una riga di tabella, come lo mostra la vista. */
export interface RifVista {
  id: string
  codice: string | null
  descrizione: string
}

export interface ClienteVista extends DatiFiscaliCliente {
  id: string
  versione: number
  attivo: boolean
  ditta: {
    id: string
    ragioneSociale: string
    partitaIva: string | null
    codiceFiscale: string | null
    privato: boolean
  }
  sedeFatturazione: SedeDto
  condizionePagamento: RifVista | null
  contoCorrente: RifVista | null
  registroIva: RifVista | null
  speseIncasso: RifVista | null
  bollo: RifVista | null
  agente: RifVista | null
  /** Contratti non eliminati del cliente (anche come cliente di fatturazione). */
  contratti: number
  /** Nessuna riga lo cita (contratti eliminati compresi): si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

export interface DatiCreazioneCliente extends DatiRisoluzioneRuolo, Partial<DatiFiscaliCliente> {
  sedeId?: string
}

/** Modifica parziale: chiave assente = invariato, `null` = svuota (D14). */
export type ModificaCliente = {
  [K in keyof DatiFiscaliCliente]?: DatiFiscaliCliente[K] | null
} & { sedeId?: string; attivo?: boolean; versione: number }

export interface FiltroClienti {
  testo?: string
  soloAttivi?: boolean
  pagina: number
  dimensione: number
}

const INCLUDE = {
  ditta: true,
  sede: true,
  contoCorrente: true,
  condizionePagamento: true,
  registroIva: true,
  speseIncasso: true,
  bollo: true,
  agente: { include: { ditta: true } },
} satisfies Prisma.ClienteInclude

type RigaCliente = Prisma.ClienteGetPayload<{ include: typeof INCLUDE }>

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** I dati fiscali come stanno sulla riga, nella forma testuale che usa la normalizzazione. */
function fiscaliDaRiga(r: RigaCliente): DatiFiscaliCliente {
  return {
    codice: r.codice,
    codiceDestinatario: r.codiceDestinatario,
    pecFatturazione: r.pecFatturazione,
    riferimentoAmministrazione: r.riferimentoAmministrazione,
    iban: r.iban,
    contoCorrenteId: r.contoCorrenteId,
    condizionePagamentoId: r.condizionePagamentoId,
    esigibilitaIva: r.esigibilitaIva,
    registroIvaId: r.registroIvaId,
    speseIncassoId: r.speseIncassoId,
    bolloId: r.bolloId,
    agenteId: r.agenteId,
    ritenutaPercentuale: r.ritenutaPercentuale === null ? null : r.ritenutaPercentuale.toFixed(2),
    nome: r.nome,
    cognome: r.cognome,
    note: r.note,
  }
}

const nonTrovato = () =>
  new NotFoundException({ message: 'Cliente non trovato.', error: 'CLIENTE_NON_TROVATO' })

const nonValido = (messaggi: string[]) =>
  new BadRequestException({ message: messaggi, error: 'CLIENTE_NON_VALIDO' })

/** Un cliente e' un privato quando ha solo un codice fiscale di persona fisica (D2.5). */
const eUnPrivato = (partitaIva: string | null, codiceFiscale: string | null) =>
  partitaIva === null && codiceFiscale !== null && codiceFiscale.length === 16

function comeSede(s: RigaCliente['sede']): SedeDto {
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

const rif = (r: { id: string; codice: string | null; descrizione: string } | null) =>
  r ? { id: r.id, codice: r.codice, descrizione: r.descrizione } : null

/** I soli riferimenti indicati (non vuoti): gli altri non si leggono. */
function riferimentiIndicati(d: DatiFiscaliCliente): RiferimentiDaControllare {
  const r: RiferimentiDaControllare = {}
  if (d.condizionePagamentoId) r.condizionePagamentoId = d.condizionePagamentoId
  if (d.contoCorrenteId) r.contoCorrenteId = d.contoCorrenteId
  if (d.speseIncassoId) r.speseIncassoId = d.speseIncassoId
  if (d.bolloId) r.bolloId = d.bolloId
  if (d.registroIvaId) r.registroIvaId = d.registroIvaId
  if (d.agenteId) r.agenteId = d.agenteId
  return r
}

interface ClienteInCreazione {
  id?: string
  dittaId: string
  sedeId: string
  dittaEsistente: boolean
  partitaIva: string | null
  codiceFiscale: string | null
}

@Injectable()
export class ClientiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ditte: DitteService
  ) {}

  async crea(
    tenantId: string,
    utenteId: string,
    d: DatiCreazioneCliente
  ): Promise<{ cliente: ClienteVista; dittaEsistente: boolean; avvisi: string[] }> {
    const { sedeId, ...resto } = d
    const grezzoFiscale: Record<string, unknown> = {}
    const datiDitta: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(resto)) {
      if ((CAMPI_FISCALI as readonly string[]).includes(k)) grezzoFiscale[k] = v
      else datiDitta[k] = v
    }
    const dittaDati = datiDitta as unknown as DatiRisoluzioneRuolo
    const fiscali = normalizzaDatiFiscali(grezzoFiscale)

    // Prima della transazione: il privato si riconosce dall'identificativo della richiesta. Un
    // identificativo non valido lo rifiuta `IdentificativoFiscale` col messaggio di F2-10.
    const identificativo = IdentificativoFiscale.crea({
      partitaIva: dittaDati.partitaIva,
      codiceFiscale: dittaDati.codiceFiscale,
    })
    const errori = validaDatiFiscali(fiscali, { privato: identificativo.privato })
    if (errori.length > 0) throw nonValido(errori)

    return nelContestoTenant(tenantId, async () => {
      let esito
      try {
        esito = await creaRuoloSuDitta<ClienteInCreazione>(this.prisma, this.ditte, {
          ruolo: 'CLIENTE',
          nome: 'cliente',
          dati: dittaDati,
          esistente: (tx, dittaId) =>
            tx.cliente.findFirst({ where: { tenantId, dittaId }, select: { id: true } }),
          costruisci: r => ({
            dittaId: r.dittaId,
            sedeId: r.sedeId,
            dittaEsistente: r.dittaEsistente,
            // servono a `inserisci` per ricontrollare il privato sulla ditta risolta
            partitaIva: r.partitaIva,
            codiceFiscale: r.codiceFiscale,
          }),
          inserisci: async (tx, entita) => {
            // La ditta esistente puo' essere un privato anche se la richiesta non lo diceva.
            const privatoRisolto = eUnPrivato(entita.partitaIva, entita.codiceFiscale)
            if (privatoRisolto !== identificativo.privato) {
              const dopo = validaDatiFiscali(fiscali, { privato: privatoRisolto })
              if (dopo.length > 0) throw nonValido(dopo)
            }

            if (sedeId) {
              const sede = await tx.sedeDitta.findFirst({
                where: { id: sedeId, dittaId: entita.dittaId, tenantId, attiva: true },
                select: { id: true },
              })
              if (!sede) throw new SedeNonValidaPerRuoloError('cliente')
              entita.sedeId = sede.id
            }

            const messaggi = await controllaRiferimenti(tx, tenantId, riferimentiIndicati(fiscali))
            if (messaggi.length > 0) throw nonValido(messaggi)

            const riga = await tx.cliente.create({
              data: { tenantId, dittaId: entita.dittaId, sedeId: entita.sedeId, ...fiscali },
              select: { id: true },
            })
            entita.id = riga.id
            // Solo id e flag: niente identificativi fiscali, codice, nome o note.
            await this.audit(tx, tenantId, utenteId, 'CLIENTE_CREATO', 'creato', {
              clienteId: riga.id,
              dittaId: entita.dittaId,
              dittaEsistente: entita.dittaEsistente,
            })
          },
        })
      } catch (err) {
        return this.traduci(err, () => this.rileggiVincolo(tenantId, fiscali.codice))
      }
      const cliente = await this.leggi(tenantId, esito.ruolo.id as string)
      return { cliente, dittaEsistente: esito.dittaEsistente, avvisi: esito.avvisi }
    })
  }

  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaCliente
  ): Promise<ClienteVista> {
    const { versione, sedeId: sedeRichiesta, attivo, ...patch } = m
    const codiceNuovo = normalizzaDatiFiscali({ codice: patch.codice }).codice
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.cliente.findFirst({ where: { id, tenantId }, include: INCLUDE })
          if (!prima) throw nonTrovato()
          confrontaVersione(prima.versione, versione, ENTITA)

          // Chiave assente = invariato; null = svuota (esigibilita': torna al predefinito).
          const originali = fiscaliDaRiga(prima)
          const grezzo: Record<string, unknown> = { ...originali }
          const richiesti = CAMPI_FISCALI.filter(
            k => (patch as Record<string, unknown>)[k] !== undefined
          )
          for (const k of richiesti) grezzo[k] = (patch as Record<string, unknown>)[k]
          const nuovi = normalizzaDatiFiscali(grezzo)
          const cambiati = (Object.keys(patch) as Array<keyof DatiFiscaliCliente>).filter(
            k => richiesti.includes(k) && !uguali(nuovi[k], originali[k])
          )

          // Dati gia' presenti e invariati non si rivalidano: non bloccano una disattivazione.
          if (cambiati.length > 0) {
            const errori = validaDatiFiscali(nuovi, {
              privato: eUnPrivato(prima.ditta.partitaIva, prima.ditta.codiceFiscale),
            })
            if (errori.length > 0) throw nonValido(errori)
            const nuoviRiferimenti: RiferimentiDaControllare = {}
            const indicati = riferimentiIndicati(nuovi)
            for (const k of Object.keys(indicati) as Array<keyof RiferimentiDaControllare>) {
              if (cambiati.includes(k as keyof DatiFiscaliCliente))
                nuoviRiferimenti[k] = indicati[k]
            }
            if (Object.keys(nuoviRiferimenti).length > 0) {
              const messaggi = await controllaRiferimenti(tx, tenantId, nuoviRiferimenti)
              if (messaggi.length > 0) throw nonValido(messaggi)
            }
          }

          let sedeId = prima.sedeId
          if (sedeRichiesta !== undefined && sedeRichiesta !== prima.sedeId) {
            const sede = await tx.sedeDitta.findFirst({
              where: { id: sedeRichiesta, dittaId: prima.dittaId, tenantId, attiva: true },
              select: { id: true },
            })
            if (!sede) throw new SedeNonValidaPerRuoloError('cliente')
            sedeId = sede.id
          }
          const attivoNuovo = attivo ?? prima.attivo

          const data: Record<string, unknown> = {}
          for (const k of cambiati) data[k] = nuovi[k]
          if (sedeId !== prima.sedeId) data.sedeId = sedeId
          if (attivoNuovo !== prima.attivo) data.attivo = attivoNuovo
          if (Object.keys(data).length === 0)
            return (await this.comeViste(tx, tenantId, [prima]))[0]

          await scriviCondizionato(
            () =>
              tx.cliente.updateMany({
                where: { id, tenantId, versione },
                data: { ...data, versione: { increment: 1 } },
              }),
            ENTITA
          )
          const dopo = await tx.cliente.findFirst({ where: { id, tenantId }, include: INCLUDE })
          if (!dopo) throw nonTrovato()

          // Solo id e nomi dei campi: mai valori (CF, IBAN, PEC, nome, note).
          const campi: string[] = [...cambiati]
          if (sedeId !== prima.sedeId) campi.push('sedeId')
          if (campi.length > 0) {
            await this.audit(tx, tenantId, utenteId, 'CLIENTE_MODIFICATO', 'modificato', {
              clienteId: id,
              campi,
            })
          }
          if (attivoNuovo !== prima.attivo) {
            await this.audit(
              tx,
              tenantId,
              utenteId,
              attivoNuovo ? 'CLIENTE_RIATTIVATO' : 'CLIENTE_DISATTIVATO',
              attivoNuovo ? 'riattivato' : 'disattivato',
              { clienteId: id }
            )
          }
          return (await this.comeViste(tx, tenantId, [dopo]))[0]
        })
        .catch(err => this.traduci(err, () => this.rileggiVincolo(tenantId, codiceNuovo, id)))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.cliente.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovato()
          confrontaVersione(riga.versione, versione, ENTITA)
          // La FK verso i contratti (anche eliminati, R25) fa scattare P2003: CLIENTE_CON_CONTRATTI.
          await scriviCondizionato(
            () => tx.cliente.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'CLIENTE_ELIMINATO', 'eliminato', {
            clienteId: id,
            dittaId: riga.dittaId,
          })
        })
        .catch(err => this.traduci(err))
    )
  }

  async list(
    tenantId: string,
    f: FiltroClienti
  ): Promise<{ elementi: ClienteVista[]; totale: number }> {
    // Mai sul codice fiscale: e' un dato personale e non deve stare in una query string.
    const testo = f.testo?.trim()
    const where: Prisma.ClienteWhereInput = {
      tenantId,
      ...(f.soloAttivi ? { attivo: true } : {}),
      ...(testo && testo.length >= 2
        ? {
            OR: [
              { codice: { contains: testo, mode: 'insensitive' } },
              { ditta: { ragioneSociale: { contains: testo, mode: 'insensitive' } } },
              { ditta: { partitaIva: { contains: testo } } },
            ],
          }
        : {}),
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const righe = await tx.cliente.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ ditta: { ragioneSociale: 'asc' } }, { id: 'asc' }],
          skip: (f.pagina - 1) * f.dimensione,
          take: f.dimensione,
        })
        const totale = await tx.cliente.count({ where })
        return { elementi: await this.comeViste(tx, tenantId, righe), totale }
      })
    )
  }

  async getById(tenantId: string, id: string): Promise<ClienteVista> {
    return nelContestoTenant(tenantId, () => this.leggi(tenantId, id))
  }

  /**
   * Per il Task 16: stato e predefiniti dei clienti scelti, nella transazione del chiamante, con
   * `FOR SHARE` (R24, R40).
   * Un id assente dalla mappa non esiste (o e' di un'altra azienda).
   */
  async attiviPerId(
    tx: Prisma.TransactionClient,
    ids: string[]
  ): Promise<Map<string, ClienteEreditabile>> {
    const tenantId = TenantContext.requireTenantId()
    if (ids.length === 0) return new Map()
    const select: Record<string, true> = {
      id: true,
      dittaId: true,
      attivo: true,
      contoCorrenteId: true,
    }
    // i predefiniti di D4 hanno gli stessi nomi delle colonne del cliente
    for (const c of CAMPI_EREDITATI_DAL_CLIENTE) select[c] = true
    // R24: i clienti scelti restano bloccati fino al commit del chiamante, cosi' una disattivazione
    // concorrente aspetta invece di lasciare un contratto nuovo su un cliente disattivato. Ordinati
    // per id: due contratti che scelgono gli stessi clienti non si bloccano a vicenda.
    const uuid = [...new Set(ids)].filter(id =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    )
    if (uuid.length === 0) return new Map()
    await tx.$queryRaw`SELECT id FROM "clienti"
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${uuid}::uuid[]) ORDER BY id FOR SHARE`
    const righe = await tx.cliente.findMany({
      where: { tenantId, id: { in: uuid } },
      select: select as Prisma.ClienteSelect,
    })
    return new Map(
      (righe as unknown as RigaEreditabile[]).map(r => [
        r.id,
        {
          ...r,
          ritenutaPercentuale:
            r.ritenutaPercentuale == null ? null : r.ritenutaPercentuale.toFixed(2),
        },
      ])
    )
  }

  // ---------------------------------------------------------------------------------------------

  private async leggi(tenantId: string, id: string): Promise<ClienteVista> {
    const riga = await this.prisma.cliente.findFirst({
      where: { id, tenantId },
      include: INCLUDE,
    })
    if (!riga) throw nonTrovato()
    return (await this.comeViste(this.prisma, tenantId, [riga]))[0]
  }

  /** Viste con i conteggi: quattro `groupBy` per tutta la pagina, non una query per riga. */
  private async comeViste(
    client: Pick<PrismaService, 'contrattoCliente'>,
    tenantId: string,
    righe: RigaCliente[]
  ): Promise<ClienteVista[]> {
    if (righe.length === 0) return []
    const ids = righe.map(r => r.id)
    const comeCliente = { tenantId, clienteId: { in: ids } }
    const comeFatturazione = { tenantId, clienteFatturazioneId: { in: ids } }
    const [viviCliente, viviFatt, tuttiCliente, tuttiFatt] = await Promise.all([
      client.contrattoCliente.groupBy({
        by: ['clienteId'],
        where: { ...comeCliente, eliminatoIl: null },
        _count: { _all: true },
      }),
      client.contrattoCliente.groupBy({
        by: ['clienteFatturazioneId'],
        where: { ...comeFatturazione, eliminatoIl: null },
        _count: { _all: true },
      }),
      client.contrattoCliente.groupBy({
        by: ['clienteId'],
        where: comeCliente,
        _count: { _all: true },
      }),
      client.contrattoCliente.groupBy({
        by: ['clienteFatturazioneId'],
        where: comeFatturazione,
        _count: { _all: true },
      }),
    ])
    const somma = (...gruppi: Array<Array<Record<string, unknown>>>) => {
      const m = new Map<string, number>()
      for (const g of gruppi) {
        for (const x of g) {
          const chiave = (x.clienteId ?? x.clienteFatturazioneId) as string | null
          if (chiave) m.set(chiave, (m.get(chiave) ?? 0) + (x._count as { _all: number })._all)
        }
      }
      return m
    }
    const vivi = somma(viviCliente, viviFatt)
    const tutti = somma(tuttiCliente, tuttiFatt)
    return righe.map(r => ({
      id: r.id,
      versione: r.versione,
      attivo: r.attivo,
      codice: r.codice,
      codiceDestinatario: r.codiceDestinatario,
      pecFatturazione: r.pecFatturazione,
      riferimentoAmministrazione: r.riferimentoAmministrazione,
      iban: r.iban,
      contoCorrenteId: r.contoCorrenteId,
      condizionePagamentoId: r.condizionePagamentoId,
      esigibilitaIva: r.esigibilitaIva,
      registroIvaId: r.registroIvaId,
      speseIncassoId: r.speseIncassoId,
      bolloId: r.bolloId,
      agenteId: r.agenteId,
      ritenutaPercentuale: r.ritenutaPercentuale === null ? null : r.ritenutaPercentuale.toFixed(2),
      nome: r.nome,
      cognome: r.cognome,
      note: r.note,
      ditta: {
        id: r.ditta.id,
        ragioneSociale: r.ditta.ragioneSociale,
        partitaIva: r.ditta.partitaIva,
        codiceFiscale: r.ditta.codiceFiscale,
        privato: eUnPrivato(r.ditta.partitaIva, r.ditta.codiceFiscale),
      },
      sedeFatturazione: comeSede(r.sede),
      condizionePagamento: rif(r.condizionePagamento),
      contoCorrente: rif(r.contoCorrente),
      registroIva: rif(r.registroIva),
      speseIncasso: rif(r.speseIncasso),
      bollo: rif(r.bollo),
      agente: r.agente
        ? { id: r.agente.id, codice: r.agente.codice, descrizione: r.agente.ditta.ragioneSociale }
        : null,
      contratti: vivi.get(r.id) ?? 0,
      eliminabile: (tutti.get(r.id) ?? 0) === 0,
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

  /**
   * Dopo una P2002 senza `meta.target` (RLS), FUORI dalla transazione abortita: il codice e' gia'
   * di un altro cliente? Se si', e' il vincolo del codice; altrimenti l'unica altra chiave unica e'
   * quella della ditta (ruolo gia' presente).
   */
  private async rileggiVincolo(
    tenantId: string,
    codice: string | null,
    escludiId?: string
  ): Promise<string | null> {
    if (codice !== null) {
      const altro = await this.prisma.cliente.findFirst({
        where: { tenantId, codice, ...(escludiId ? { id: { not: escludiId } } : {}) },
        select: { id: true },
      })
      if (altro) return VINCOLO_CODICE
    }
    return escludiId ? VINCOLO_CODICE : VINCOLO_DITTA
  }

  /** Audit nella stessa transazione: solo id e flag, mai codice, nome, note o dati fiscali. */
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
        description: `Cliente ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}

/** Stato e predefiniti del cliente per il contratto (D4). */
export interface ClienteEreditabile {
  id: string
  dittaId: string
  attivo: boolean
  contoCorrenteId: string | null
  condizionePagamentoId: string | null
  agenteId: string | null
  registroIvaId: string | null
  speseIncassoId: string | null
  bolloId: string | null
  esigibilitaIva: 'IMMEDIATA' | 'DIFFERITA' | 'SCISSIONE'
  /** Stringa decimale con due cifre (R40), mai un `Decimal`. */
  ritenutaPercentuale: string | null
  codiceDestinatario: string | null
  riferimentoAmministrazione: string | null
}

type RigaEreditabile = Omit<ClienteEreditabile, 'ritenutaPercentuale'> & {
  ritenutaPercentuale: Prisma.Decimal | null
}
