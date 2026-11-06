// Elenchi degli addebiti di un contratto cliente (4.2b, D8, D16, R39, R40): lista, creazione con
// codice proposto, modifica con lock ottimistico, eliminazione fisica (righe, fasce, scadenze e
// allegati vanno a cascata) e audit. Le regole sui dati stanno in `domain/listino/elenco-addebiti`.
//
// Ordine dei lock (R40): contratto FOR SHARE (stato e cancellazione, in fila con `bloccaELeggi`
// della 4.1) -> lock consultivo per contratto (solo predefinito e creazione senza codice) ->
// elenco FOR UPDATE. Le scritture del listino non cambiano la `versione` del contratto (D16).
// Le transazioni di scrittura partono con `lock_timeout` (`lock-listino.ts`): oltre l'attesa 409
// `OPERAZIONE_CONCORRENTE`. La `versione` dell'elenco protegge i dati dell'elenco e la sostituzione
// del suo contenuto (copia, M9): la riga singola e gli allegati non la toccano.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  elenchiValidiAl,
  normalizzaElenco,
  prossimoCodiceElenco,
  validaElenco,
  type DatiElenco,
} from '../../domain/listino/elenco-addebiti'
import { dataReale } from '../../domain/contratti-cliente/regole-contratto-cliente'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from '../clienti/anagrafica-versionata'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { MESSAGGIO_IN_USO_DA_DOCUMENTI } from '../../domain/fatturazione/codici'
import { COLONNE_ELENCO, contaUsiListino, contaUsiListinoPerOrigine } from './uso-listino'
import {
  bloccaContrattoListino,
  impostaTimeoutLock,
  lockConsultivoContratto,
  OPZIONI_TRANSAZIONE_SCRITTURA,
  type ContrattoBloccato,
} from './lock-listino'

/** Decisione 8 (4.3): un elenco citato da un legame di un movimento non si elimina. */
const IN_USO = {
  codice: 'ELENCO_ADDEBITI_IN_USO',
  messaggio: "L'elenco è usato da movimenti: non si può eliminare.",
}

const ENTITA: DescrizioneEntita = {
  prefisso: 'ELENCO_ADDEBITI',
  soggetto: "L'elenco degli addebiti",
  femminile: false,
  // Decisione 8 (4.3): le righe citate da un legame non si cancellano, nemmeno a cascata.
  inUso: IN_USO,
  inUsoPerVincolo: {
    documenti_fattura_elenco_fkey: {
      codice: IN_USO.codice,
      messaggio: MESSAGGIO_IN_USO_DA_DOCUMENTI,
    },
  },
}

/** Unica chiave unica di business della tabella: il codice dentro il contratto. */
const VINCOLI: VincoliNoti = {
  elenchi_addebiti_contratto_id_codice_key: {
    codice: 'ELENCO_ADDEBITI_CODICE_DUPLICATO',
    messaggio: 'Esiste già un elenco con questo codice nel contratto.',
  },
}

const TENTATIVI_SENZA_CODICE = 3
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MSG_ESAURITI = 'Non si possono creare più di 999 elenchi numerati per contratto.'

export interface ElencoAddebitiVista extends DatiElenco {
  id: string
  contrattoId: string
  righe: number
  versione: number
  /** D16: il contratto non e' annullato. */
  modificabile: boolean
  /** Si puo' cancellare (dalla 4.3 la FK dei movimenti lo bloccherà). */
  eliminabile: boolean
  allegati: { id: string; posizione: 1 | 2; nomeFile: string; dimensioneByte: number }[]
}

export interface ContestoListino {
  contratto: {
    id: string
    numero: string
    stato: string
    clienteId: string
    /** Ragione sociale del cliente del contratto, per l'intestazione della pagina del listino. */
    clienteRagioneSociale: string
    contrattoPrincipale: { id: string; numero: string } | null
    dataInizio: string
    dataFine: string | null
  }
}

/** Alla creazione `codice` omesso o vuoto vale "il primo libero" e `predefinito` omesso vale false. */
export type NuovoElenco = Partial<DatiElenco> & { descrizione: string }
export type ModificaElenco = Partial<DatiElenco> & { versione: number }

type RigaElenco = {
  id: string
  contrattoId: string
  codice: string
  descrizione: string
  nota1: string | null
  nota2: string | null
  validoDal: Date | null
  validoAl: Date | null
  predefinito: boolean
  codiceCig: string | null
  codiceCup: string | null
  idDocumentoPa: string | null
  dataDocumentoPa: Date | null
  versione: number
}

type RigaAllegato = {
  id: string
  elencoId: string
  posizione: number
  nomeFile: string
  dimensioneByte: number
}

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = [
  'codice',
  'descrizione',
  'nota1',
  'nota2',
  'validoDal',
  'validoAl',
  'predefinito',
  'codiceCig',
  'codiceCup',
  'idDocumentoPa',
  'dataDocumentoPa',
] as const satisfies readonly (keyof DatiElenco)[]

const giorno = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10))
const comeData = (s: string | null): Date | null =>
  s === null ? null : new Date(`${s}T00:00:00.000Z`)

const datiDi = (r: RigaElenco): DatiElenco => ({
  codice: r.codice,
  descrizione: r.descrizione,
  nota1: r.nota1,
  nota2: r.nota2,
  validoDal: giorno(r.validoDal),
  validoAl: giorno(r.validoAl),
  predefinito: r.predefinito,
  codiceCig: r.codiceCig,
  codiceCup: r.codiceCup,
  idDocumentoPa: r.idDocumentoPa,
  dataDocumentoPa: giorno(r.dataDocumentoPa),
})

/** Valori nel formato delle colonne: le date sono `Date` (UTC, mezzanotte). */
type ValoriDatabase = Omit<DatiElenco, 'validoDal' | 'validoAl' | 'dataDocumentoPa'> & {
  validoDal: Date | null
  validoAl: Date | null
  dataDocumentoPa: Date | null
}

/** Valori nel formato delle colonne: le date diventano `Date` (UTC, mezzanotte). */
const perDatabase = (d: DatiElenco): ValoriDatabase => ({
  ...d,
  validoDal: comeData(d.validoDal),
  validoAl: comeData(d.validoAl),
  dataDocumentoPa: comeData(d.dataDocumentoPa),
})

/** Solo i campi indicati, con il tipo delle colonne (per l'`UPDATE` parziale). */
const soloCampi = (v: ValoriDatabase, campi: readonly (keyof ValoriDatabase)[]) => {
  const r: Partial<ValoriDatabase> = {}
  for (const c of campi) Object.assign(r, { [c]: v[c] })
  return r
}

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const contrattoNonTrovato = () =>
  new NotFoundException({
    message: 'Contratto non trovato.',
    error: 'CONTRATTO_CLIENTE_NON_TROVATO',
  })

const elencoNonTrovato = () =>
  new NotFoundException({
    message: 'Elenco degli addebiti non trovato.',
    error: 'ELENCO_ADDEBITI_NON_TROVATO',
  })

function lanciaNonValido(errori: string[]): never {
  throw new BadRequestException({ message: errori, error: 'ELENCO_ADDEBITI_NON_VALIDO' })
}

const eP2002 = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

@Injectable()
export class ElenchiAddebitiService {
  constructor(private readonly prisma: PrismaService) {}

  /** Contratto e suoi elenchi; `validiAl` (YYYY-MM-DD) tiene solo quelli non scaduti a quella data. */
  async list(
    tenantId: string,
    contrattoId: string,
    validiAl?: string
  ): Promise<{ contesto: ContestoListino; elenchi: ElencoAddebitiVista[] }> {
    if (validiAl !== undefined && !dataReale(validiAl)) {
      throw new BadRequestException({
        message: ['La data non è valida.'],
        error: 'ELENCO_ADDEBITI_NON_VALIDO',
      })
    }
    if (!UUID.test(contrattoId)) throw contrattoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const contratto = await tx.contrattoCliente.findFirst({
          where: { id: contrattoId, tenantId, eliminatoIl: null },
          include: {
            contrattoPrincipale: { select: { id: true, numero: true } },
            cliente: { select: { ditta: { select: { ragioneSociale: true } } } },
          },
        })
        if (!contratto) throw contrattoNonTrovato()
        const righe = await tx.elencoAddebiti.findMany({
          where: { tenantId, contrattoId },
          orderBy: { codice: 'asc' },
        })
        const viste = await this.viste(tx, tenantId, righe, contratto.stato !== 'ANNULLATO')
        return {
          contesto: {
            contratto: {
              id: contratto.id,
              numero: contratto.numero,
              stato: contratto.stato,
              clienteId: contratto.clienteId,
              clienteRagioneSociale: contratto.cliente.ditta.ragioneSociale,
              contrattoPrincipale: contratto.contrattoPrincipale,
              dataInizio: giorno(contratto.dataInizio) as string,
              dataFine: giorno(contratto.dataFine),
            },
          },
          elenchi: validiAl === undefined ? viste : elenchiValidiAl(viste, validiAl),
        }
      })
    )
  }

  /** Il codice che la creazione senza codice assegnerebbe adesso (informativo: non riserva nulla). */
  async prossimoCodice(tenantId: string, contrattoId: string): Promise<string> {
    if (!UUID.test(contrattoId)) throw contrattoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const c = await tx.contrattoCliente.findFirst({
          where: { id: contrattoId, tenantId, eliminatoIl: null },
          select: { id: true },
        })
        if (!c) throw contrattoNonTrovato()
        return this.assegnaCodice(tx, tenantId, contrattoId)
      })
    )
  }

  async getById(tenantId: string, id: string): Promise<ElencoAddebitiVista> {
    if (!UUID.test(id)) throw elencoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const riga = await tx.elencoAddebiti.findFirst({
          where: { id, tenantId, contratto: { eliminatoIl: null } },
          include: { contratto: { select: { stato: true } } },
        })
        if (!riga) throw elencoNonTrovato()
        const [v] = await this.viste(tx, tenantId, [riga], riga.contratto.stato !== 'ANNULLATO')
        return v
      })
    )
  }

  async crea(
    tenantId: string,
    utenteId: string,
    contrattoId: string,
    dati: NuovoElenco
  ): Promise<ElencoAddebitiVista> {
    if (!UUID.test(contrattoId)) throw contrattoNonTrovato()
    const valori = normalizzaElenco(dati)
    // Senza codice la validazione usa un segnaposto: il vero codice si assegna sotto lock.
    const errori = validaElenco({ ...valori, codice: valori.codice === '' ? '001' : valori.codice })
    if (errori.length > 0) lanciaNonValido(errori)

    return nelContestoTenant(tenantId, async () => {
      // Il P2002 si cattura FUORI dalla transazione (una transazione interrotta non si riprova):
      // senza codice esplicito si riprova in una transazione nuova, che rilegge i codici.
      const tentativi = valori.codice === '' ? TENTATIVI_SENZA_CODICE : 1
      for (let tentativo = 1; ; tentativo++) {
        try {
          return await this.creaInTransazione(tenantId, utenteId, contrattoId, valori)
        } catch (err) {
          if (eP2002(err) && tentativo < tentativi) continue
          return await traduciErrorePrisma(err, ENTITA, VINCOLI)
        }
      }
    })
  }

  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaElenco
  ): Promise<ElencoAddebitiVista> {
    if (!UUID.test(id)) throw elencoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const { contratto, prima } = await this.bloccaElenco(
            tx,
            tenantId,
            id,
            m.predefinito === true
          )
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = datiDi(prima)
          const { versione: _versione, ...inviati } = m
          const definiti = Object.fromEntries(
            Object.entries(inviati).filter(([, v]) => v !== undefined)
          )
          const nuovi = normalizzaElenco({ ...attuali, ...definiti })
          const errori = validaElenco(nuovi)
          if (errori.length > 0) lanciaNonValido(errori)

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return (await this.viste(tx, tenantId, [prima], true))[0]

          const valori = perDatabase(nuovi)
          await scriviCondizionato(
            () =>
              tx.elencoAddebiti.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: { ...soloCampi(valori, campi), versione: { increment: 1 } },
              }),
            ENTITA
          )
          if (campi.includes('predefinito') && nuovi.predefinito) {
            await this.togliPredefinitoAgliAltri(tx, tenantId, utenteId, contratto.id, id)
          }
          const dopo = await tx.elencoAddebiti.findFirst({ where: { id, tenantId } })
          if (!dopo) throw elencoNonTrovato()
          await this.audit(tx, tenantId, utenteId, 'ELENCO_ADDEBITI_MODIFICATO', 'modificato', {
            elencoId: id,
            contrattoId: contratto.id,
            numeroContratto: contratto.numero,
            codice: dopo.codice,
            campi,
          })
          return (await this.viste(tx, tenantId, [dopo], true))[0]
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    if (!UUID.test(id)) throw elencoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const { contratto, prima } = await this.bloccaElenco(tx, tenantId, id, false)
          confrontaVersione(prima.versione, versione, ENTITA)
          const righe = await tx.rigaAddebito.count({ where: { tenantId, elencoId: id } })
          const usi = (await contaUsiListinoPerOrigine(tx, tenantId, [id], COLONNE_ELENCO)).get(id)
          if (usi && usi.totale > 0) {
            throw new ConflictException({
              error: IN_USO.codice,
              message: usi.daDocumenti > 0 ? MESSAGGIO_IN_USO_DA_DOCUMENTI : IN_USO.messaggio,
            })
          }
          // Righe, fasce, scadenze e allegati vanno a cascata (FK ON DELETE CASCADE).
          await scriviCondizionato(
            () => tx.elencoAddebiti.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'ELENCO_ADDEBITI_ELIMINATO', 'eliminato', {
            elencoId: id,
            contrattoId: contratto.id,
            numeroContratto: contratto.numero,
            codice: prima.codice,
            righe,
          })
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  // ---------------------------------------------------------------------------------------------

  /** Un tentativo di creazione: codice esplicito, oppure primo libero letto sotto lock consultivo. */
  private creaInTransazione(
    tenantId: string,
    utenteId: string,
    contrattoId: string,
    valori: DatiElenco
  ): Promise<ElencoAddebitiVista> {
    return this.prisma.$transaction(async tx => {
      await impostaTimeoutLock(tx)
      const contratto = await bloccaContrattoListino(tx, tenantId, contrattoId)
      if (valori.codice === '' || valori.predefinito) await lockConsultivoContratto(tx, contrattoId)
      const codice =
        valori.codice === '' ? await this.assegnaCodice(tx, tenantId, contrattoId) : valori.codice

      const creato = await tx.elencoAddebiti.create({
        data: {
          ...perDatabase({ ...valori, codice }),
          tenantId,
          contrattoId,
        },
      })
      if (valori.predefinito) {
        await this.togliPredefinitoAgliAltri(tx, tenantId, utenteId, contrattoId, creato.id)
      }
      await this.audit(tx, tenantId, utenteId, 'ELENCO_ADDEBITI_CREATO', 'creato', {
        elencoId: creato.id,
        contrattoId,
        numeroContratto: contratto.numero,
        codice: creato.codice,
      })
      return (await this.viste(tx, tenantId, [creato], true))[0]
    }, OPZIONI_TRANSAZIONE_SCRITTURA)
  }

  /**
   * Passi 1-3 di R40 per un elenco esistente: lettura senza lock per sapere il contratto, contratto
   * FOR SHARE, lock consultivo se serve, elenco FOR UPDATE e rilettura.
   */
  private async bloccaElenco(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    conLockContratto: boolean
  ): Promise<{ contratto: ContrattoBloccato; prima: RigaElenco }> {
    const noto = await tx.elencoAddebiti.findFirst({
      where: { id, tenantId, contratto: { eliminatoIl: null } },
      select: { contrattoId: true },
    })
    if (!noto) throw elencoNonTrovato()
    const contratto = await bloccaContrattoListino(tx, tenantId, noto.contrattoId)
    if (conLockContratto) {
      await lockConsultivoContratto(tx, noto.contrattoId)
      // Cambio del predefinito: l'elenco e i predefiniti attuali del contratto si bloccano insieme
      // `ORDER BY id`, come fa la copia (`bloccaElenchi`). Bloccare prima il proprio e poi, in
      // `togliPredefinitoAgliAltri`, gli altri romperebbe l'ordine globale degli id: una copia che
      // tiene l'elenco con l'id piu' basso e aspetta il nostro andrebbe in deadlock con noi. Il
      // lock consultivo tiene fermo l'insieme dei predefiniti (solo chi lo tiene li cambia).
      const bloccati = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id::text AS id FROM "elenchi_addebiti"
        WHERE tenant_id = ${tenantId}::uuid AND contratto_id = ${noto.contrattoId}::uuid
          AND (id = ${id}::uuid OR predefinito)
        ORDER BY id FOR UPDATE`
      if (!bloccati.some(b => b.id === id.toLowerCase())) throw elencoNonTrovato()
    } else {
      const bloccati = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "elenchi_addebiti"
        WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`
      if (bloccati.length === 0) throw elencoNonTrovato()
    }
    const prima = await tx.elencoAddebiti.findFirst({ where: { id, tenantId } })
    if (!prima) throw elencoNonTrovato()
    return { contratto, prima }
  }

  private async assegnaCodice(
    tx: Prisma.TransactionClient,
    tenantId: string,
    contrattoId: string
  ): Promise<string> {
    const usati = await tx.elencoAddebiti.findMany({
      where: { tenantId, contrattoId },
      select: { codice: true },
    })
    const libero = prossimoCodiceElenco(usati.map(u => u.codice))
    if (libero === null) {
      throw new BadRequestException({
        message: MSG_ESAURITI,
        error: 'ELENCO_ADDEBITI_CODICI_ESAURITI',
      })
    }
    return libero
  }

  /**
   * Uno solo predefinito per contratto: chi lo era lo perde (e la sua versione sale). Gli altri
   * predefiniti si bloccano prima `ORDER BY id FOR UPDATE`, nello stesso ordine di
   * `AzioniListinoService.bloccaElenchi` (la copia blocca arrivo e sorgenti in ordine di id): un
   * `updateMany` li bloccherebbe nell'ordine della scansione e potrebbe incrociarsi con la copia
   * (deadlock). Ogni elenco che perde il flag e' scritto nell'audit (`ELENCO_ADDEBITI_MODIFICATO`
   * con `campi: ['predefinito']` e `perdutoPer`: l'elenco che l'ha preso).
   */
  private async togliPredefinitoAgliAltri(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    contrattoId: string,
    tranne: string
  ): Promise<void> {
    const bloccati = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM "elenchi_addebiti"
      WHERE tenant_id = ${tenantId}::uuid AND contratto_id = ${contrattoId}::uuid
        AND predefinito AND id <> ${tranne}::uuid
      ORDER BY id FOR UPDATE`
    if (bloccati.length === 0) return
    const ids = bloccati.map(b => b.id)
    await tx.elencoAddebiti.updateMany({
      where: { tenantId, contrattoId, id: { in: ids } },
      data: { predefinito: false, versione: { increment: 1 } },
    })
    const perdenti = await tx.elencoAddebiti.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, codice: true },
      orderBy: { id: 'asc' },
    })
    for (const p of perdenti) {
      await this.audit(tx, tenantId, utenteId, 'ELENCO_ADDEBITI_MODIFICATO', 'modificato', {
        elencoId: p.id,
        contrattoId,
        codice: p.codice,
        campi: ['predefinito'],
        perdutoPer: tranne,
      })
    }
  }

  /** Viste con conteggio delle righe e allegati letti in una passata per tutta la lista. */
  private async viste(
    tx: Prisma.TransactionClient,
    tenantId: string,
    righe: RigaElenco[],
    modificabile: boolean
  ): Promise<ElencoAddebitiVista[]> {
    if (righe.length === 0) return []
    const ids = righe.map(r => r.id)
    const conteggi = await tx.rigaAddebito.groupBy({
      by: ['elencoId'],
      where: { tenantId, elencoId: { in: ids } },
      _count: { _all: true },
    })
    const allegati: RigaAllegato[] = await tx.allegatoElencoAddebiti.findMany({
      where: { tenantId, elencoId: { in: ids } },
      select: { id: true, elencoId: true, posizione: true, nomeFile: true, dimensioneByte: true },
      orderBy: { posizione: 'asc' },
    })
    const righePer = new Map(conteggi.map(c => [c.elencoId, c._count._all]))
    const usi = await contaUsiListino(tx, tenantId, ids, COLONNE_ELENCO)
    return righe.map(r => ({
      id: r.id,
      contrattoId: r.contrattoId,
      ...datiDi(r),
      righe: righePer.get(r.id) ?? 0,
      versione: r.versione,
      modificabile,
      eliminabile: modificabile && (usi.get(r.id) ?? 0) === 0,
      allegati: allegati
        .filter(a => a.elencoId === r.id)
        .map(a => ({
          id: a.id,
          posizione: a.posizione as 1 | 2,
          nomeFile: a.nomeFile,
          dimensioneByte: a.dimensioneByte,
        })),
    }))
  }

  /** Audit nella stessa transazione: solo id, numero del contratto, codice e nomi dei campi (D16). */
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
        description: `Elenco degli addebiti ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
