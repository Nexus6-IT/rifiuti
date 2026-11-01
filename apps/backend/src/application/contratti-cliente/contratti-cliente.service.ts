// Contratti cliente (4.1b, Task 16): creazione con i predefiniti del cliente (D4, R35), contratto
// allegato (D28) e letture (vista, elenco, numero proposto); Task 17: modifica con lock ottimistico,
// cambio di stato ed eliminazione logica; Task 18: rinnovo di un contratto e proroga massiva delle
// scadenze (D11).
//
// Modifica, stato ed eliminazione partono dallo stesso passo: `SELECT ... FOR UPDATE` della riga del
// contratto, poi la lettura. Due scritture sullo stesso contratto si mettono in fila e la seconda
// vede la versione della prima (409), quindi i periodi restano quelli della prima. Un allegamento
// blocca anche il principale (D28): A->B e B->C in parallelo non fanno una catena, perche' chi
// arriva dopo rilegge la riga bloccata e la trova gia' cambiata. Ordine dei controlli (D14): 404,
// stato che non ammette l'operazione, versione, campi non ammessi, validazione pura, database,
// scrittura condizionata con audit.
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
  ConflictException,
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
  dataPiuUnAnno,
  contoCorrenteEffettivo,
  ETICHETTE_STATO,
  motivoNonEliminabile,
  motivoNonModificabile,
  normalizzaContratto,
  pianificaModifica,
  rinnovabile,
  scaduto,
  validaContrattoCliente,
  verificaTransizione,
  type CampoContrattoCliente,
  type CodiceRinnovo,
  type DatiContrattoCliente,
  type ModificaContrattoCliente,
  type StatoContrattoCliente,
  type UnitaValidita,
} from '../../domain/contratti-cliente/regole-contratto-cliente'
import { prossimaFinePeriodo } from '../../domain/contratti-cliente/periodi-fatturazione'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaVersione,
  modificatoNelFrattempo,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
} from '../clienti/anagrafica-versionata'
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

/** Filtri della proroga massiva (D11): il servizio li vuole sempre valorizzati. */
export interface FiltroProroga {
  /** Giorno `YYYY-MM-DD`: si prorogano i contratti con fine uguale o anteriore. */
  scadutiEntro: string
  soloRinnovoAutomatico: boolean
  ancheSospesi: boolean
  clienteId?: string
  categoriaId?: string
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
const MSG_HA_ALLEGATI =
  'Questo contratto ha dei contratti allegati: non può essere allegato a un altro.'
const MSG_CLIENTE_CON_ALLEGATI =
  'Questo contratto ha dei contratti allegati: non se ne cambia il cliente.'

type ChiaveRiferimento =
  | 'condizionePagamentoId'
  | 'contoCorrenteId'
  | 'speseIncassoId'
  | 'bolloId'
  | 'registroIvaId'
  | 'agenteId'
  | 'testoFatturazioneId'
  | 'categoriaId'
  | 'tipoId'

const CHIAVI_RIFERIMENTO: readonly ChiaveRiferimento[] = [
  'condizionePagamentoId',
  'contoCorrenteId',
  'speseIncassoId',
  'bolloId',
  'registroIvaId',
  'agenteId',
  'testoFatturazioneId',
  'categoriaId',
  'tipoId',
]

/** Predefiniti del cliente che sono riferimenti a tabelle (il conto non si eredita). */
const CHIAVI_EREDITATE: readonly ChiaveRiferimento[] = [
  'condizionePagamentoId',
  'speseIncassoId',
  'bolloId',
  'registroIvaId',
  'agenteId',
]

const CODA_PREDEFINITO = "scegline un'altra o lascia il campo vuoto."
const MSG_PREDEFINITO: Readonly<Record<ChiaveRiferimento, string>> = {
  condizionePagamentoId: `La condizione di pagamento predefinita del cliente è disattivata: ${CODA_PREDEFINITO}`,
  speseIncassoId: `Le spese di incasso predefinite del cliente non sono più utilizzabili: ${CODA_PREDEFINITO}`,
  bolloId: `Il bollo predefinito del cliente non è più utilizzabile: ${CODA_PREDEFINITO}`,
  registroIvaId: `Il registro IVA predefinito del cliente non è più utilizzabile: ${CODA_PREDEFINITO}`,
  agenteId: `L'agente predefinito del cliente è disattivato: ${CODA_PREDEFINITO}`,
  contoCorrenteId: '',
  testoFatturazioneId: '',
  categoriaId: '',
  tipoId: '',
}

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

const CAMPI_DATA: readonly CampoContrattoCliente[] = [
  'dataInizio',
  'dataFine',
  'dataStipula',
  'sogliaDal',
]

/** Gli id che arrivano dal client si confrontano e si bloccano in minuscolo, come nella creazione. */
function minuscoleGliId(m: ModificaContrattoCliente): ModificaContrattoCliente {
  const r: Record<string, unknown> = { ...m }
  for (const [k, v] of Object.entries(r)) {
    if (k.endsWith('Id') && typeof v === 'string' && UUID.test(v)) r[k] = v.toLowerCase()
  }
  return r as ModificaContrattoCliente
}

/**
 * Campi dell'audit di cui si riportano i valori prima/dopo (D16): date, flag, esigibilita',
 * percentuali, durata, codice di rinnovo e id dei riferimenti. Mai testo libero, codici fiscali,
 * recapiti, CIG/CUP, commessa, annotazioni o importi.
 */
const CAMPI_AUDIT_CON_VALORE: readonly CampoContrattoCliente[] = [
  'clienteId',
  'clienteFatturazioneId',
  'sedeId',
  'categoriaId',
  'tipoId',
  'dataInizio',
  'dataFine',
  'dataStipula',
  'validitaQuantita',
  'validitaUnita',
  'contrattoPrincipaleId',
  'condizionePagamentoId',
  'contoCorrenteId',
  'speseIncassoId',
  'bolloId',
  'registroIvaId',
  'esigibilitaIva',
  'ritenutaPercentuale',
  'agenteId',
  'testoFatturazioneId',
  'escludiDichiarazioneIntento',
  'sogliaDal',
  'sogliaIvaEsclusa',
  'rinnovoAutomatico',
  'codiceRinnovo',
  'incrementoIstat',
]

function metadataModifica(
  contrattoId: string,
  numero: string,
  prima: DatiContrattoCliente,
  dopo: DatiContrattoCliente,
  cambiati: CampoContrattoCliente[]
): Prisma.InputJsonValue {
  const valori = cambiati.filter(c => CAMPI_AUDIT_CON_VALORE.includes(c))
  const estrai = (d: DatiContrattoCliente) =>
    Object.fromEntries(valori.map(c => [c, d[c] ?? null])) as Prisma.InputJsonObject
  return {
    contrattoId,
    numero,
    campi: cambiati,
    prima: estrai(normalizzaContratto(prima)),
    dopo: estrai(dopo),
  }
}

function datiDaRiga(
  r: Prisma.ContrattoClienteGetPayload<{ include: typeof INCLUDE }>
): DatiContrattoCliente {
  return {
    numero: r.numero,
    descrizione: r.descrizione,
    clienteId: r.clienteId,
    clienteFatturazioneId: r.clienteFatturazioneId,
    sedeId: r.sedeId,
    categoriaId: r.categoriaId,
    tipoId: r.tipoId,
    dataInizio: comeGiorno(r.dataInizio),
    dataFine: comeGiorno(r.dataFine),
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
    periodi: r.periodi.map(p => ({
      giornoInizio: p.giornoInizio,
      meseInizio: p.meseInizio,
      giornoFine: p.giornoFine,
      meseFine: p.meseFine,
    })),
  }
}

/** `YYYY-MM-DD` che esiste davvero nel calendario (2026-02-30 no). */
function giornoValido(g: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g)) return false
  const [a, m, d] = g.split('-').map(Number)
  const data = new Date(Date.UTC(a, m - 1, d))
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d
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
    // Un riferimento senza codice nel corpo non e' ancora un errore: il codice puo' arrivare dal
    // cliente (D4). Il controllo della coppia lo rifa `scrivi` dopo l'ereditarieta'.
    const corpo: Record<string, unknown> = { ...d }
    if (corpo.codiceDestinatario === undefined) delete corpo.riferimentoAmministrazione
    const errori = validaContrattoCliente(normalizzaContratto(corpo))
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

    // 3. Predefiniti (D4): solo i campi assenti dal corpo; un `null` esplicito vince. Con il cliente
    //    disattivato si segnala solo quello (M3).
    const completo: Record<string, unknown> = { ...d }
    const ereditati: ChiaveRiferimento[] = []
    if (cliente?.attivo) {
      for (const campo of CAMPI_EREDITATI_DAL_CLIENTE) {
        if (campo === 'codiceDestinatario' || campo === 'riferimentoAmministrazione') continue
        if (completo[campo] !== undefined) continue
        completo[campo] = cliente[campo as keyof ClienteEreditabile]
        if (completo[campo] !== null && (CHIAVI_EREDITATE as readonly string[]).includes(campo)) {
          ereditati.push(campo as ChiaveRiferimento)
        }
      }
      // R35: il recapito SDI viene dal cliente di fatturazione, se diverso (la PEC, che non e' una
      // colonna del contratto, la legge chi fattura dalla stessa sorgente di `destinatarioEffettivo`).
      const sorgente = fatturazione?.attivo ? fatturazione : cliente
      if (completo.codiceDestinatario === undefined) {
        completo.codiceDestinatario = sorgente.codiceDestinatario
      }
      // Il riferimento si eredita anche se il corpo cambia il codice (il form lo mostra), salvo che il
      // codice effettivo manchi o sia 0000000: li' non avrebbe senso (I2).
      if (completo.riferimentoAmministrazione === undefined) {
        const codice = normalizzaContratto(completo).codiceDestinatario
        completo.riferimentoAmministrazione =
          codice === null || codice === '0000000' ? null : sorgente.riferimentoAmministrazione
      }
    }
    const dati = normalizzaContratto(completo)
    if (cliente?.attivo) messaggi.push(...validaContrattoCliente(dati))

    // 4. Sede attiva della ditta del cliente, bloccata.
    if (dati.sedeId !== null && cliente?.attivo) {
      if (!(await this.sedeDelCliente(tx, tenantId, dati.sedeId, cliente.dittaId))) {
        messaggi.push(MSG_SEDE)
      }
    }

    // 5. Tabelle, agente, testo e codifiche. Quelle scelte dall'operatore hanno il messaggio
    //    generico; i predefiniti ereditati si controllano a parte, un campo per volta, con un
    //    messaggio dedicato (R42): mai null in silenzio.
    const scelti: RiferimentiDaControllare = {}
    for (const k of CHIAVI_RIFERIMENTO) {
      if (dati[k] !== null && !ereditati.includes(k)) scelti[k] = dati[k]
    }
    if (cliente?.attivo) messaggi.push(...(await controllaRiferimenti(tx, tenantId, scelti)))
    for (const k of ereditati) {
      const esito = await controllaRiferimenti(tx, tenantId, { [k]: dati[k] })
      if (esito.length > 0) messaggi.push(MSG_PREDEFINITO[k])
    }

    // 6. Contratto principale (D28), con FOR UPDATE.
    if (dati.contrattoPrincipaleId !== null) {
      if (!(await this.principaleValido(tx, tenantId, dati.contrattoPrincipaleId, idCliente))) {
        messaggi.push(MSG_PRINCIPALE)
      }
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
          // per creazione: `numero` e' testo e CC-2026-1000 starebbe prima di CC-2026-999 (M6)
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
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

  /**
   * Il P2002 del numero; un deadlock (due allegamenti incrociati, P2034 o 40P01 dal raw) vale
   * "modificato nel frattempo"; ogni altro errore (anche un P2003) passa com'e'.
   */
  private async traduci(err: unknown): Promise<never> {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return traduciErrorePrisma(err, ENTITA, VINCOLI)
      if (err.code === 'P2034' || err.meta?.code === '40P01') throw modificatoNelFrattempo(ENTITA)
    }
    throw err
  }

  /** Sede attiva della ditta del cliente, bloccata con FOR SHARE fino al commit. */
  private async sedeDelCliente(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sedeId: string,
    dittaId: string
  ): Promise<boolean> {
    if (!UUID.test(sedeId)) return false
    const righe = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "sedi_ditte"
      WHERE tenant_id = ${tenantId}::uuid AND id = ${sedeId}::uuid
        AND ditta_id = ${dittaId}::uuid AND attiva = true FOR SHARE`
    return righe.length > 0
  }

  /**
   * Principale dello stesso cliente, non eliminato, non annullato e non allegato a sua volta (D28).
   * `FOR UPDATE`: chi lo allega aspetta chi lo sta modificando e rilegge la riga cambiata.
   */
  private async principaleValido(
    tx: Prisma.TransactionClient,
    tenantId: string,
    idPrincipale: string,
    idCliente: string
  ): Promise<boolean> {
    if (!UUID.test(idPrincipale)) return false
    const righe = await tx.$queryRaw<
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
    const p = righe[0]
    return (
      p !== undefined &&
      p.clienteId.toLowerCase() === idCliente &&
      !p.eliminato &&
      p.stato !== 'ANNULLATO' &&
      p.contrattoPrincipaleId === null
    )
  }

  /**
   * Blocca la riga del contratto (non eliminato) e la legge con le relazioni della vista: da qui
   * alla fine della transazione nessun'altra modifica, stato o eliminazione le passa davanti.
   */
  private async bloccaELeggi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<RigaContratto> {
    if (!UUID.test(id)) throw nonTrovato()
    await tx.$queryRaw`SELECT id FROM "contratti_cliente"
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND eliminato_il IS NULL FOR UPDATE`
    const riga = await tx.contrattoCliente.findFirst({
      where: { id, tenantId, eliminatoIl: null },
      include: INCLUDE,
    })
    if (!riga) throw nonTrovato()
    return riga
  }

  // ---------------------------------------------------------------------------------------------
  // Task 17: modifica, stato, eliminazione
  // ---------------------------------------------------------------------------------------------

  /**
   * Modifica parziale (D9, R37): campo assente = invariato, `null` = svuota. Restituisce la vista
   * aggiornata. Un corpo senza differenze non scrive e non lascia audit, ma controlla la versione.
   */
  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaContrattoCliente & { versione: number }
  ): Promise<ContrattoClienteVista> {
    const { versione, ...grezzo } = m
    const patch = minuscoleGliId(grezzo)
    return nelContestoTenant(tenantId, async () => {
      await this.prisma
        .$transaction(tx => this.scriviModifica(tx, tenantId, utenteId, id, versione, patch))
        .catch(err => this.traduci(err))
      return this.leggi(tenantId, id)
    })
  }

  private async scriviModifica(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    id: string,
    versione: number,
    patch: ModificaContrattoCliente
  ): Promise<void> {
    // 1-2. Riga bloccata (404) e stato che non ammette la modifica: prima della versione (D14).
    const prima = await this.bloccaELeggi(tx, tenantId, id)
    const stato = prima.stato as StatoContrattoCliente
    const nonModificabile = motivoNonModificabile(stato)
    if (nonModificabile) {
      throw new ConflictException({
        error: 'CONTRATTO_CLIENTE_NON_MODIFICABILE',
        message: nonModificabile,
      })
    }
    // 3. Versione.
    confrontaVersione(prima.versione, versione, ENTITA)

    // 4-5. Campi non ammessi e validazione pura (R36: sempre con l'id del contratto).
    const attuale = datiDaRiga(prima)
    const piano = pianificaModifica(stato, attuale, patch, { id: id.toLowerCase() })
    if (piano.esito === 'NESSUNA_MODIFICA') return
    if (piano.esito === 'CAMPI_NON_AMMESSI') {
      throw new ConflictException({
        error: 'CONTRATTO_CLIENTE_CAMPI_NON_AMMESSI',
        message: piano.messaggio,
      })
    }
    if (piano.esito === 'NON_VALIDA') throw nonValido(piano.messaggi)
    const { dopo, cambiati } = piano

    // 6. Database: solo i riferimenti cambiati (e quelli che dipendono dal cliente, se cambia).
    const messaggi = await this.controllaCambiamenti(tx, tenantId, prima, dopo, cambiati)
    if (messaggi.length > 0) throw nonValido(messaggi)

    // 7. Scrittura condizionata; i periodi si sostituiscono solo dopo che la scrittura e' riuscita.
    const data: Record<string, unknown> = {}
    for (const c of cambiati) {
      if (c === 'periodi') continue
      data[c] = CAMPI_DATA.includes(c) ? comeData(dopo[c] as string | null) : dopo[c]
    }
    await scriviCondizionato(
      () =>
        tx.contrattoCliente.updateMany({
          where: { id, tenantId, versione, stato: prima.stato, eliminatoIl: null },
          data: {
            ...data,
            versione: { increment: 1 },
          } as Prisma.ContrattoClienteUncheckedUpdateManyInput,
        }),
      ENTITA
    )
    if (cambiati.includes('periodi')) {
      await tx.periodoFatturazioneCliente.deleteMany({ where: { contrattoId: id, tenantId } })
      if (dopo.periodi.length > 0) {
        await tx.periodoFatturazioneCliente.createMany({
          data: dopo.periodi.map((p, i) => ({
            tenantId,
            contrattoId: id,
            ordine: i + 1,
            giornoInizio: p.giornoInizio,
            meseInizio: p.meseInizio,
            giornoFine: p.giornoFine,
            meseFine: p.meseFine,
          })),
        })
      }
    }
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action: 'CONTRATTO_CLIENTE_MODIFICATO',
        description: `Contratto ${prima.numero} modificato`,
        metadata: metadataModifica(id, prima.numero, attuale, dopo, cambiati),
      },
    })
  }

  private async controllaCambiamenti(
    tx: Prisma.TransactionClient,
    tenantId: string,
    prima: RigaContratto,
    dopo: DatiContrattoCliente,
    cambiati: CampoContrattoCliente[]
  ): Promise<string[]> {
    const messaggi: string[] = []
    const cambia = (c: CampoContrattoCliente) => cambiati.includes(c)
    const idCliente = dopo.clienteId.toLowerCase()
    const clienteCambiato = cambia('clienteId')

    // Cliente e cliente di fatturazione: esistenti e attivi, bloccati con FOR SHARE (R24, R40).
    const daLeggere: string[] = []
    if (clienteCambiato) daLeggere.push(idCliente)
    const idFatturazione =
      cambia('clienteFatturazioneId') && dopo.clienteFatturazioneId !== null
        ? dopo.clienteFatturazioneId.toLowerCase()
        : null
    if (idFatturazione) daLeggere.push(idFatturazione)
    const trovati = daLeggere.length > 0 ? await this.clienti.attiviPerId(tx, daLeggere) : new Map()
    if (clienteCambiato && !trovati.get(idCliente)?.attivo) messaggi.push(MSG_CLIENTE)
    if (idFatturazione && !trovati.get(idFatturazione)?.attivo) messaggi.push(MSG_FATTURAZIONE)

    // Sede: se cambia lei o il cliente (la sede e' della ditta del cliente). Con un cliente nuovo
    // inesistente non si sa a quale ditta riferirla: resta il solo messaggio del cliente.
    if (dopo.sedeId !== null && (cambia('sedeId') || clienteCambiato)) {
      const dittaId = clienteCambiato ? trovati.get(idCliente)?.dittaId : prima.cliente.dittaId
      if (dittaId && !(await this.sedeDelCliente(tx, tenantId, dopo.sedeId, dittaId))) {
        messaggi.push(MSG_SEDE)
      }
    }

    // Tabelle, agente, testo, categoria e tipo: solo quelli cambiati e non svuotati.
    const scelti: RiferimentiDaControllare = {}
    for (const k of CHIAVI_RIFERIMENTO) {
      if (cambia(k) && dopo[k] !== null) scelti[k] = dopo[k]
    }
    if (Object.keys(scelti).length > 0) {
      messaggi.push(...(await controllaRiferimenti(tx, tenantId, scelti)))
    }

    // Allegati di questo contratto: non cambia cliente e non diventa a sua volta un allegato (D28).
    const allegati = prima._count.contrattiAllegati
    if (clienteCambiato && allegati > 0) messaggi.push(MSG_CLIENTE_CON_ALLEGATI)
    if (
      dopo.contrattoPrincipaleId !== null &&
      (cambia('contrattoPrincipaleId') || clienteCambiato)
    ) {
      if (allegati > 0 && cambia('contrattoPrincipaleId')) {
        messaggi.push(MSG_HA_ALLEGATI)
      } else if (
        !(await this.principaleValido(tx, tenantId, dopo.contrattoPrincipaleId, idCliente))
      ) {
        messaggi.push(MSG_PRINCIPALE)
      }
    }
    return messaggi
  }

  /**
   * Cambio di stato (D8). Con `ANNULLATO` serve un motivo: il codice, il testo o entrambi; con il
   * solo codice il testo e' la descrizione della codifica. L'audit non porta il testo (D16).
   */
  async cambiaStato(
    tenantId: string,
    utenteId: string,
    id: string,
    a: StatoContrattoCliente,
    versione: number,
    annullo: { motivoAnnulloId?: string | null; motivo?: string | null } = {}
  ): Promise<ContrattoClienteVista> {
    return nelContestoTenant(tenantId, async () => {
      await this.prisma
        .$transaction(async tx => {
          const prima = await this.bloccaELeggi(tx, tenantId, id)
          const da = prima.stato as StatoContrattoCliente
          // Transizione non ammessa: prima della versione (D14).
          const dati = {
            condizionePagamentoId: prima.condizionePagamentoId,
            registroIvaId: prima.registroIvaId,
            motivo: annullo.motivo,
            motivoAnnulloId: annullo.motivoAnnulloId,
          }
          if (!TRANSIZIONI[da].includes(a)) {
            throw new ConflictException({
              error: 'CONTRATTO_CLIENTE_TRANSIZIONE_NON_AMMESSA',
              message: `Dallo stato ${ETICHETTE_STATO[da]} non si passa a ${ETICHETTE_STATO[a]}.`,
            })
          }
          confrontaVersione(prima.versione, versione, ENTITA)
          const problema = verificaTransizione(da, a, dati)
          if (problema) throw nonValido([problema])

          const data: Prisma.ContrattoClienteUncheckedUpdateManyInput = {
            stato: a,
            versione: { increment: 1 },
          }
          const testo = (annullo.motivo ?? '').trim()
          const codice = (annullo.motivoAnnulloId ?? '').trim().toLowerCase()
          if (a === 'ANNULLATO') {
            if (testo.length > 255)
              throw nonValido(["Il motivo dell'annullo non può superare 255 caratteri."])
            let motivo = testo
            if (codice !== '') {
              const errori = await controllaRiferimenti(tx, tenantId, { motivoAnnulloId: codice })
              if (errori.length > 0) throw nonValido(errori)
              if (motivo === '') {
                const codifica = await tx.codificaContratto.findFirst({
                  where: { id: codice, tenantId },
                  select: { descrizione: true },
                })
                motivo = codifica?.descrizione ?? ''
              }
            }
            data.motivoAnnullo = motivo
            data.motivoAnnulloId = codice === '' ? null : codice
            data.annullatoIl = this.orologio()
          }
          await scriviCondizionato(
            () =>
              tx.contrattoCliente.updateMany({
                where: { id, tenantId, versione, stato: prima.stato, eliminatoIl: null },
                data,
              }),
            ENTITA
          )
          // Mai il testo del motivo (testo libero): solo gli stati e il codice scelto.
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'CONTRATTO_CLIENTE_STATO',
              description: `Contratto ${prima.numero}: stato ${ETICHETTE_STATO[da]} → ${ETICHETTE_STATO[a]}`,
              metadata: {
                contrattoId: id,
                da,
                a,
                ...(a === 'ANNULLATO' && codice !== '' ? { motivoAnnulloId: codice } : {}),
              } as Prisma.InputJsonValue,
            },
          })
        })
        .catch(err => this.traduci(err))
      return this.leggi(tenantId, id)
    })
  }

  /** Eliminazione logica, solo in BOZZA e senza contratti allegati (D13). */
  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, async () => {
      await this.prisma
        .$transaction(async tx => {
          const prima = await this.bloccaELeggi(tx, tenantId, id)
          const stato = prima.stato as StatoContrattoCliente
          const nonEliminabile = motivoNonEliminabile(stato)
          if (nonEliminabile) {
            throw new ConflictException({
              error: 'CONTRATTO_CLIENTE_NON_ELIMINABILE',
              message: nonEliminabile,
            })
          }
          confrontaVersione(prima.versione, versione, ENTITA)
          if (prima._count.contrattiAllegati > 0) {
            throw new ConflictException({
              error: 'CONTRATTO_CLIENTE_CON_ALLEGATI',
              message: 'Il contratto ha dei contratti allegati: staccali prima di eliminarlo.',
            })
          }
          await scriviCondizionato(
            () =>
              tx.contrattoCliente.updateMany({
                where: { id, tenantId, versione, stato: 'BOZZA', eliminatoIl: null },
                data: {
                  eliminatoIl: this.orologio(),
                  eliminatoDa: utenteId,
                  versione: { increment: 1 },
                },
              }),
            ENTITA
          )
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'CONTRATTO_CLIENTE_ELIMINATO',
              description: `Contratto ${prima.numero} eliminato`,
              metadata: { contrattoId: id, numero: prima.numero } as Prisma.InputJsonValue,
            },
          })
        })
        .catch(err => this.traduci(err))
    })
  }

  // ---------------------------------------------------------------------------------------------
  // Task 18: rinnovo e proroga delle scadenze (D11)
  // ---------------------------------------------------------------------------------------------

  /**
   * Sposta di un anno la data di fine (29/02 -> 28/02). Ammesso solo con una data di fine e in
   * stato attivo o sospeso: il controllo viene prima della versione (D14).
   */
  async rinnova(
    tenantId: string,
    utenteId: string,
    id: string,
    versione: number
  ): Promise<ContrattoClienteVista> {
    return nelContestoTenant(tenantId, async () => {
      await this.prisma
        .$transaction(async tx => {
          const prima = await this.bloccaELeggi(tx, tenantId, id)
          const stato = prima.stato as StatoContrattoCliente
          const fine = comeGiorno(prima.dataFine)
          if (fine === null || !rinnovabile(stato, fine)) {
            throw new ConflictException({
              error: 'CONTRATTO_CLIENTE_NON_RINNOVABILE',
              message: 'Si rinnovano solo i contratti attivi o sospesi con una data di fine.',
            })
          }
          confrontaVersione(prima.versione, versione, ENTITA)
          const nuova = dataPiuUnAnno(fine)
          await scriviCondizionato(
            () =>
              tx.contrattoCliente.updateMany({
                where: { id, tenantId, versione, stato: prima.stato, eliminatoIl: null },
                data: { dataFine: comeData(nuova), versione: { increment: 1 } },
              }),
            ENTITA
          )
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'CONTRATTO_CLIENTE_RINNOVATO',
              description: `Contratto ${prima.numero} rinnovato`,
              metadata: {
                contrattoId: id,
                dataFinePrima: fine,
                dataFineDopo: nuova,
              } as Prisma.InputJsonValue,
            },
          })
        })
        .catch(err => this.traduci(err))
      return this.leggi(tenantId, id)
    })
  }

  /**
   * Proroga massiva (D11, E9): fine + 1 anno e versione + 1 su tutti i contratti non eliminati
   * dell'azienda, attivi (e sospesi se richiesto), con fine entro `scadutiEntro`. Un solo
   * `UPDATE` nella transazione col contesto azienda (la RLS vale anche per il raw; il `WHERE`
   * ripete comunque `tenant_id`), un solo audit col conteggio e i filtri; nessun audit se zero.
   * Il 29/02 diventa 28/02 perche' lo fa `interval '1 year'` di Postgres (WinWaste sbagliava).
   */
  async prorogaScadenze(
    tenantId: string,
    utenteId: string,
    f: FiltroProroga
  ): Promise<{ prorogati: number }> {
    const messaggi: string[] = []
    if (!giornoValido(f.scadutiEntro)) messaggi.push('La data di scadenza non è valida.')
    if (f.clienteId !== undefined && !UUID.test(f.clienteId))
      messaggi.push('Il cliente scelto non è valido.')
    if (f.categoriaId !== undefined && !UUID.test(f.categoriaId))
      messaggi.push('La categoria scelta non è valida.')
    if (messaggi.length > 0) throw nonValido(messaggi)

    const stati: StatoContrattoCliente[] = f.ancheSospesi
      ? ['ATTIVO', 'SOSPESO', 'SOSPESO_MOVIMENTI']
      : ['ATTIVO']
    // Il tipo enum di Postgres vuole il cast esplicito sui parametri.
    const elencoStati = Prisma.join(stati.map(s => Prisma.sql`${s}::stato_contratto_cliente`))
    const condizioni: Prisma.Sql[] = [
      Prisma.sql`tenant_id = ${tenantId}::uuid`,
      Prisma.sql`eliminato_il IS NULL`,
      Prisma.sql`data_fine IS NOT NULL`,
      Prisma.sql`data_fine <= ${f.scadutiEntro}::date`,
      Prisma.sql`stato IN (${elencoStati})`,
    ]
    if (f.soloRinnovoAutomatico) condizioni.push(Prisma.sql`rinnovo_automatico`)
    if (f.clienteId !== undefined)
      condizioni.push(Prisma.sql`cliente_id = ${f.clienteId.toLowerCase()}::uuid`)
    if (f.categoriaId !== undefined)
      condizioni.push(Prisma.sql`categoria_id = ${f.categoriaId.toLowerCase()}::uuid`)
    const filtri = {
      scadutiEntro: f.scadutiEntro,
      soloRinnovoAutomatico: f.soloRinnovoAutomatico,
      ancheSospesi: f.ancheSospesi,
      ...(f.clienteId !== undefined ? { clienteId: f.clienteId.toLowerCase() } : {}),
      ...(f.categoriaId !== undefined ? { categoriaId: f.categoriaId.toLowerCase() } : {}),
    }

    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const prorogati = await tx.$executeRaw(
          Prisma.sql`UPDATE "contratti_cliente"
            SET data_fine = (data_fine + interval '1 year')::date,
                versione = versione + 1,
                updated_at = now()
            WHERE ${Prisma.join(condizioni, ' AND ')}`
        )
        if (prorogati > 0) {
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'CONTRATTO_CLIENTE_PROROGATI',
              description: `Proroga delle scadenze: ${prorogati} contratti`,
              metadata: { prorogati, filtri } as Prisma.InputJsonValue,
            },
          })
        }
        return { prorogati }
      })
    )
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
      ...datiDaRiga(r),
      id: r.id,
      stato,
      versione: r.versione,
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
