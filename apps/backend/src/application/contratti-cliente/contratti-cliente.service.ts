// Contratti cliente (4.1b, Task 16): creazione con i predefiniti del cliente (D4, R35), contratto
// allegato (D28) e letture (vista, elenco, numero proposto). Modifica, stato, rinnovo ed
// eliminazione sono del Task 17.
//
// Ordine della creazione (D14): validazione pura, poi la transazione che legge i riferimenti
// (clienti, sede, tabelle, contratto principale) con i lock di R24, scrive contratto e periodi e
// lascia l'audit. Cliente, sede e tabelle scelte restano bloccate con `FOR SHARE` fino al commit
// (una disattivazione concorrente aspetta e poi vede un contratto che la cita); il contratto
// principale con `FOR UPDATE` (D28: due allegamenti concorrenti non fanno una catena).
//
// Il cliente che riceve i predefiniti e' il cliente del contratto; il recapito SDI (codice
// destinatario e riferimento amministrazione) si copia invece dal cliente di fatturazione se il
// contratto ne ha uno diverso (R35). Il contratto non ha una PEC propria: quella resta sul cliente
// e la legge chi fattura. Il conto corrente NON si copia: l'effettivo e' calcolato nella vista.
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import {
  CAMPI_EREDITATI_DAL_CLIENTE,
  CAMPI_MODIFICABILI,
  TRANSIZIONI,
  contoCorrenteEffettivo,
  motivoNonEliminabile,
  normalizzaContratto,
  rinnovabile,
  scaduto,
  validaContrattoCliente,
  type CampoContrattoCliente,
  type CodiceRinnovo,
  type DatiContrattoCliente,
  type StatoContrattoCliente,
  type UnitaValidita,
} from '../../domain/contratti-cliente/regole-contratto-cliente'
import { prossimaFinePeriodo } from '../../domain/contratti-cliente/periodi-fatturazione'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../clienti/anagrafica-versionata'
import { ClientiService, type ClienteEreditabile } from '../clienti/clienti.service'
import {
  controllaRiferimenti,
  type RiferimentiDaControllare,
} from '../clienti/riferimenti-fatturazione'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'

/** Token dell'orologio iniettabile: i test fissano "oggi" senza toccare il tempo di sistema. */
export const OROLOGIO = Symbol('OROLOGIO')
export type Orologio = () => Date

type Rif = { id: string; codice: string | null; descrizione: string } | null

export interface ContrattoClienteVista extends DatiContrattoCliente {
  id: string
  stato: StatoContrattoCliente
  versione: number
  motivoAnnullo: string | null
  motivoAnnulloCodifica: Rif
  annullatoIl: string | null
  cliente: { id: string; ragioneSociale: string; partitaIva: string | null; attivo: boolean }
  clienteFatturazione: { id: string; ragioneSociale: string; partitaIva: string | null } | null
  /** "Via X 1, Comune (PR)". */
  sede: { id: string; descrizione: string } | null
  categoria: Rif
  tipo: Rif
  condizionePagamento: Rif
  contoCorrente: Rif
  speseIncasso: Rif
  bollo: Rif
  registroIva: Rif
  agente: Rif
  testoFatturazione: Rif
  /** Conto del contratto, altrimenti quello del cliente (D4). */
  contoCorrenteEffettivo: Rif
  contrattoPrincipale: { id: string; numero: string } | null
  /** Contratti allegati a questo (non eliminati). */
  allegati: number
  allegatiPdf: { posizione: 1 | 2; nomeFile: string }[]
  scaduto: boolean
  prossimaFinePeriodo: string | null
  modificabili: CampoContrattoCliente[]
  transizioni: StatoContrattoCliente[]
  eliminabile: boolean
  rinnovabile: boolean
}

export type DatiCreazioneContratto = Partial<DatiContrattoCliente> & {
  numero: string
  descrizione: string
  clienteId: string
  dataInizio: string
}

export interface FiltroContratti {
  stato?: StatoContrattoCliente
  clienteId?: string
  categoriaId?: string
  tipoId?: string
  testo?: string
  inScadenzaEntroGiorni?: number
  pagina: number
  dimensione: number
}

const ENTITA: DescrizioneEntita = {
  prefisso: 'CONTRATTO_CLIENTE',
  soggetto: 'Il contratto',
  femminile: false,
}

const VINCOLO_NUMERO = 'contratti_cliente_tenant_id_numero_key'
const VINCOLI = {
  [VINCOLO_NUMERO]: {
    codice: 'CONTRATTO_CLIENTE_NUMERO_DUPLICATO',
    messaggio: 'Esiste già un contratto con questo numero.',
  },
} as const

const MSG_CLIENTE = 'Il cliente scelto non esiste o è disattivato.'
const MSG_FATTURAZIONE = 'Il cliente di fatturazione scelto non esiste o è disattivato.'
const MSG_SEDE = 'La sede scelta non è una sede attiva del cliente.'
const MSG_PRINCIPALE =
  'Il contratto principale deve essere un contratto dello stesso cliente, non annullato e non allegato a sua volta.'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INCLUDE = {
  cliente: { include: { ditta: true, contoCorrente: true } },
  clienteFatturazione: { include: { ditta: true } },
  sede: true,
  categoria: true,
  tipo: true,
  condizionePagamento: true,
  contoCorrente: true,
  speseIncasso: true,
  bollo: true,
  registroIva: true,
  agente: { include: { ditta: true } },
  testoFatturazione: true,
  motivoAnnulloCodifica: true,
  contrattoPrincipale: { select: { id: true, numero: true } },
  periodi: { orderBy: { ordine: 'asc' } },
  // Mai `contenuto`: la vista porta solo posizione e nome (D29).
  allegatiPdf: { select: { posizione: true, nomeFile: true }, orderBy: { posizione: 'asc' } },
  _count: { select: { contrattiAllegati: { where: { eliminatoIl: null } } } },
} satisfies Prisma.ContrattoClienteInclude

type RigaContratto = Prisma.ContrattoClienteGetPayload<{ include: typeof INCLUDE }>

const nonTrovato = () =>
  new NotFoundException({
    message: 'Contratto non trovato.',
    error: 'CONTRATTO_CLIENTE_NON_TROVATO',
  })

const nonValido = (messaggi: string[]) =>
  new BadRequestException({ message: messaggi, error: 'CONTRATTO_CLIENTE_NON_VALIDO' })

/** Data `YYYY-MM-DD` come colonna `DATE` (mezzanotte UTC, nessun fuso). */
const comeData = (d: string | null): Date | null =>
  d === null ? null : new Date(`${d}T00:00:00.000Z`)
const comeGiorno = (d: Date | null): string | null =>
  d === null ? null : d.toISOString().slice(0, 10)
const comeDecimale = (d: { toFixed(n: number): string } | null): string | null =>
  d === null || d === undefined ? null : d.toFixed(2)

function rif(r: { id: string; codice: string | null; descrizione: string } | null): Rif {
  return r ? { id: r.id, codice: r.codice, descrizione: r.descrizione } : null
}

function piuGiorni(giorno: string, n: number): Date {
  const [a, m, g] = giorno.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, g + n))
}

@Injectable()
export class ContrattiClienteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clienti: ClientiService,
    @Optional() @Inject(OROLOGIO) private readonly orologio: Orologio = () => new Date()
  ) {}

  async crea(
    tenantId: string,
    utenteId: string,
    d: DatiCreazioneContratto
  ): Promise<ContrattoClienteVista> {
    // 1. Validazione pura sul corpo, prima di ogni lettura del database (D9, D14).
    const errori = validaContrattoCliente(normalizzaContratto({ ...d }))
    if (errori.length > 0) throw nonValido(errori)

    return nelContestoTenant(tenantId, async () => {
      const id = await this.prisma
        .$transaction(tx => this.scrivi(tx, tenantId, utenteId, d))
        .catch(err => this.traduci(err))
      return this.leggi(tenantId, id)
    })
  }

  private async scrivi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    d: DatiCreazioneContratto
  ): Promise<string> {
    const base = normalizzaContratto({ ...d })
    const messaggi: string[] = []

    // 2. Cliente e cliente di fatturazione: esistenti, attivi, bloccati con FOR SHARE (R24, R40).
    const idCliente = base.clienteId.toLowerCase()
    const idFatturazione = base.clienteFatturazioneId?.toLowerCase() ?? null
    const trovati = await this.clienti.attiviPerId(tx, [
      idCliente,
      ...(idFatturazione ? [idFatturazione] : []),
    ])
    const cliente = trovati.get(idCliente)
    if (!cliente?.attivo) messaggi.push(MSG_CLIENTE)
    const fatturazione = idFatturazione ? trovati.get(idFatturazione) : undefined
    if (idFatturazione && !fatturazione?.attivo) messaggi.push(MSG_FATTURAZIONE)

    // 3. Predefiniti (D4): solo i campi assenti dal corpo; un `null` esplicito vince.
    const completo: Record<string, unknown> = { ...d }
    if (cliente) {
      for (const campo of CAMPI_EREDITATI_DAL_CLIENTE) {
        if (campo === 'codiceDestinatario' || campo === 'riferimentoAmministrazione') continue
        if (completo[campo] === undefined)
          completo[campo] = cliente[campo as keyof ClienteEreditabile]
      }
      // R35: il recapito SDI viene dal cliente di fatturazione, se diverso; codice e riferimento
      // viaggiano in coppia (un riferimento senza il suo codice non avrebbe senso).
      const sorgente = fatturazione?.attivo ? fatturazione : cliente
      if (completo.codiceDestinatario === undefined) {
        completo.codiceDestinatario = sorgente.codiceDestinatario
        if (completo.riferimentoAmministrazione === undefined) {
          completo.riferimentoAmministrazione = sorgente.riferimentoAmministrazione
        }
      }
    }
    const dati = normalizzaContratto(completo)
    if (cliente) messaggi.push(...validaContrattoCliente(dati))

    // 4. Sede attiva della ditta del cliente, bloccata.
    if (dati.sedeId !== null && cliente) {
      const ok =
        UUID.test(dati.sedeId) &&
        (
          await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "sedi_ditte"
            WHERE tenant_id = ${tenantId}::uuid AND id = ${dati.sedeId}::uuid
              AND ditta_id = ${cliente.dittaId}::uuid AND attiva = true FOR SHARE`
        ).length > 0
      if (!ok) messaggi.push(MSG_SEDE)
    }

    // 5. Tabelle, agente, testo e codifiche (anche quelle ereditate: un predefinito disattivato nel
    //    frattempo non entra in un contratto nuovo).
    const riferimenti: RiferimentiDaControllare = {}
    for (const k of [
      'condizionePagamentoId',
      'contoCorrenteId',
      'speseIncassoId',
      'bolloId',
      'registroIvaId',
      'agenteId',
      'testoFatturazioneId',
      'categoriaId',
      'tipoId',
    ] as const) {
      if (dati[k] !== null) riferimenti[k] = dati[k]
    }
    messaggi.push(...(await controllaRiferimenti(tx, tenantId, riferimenti)))

    // 6. Contratto principale (D28), con FOR UPDATE.
    if (dati.contrattoPrincipaleId !== null) {
      const idPrincipale = dati.contrattoPrincipaleId
      const righe = UUID.test(idPrincipale)
        ? await tx.$queryRaw<
            Array<{
              id: string
              clienteId: string
              stato: string
              eliminato: boolean
              contrattoPrincipaleId: string | null
            }>
          >`SELECT id::text AS id, cliente_id::text AS "clienteId", stato::text AS stato,
              (eliminato_il IS NOT NULL) AS eliminato,
              contratto_principale_id::text AS "contrattoPrincipaleId"
            FROM "contratti_cliente"
            WHERE tenant_id = ${tenantId}::uuid AND id = ${idPrincipale}::uuid FOR UPDATE`
        : []
      const p = righe[0]
      const valido =
        p !== undefined &&
        p.clienteId.toLowerCase() === idCliente &&
        !p.eliminato &&
        p.stato !== 'ANNULLATO' &&
        p.contrattoPrincipaleId === null
      if (!valido) messaggi.push(MSG_PRINCIPALE)
    }

    if (messaggi.length > 0) throw nonValido(messaggi)

    // 7. Scrittura: contratto in BOZZA e periodi 1..n nella stessa transazione.
    const { periodi, ...scalari } = dati
    const riga = await tx.contrattoCliente.create({
      data: {
        ...scalari,
        tenantId,
        dataInizio: comeData(dati.dataInizio) as Date,
        dataFine: comeData(dati.dataFine),
        dataStipula: comeData(dati.dataStipula),
        sogliaDal: comeData(dati.sogliaDal),
      },
      select: { id: true },
    })
    if (periodi.length > 0) {
      await tx.periodoFatturazioneCliente.createMany({
        data: periodi.map((p, i) => ({
          tenantId,
          contrattoId: riga.id,
          ordine: i + 1,
          giornoInizio: p.giornoInizio,
          meseInizio: p.meseInizio,
          giornoFine: p.giornoFine,
          meseFine: p.meseFine,
        })),
      })
    }
    // Solo id e numero: niente dati del cliente o del contratto.
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action: 'CONTRATTO_CLIENTE_CREATO',
        description: 'Contratto cliente creato',
        metadata: { contrattoId: riga.id, numero: dati.numero } as Prisma.InputJsonValue,
      },
    })
    return riga.id
  }

  async list(
    tenantId: string,
    f: FiltroContratti
  ): Promise<{ elementi: ContrattoClienteVista[]; totale: number }> {
    const oggi = giornoItaliano(this.orologio())
    const testo = f.testo?.trim()
    const where: Prisma.ContrattoClienteWhereInput = {
      tenantId,
      eliminatoIl: null,
      ...(f.stato ? { stato: f.stato } : {}),
      ...(f.clienteId ? { clienteId: f.clienteId } : {}),
      ...(f.categoriaId ? { categoriaId: f.categoriaId } : {}),
      ...(f.tipoId ? { tipoId: f.tipoId } : {}),
      ...(f.inScadenzaEntroGiorni !== undefined
        ? { dataFine: { gte: piuGiorni(oggi, 0), lte: piuGiorni(oggi, f.inScadenzaEntroGiorni) } }
        : {}),
      ...(testo && testo.length >= 2
        ? {
            OR: [
              { numero: { contains: testo, mode: 'insensitive' } },
              { descrizione: { contains: testo, mode: 'insensitive' } },
              { commessa: { contains: testo, mode: 'insensitive' } },
              { cliente: { ditta: { ragioneSociale: { contains: testo, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const righe = await tx.contrattoCliente.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ numero: 'desc' }, { id: 'asc' }],
          skip: (f.pagina - 1) * f.dimensione,
          take: f.dimensione,
        })
        const totale = await tx.contrattoCliente.count({ where })
        return { elementi: righe.map(r => this.comeVista(r, oggi)), totale }
      })
    )
  }

  async getById(tenantId: string, id: string): Promise<ContrattoClienteVista> {
    return nelContestoTenant(tenantId, () => this.leggi(tenantId, id))
  }

  /**
   * `CC-<anno>-<NNN>` (D12): il massimo progressivo dell'anno di Roma piu' uno, contando anche i
   * contratti eliminati (il numero resta riservato). Informativo: non riserva nulla.
   */
  async prossimoNumero(tenantId: string): Promise<string> {
    const anno = giornoItaliano(this.orologio()).slice(0, 4)
    const prefisso = `CC-${anno}-`
    const esistenti = await nelContestoTenant(tenantId, () =>
      this.prisma.contrattoCliente.findMany({
        where: { tenantId, numero: { startsWith: prefisso } },
        select: { numero: true },
      })
    )
    const massimo = esistenti.reduce((max, { numero }) => {
      const coda = numero.slice(prefisso.length)
      // Solo progressivi puramente numerici: "004" conta, "004-bis" no.
      return /^\d+$/.test(coda) ? Math.max(max, Number(coda)) : max
    }, 0)
    return `${prefisso}${String(massimo + 1).padStart(3, '0')}`
  }

  // ---------------------------------------------------------------------------------------------

  private async leggi(tenantId: string, id: string): Promise<ContrattoClienteVista> {
    const riga = UUID.test(id)
      ? await this.prisma.contrattoCliente.findFirst({
          where: { id, tenantId, eliminatoIl: null },
          include: INCLUDE,
        })
      : null
    if (!riga) throw nonTrovato()
    return this.comeVista(riga, giornoItaliano(this.orologio()))
  }

  /** Solo il P2002 del numero; ogni altro errore (anche un P2003) passa com'e'. */
  private async traduci(err: unknown): Promise<never> {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return traduciErrorePrisma(err, ENTITA, VINCOLI)
    }
    throw err
  }

  private comeVista(r: RigaContratto, oggi: string): ContrattoClienteVista {
    const stato = r.stato as StatoContrattoCliente
    const dataFine = comeGiorno(r.dataFine)
    const periodi = r.periodi.map(p => ({
      giornoInizio: p.giornoInizio,
      meseInizio: p.meseInizio,
      giornoFine: p.giornoFine,
      meseFine: p.meseFine,
    }))
    const idConto = contoCorrenteEffettivo(
      { contoCorrenteId: r.contoCorrenteId },
      { contoCorrenteId: r.cliente.contoCorrenteId }
    )
    const contoEffettivo =
      idConto === null
        ? null
        : idConto === r.contoCorrente?.id
          ? r.contoCorrente
          : r.cliente.contoCorrente
    const allegati = r._count.contrattiAllegati
    return {
      id: r.id,
      stato,
      versione: r.versione,
      numero: r.numero,
      descrizione: r.descrizione,
      clienteId: r.clienteId,
      clienteFatturazioneId: r.clienteFatturazioneId,
      sedeId: r.sedeId,
      categoriaId: r.categoriaId,
      tipoId: r.tipoId,
      dataInizio: comeGiorno(r.dataInizio),
      dataFine,
      dataStipula: comeGiorno(r.dataStipula),
      validitaQuantita: r.validitaQuantita,
      validitaUnita: r.validitaUnita as UnitaValidita | null,
      contrattoPrincipaleId: r.contrattoPrincipaleId,
      condizionePagamentoId: r.condizionePagamentoId,
      contoCorrenteId: r.contoCorrenteId,
      speseIncassoId: r.speseIncassoId,
      bolloId: r.bolloId,
      registroIvaId: r.registroIvaId,
      esigibilitaIva: r.esigibilitaIva,
      ritenutaPercentuale: comeDecimale(r.ritenutaPercentuale),
      agenteId: r.agenteId,
      testoFatturazioneId: r.testoFatturazioneId,
      codiceDestinatario: r.codiceDestinatario,
      riferimentoAmministrazione: r.riferimentoAmministrazione,
      codiceCig: r.codiceCig,
      codiceCup: r.codiceCup,
      idDocumentoPa: r.idDocumentoPa,
      escludiDichiarazioneIntento: r.escludiDichiarazioneIntento,
      sogliaDal: comeGiorno(r.sogliaDal),
      sogliaImporto: comeDecimale(r.sogliaImporto),
      sogliaIvaEsclusa: r.sogliaIvaEsclusa,
      rinnovoAutomatico: r.rinnovoAutomatico,
      codiceRinnovo: r.codiceRinnovo as CodiceRinnovo | null,
      incrementoIstat: r.incrementoIstat,
      commessa: r.commessa,
      annotazioni: [...r.annotazioni],
      periodi,
      motivoAnnullo: r.motivoAnnullo,
      motivoAnnulloCodifica: rif(r.motivoAnnulloCodifica),
      annullatoIl: r.annullatoIl === null ? null : r.annullatoIl.toISOString(),
      cliente: {
        id: r.cliente.id,
        ragioneSociale: r.cliente.ditta.ragioneSociale,
        partitaIva: r.cliente.ditta.partitaIva,
        attivo: r.cliente.attivo,
      },
      clienteFatturazione: r.clienteFatturazione
        ? {
            id: r.clienteFatturazione.id,
            ragioneSociale: r.clienteFatturazione.ditta.ragioneSociale,
            partitaIva: r.clienteFatturazione.ditta.partitaIva,
          }
        : null,
      sede: r.sede
        ? {
            id: r.sede.id,
            descrizione: `${r.sede.via} ${r.sede.civico}, ${r.sede.comune} (${r.sede.provincia})`,
          }
        : null,
      categoria: rif(r.categoria),
      tipo: rif(r.tipo),
      condizionePagamento: rif(r.condizionePagamento),
      contoCorrente: rif(r.contoCorrente),
      speseIncasso: rif(r.speseIncasso),
      bollo: rif(r.bollo),
      registroIva: rif(r.registroIva),
      agente: r.agente
        ? { id: r.agente.id, codice: r.agente.codice, descrizione: r.agente.ditta.ragioneSociale }
        : null,
      testoFatturazione: r.testoFatturazione
        ? {
            id: r.testoFatturazione.id,
            codice: r.testoFatturazione.codice,
            descrizione: r.testoFatturazione.titolo,
          }
        : null,
      contoCorrenteEffettivo: rif(contoEffettivo),
      contrattoPrincipale: r.contrattoPrincipale
        ? { id: r.contrattoPrincipale.id, numero: r.contrattoPrincipale.numero }
        : null,
      allegati,
      allegatiPdf: r.allegatiPdf.map(a => ({
        posizione: a.posizione as 1 | 2,
        nomeFile: a.nomeFile,
      })),
      scaduto: scaduto(dataFine, oggi),
      prossimaFinePeriodo: prossimaFinePeriodo(periodi, oggi),
      modificabili: [...CAMPI_MODIFICABILI[stato]],
      transizioni: [...TRANSIZIONI[stato]],
      // Si eliminano solo le bozze, e senza contratti allegati (D13)
      eliminabile: motivoNonEliminabile(stato) === null && allegati === 0,
      rinnovabile: rinnovabile(stato, dataFine),
    }
  }
}
