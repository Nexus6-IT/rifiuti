// Motore comune delle codifiche (R25): lo stesso schema di tabella con `genere`, codice unico per
// (azienda, genere), lock ottimistico (D14), disattivazione al posto della cancellazione (D13) e
// audit (D16) serve sia le codifiche del contratto (4.1) sia quelle di addebito (4.2a).
//
// Le due copie del servizio divergevano per regole di dominio (insieme dei generi, forma e
// lunghezza del codice, lunghezza della descrizione, chi cita la codifica) e per qualche dettaglio
// accidentale. Qui sta tutto il resto; ogni servizio passa una `ConfigCodifiche` con le differenze
// volute e resta l'unica classe iniettabile, con la stessa API di prima.
//
// Creazione in linea: senza `codice` il motore assegna il primo codice numerico libero del genere
// (`primoCodiceLibero`), con un nuovo tentativo in una transazione nuova su P2002.
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { primoCodiceLibero } from '../../domain/clienti/codifica-contratto'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from './anagrafica-versionata'
import type { ClientUsi } from './uso-tabelle-fatturazione'

export interface RigaCodifica {
  id: string
  genere: string
  codice: string
  descrizione: string
  attiva: boolean
  versione: number
}

export interface CodificaVistaBase<G extends string> {
  id: string
  genere: G
  codice: string
  descrizione: string
  attiva: boolean
  versione: number
  /** Nessuno la cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

export interface NuovaCodificaBase<G extends string> {
  genere: G
  descrizione: string
  /** Assente o null = primo codice libero del genere. */
  codice?: string | null
}

export interface ModificaCodificaBase {
  codice?: string
  descrizione?: string
  attiva?: boolean
  versione: number
}

export interface FiltroCodificheBase<G extends string> {
  genere: G
  incluseDisattivate: boolean
}

/** Dati normalizzati: la forma e' quella dei due moduli di dominio. */
export interface DatiNormalizzati {
  genere: string
  codice: string | null
  descrizione: string
}

/** La parte del delegato Prisma che il motore usa (stessa forma per le due tabelle). */
export interface DelegatoCodifica<G extends string> {
  findFirst(args: { where: { id: string; tenantId: string } }): Promise<RigaCodifica | null>
  findMany(args: {
    where: { tenantId: string; genere: G; attiva?: boolean }
    orderBy: Array<{ attiva?: 'asc' | 'desc'; codice?: 'asc' | 'desc' }>
  }): Promise<RigaCodifica[]>
  create(args: {
    data: { tenantId: string; genere: G; codice: string; descrizione: string }
  }): Promise<RigaCodifica>
  updateMany(args: {
    where: { id: string; tenantId: string; versione: number }
    data: Partial<Pick<RigaCodifica, 'codice' | 'descrizione' | 'attiva'>> & {
      versione: { increment: number }
    }
  }): Promise<{ count: number }>
  deleteMany(args: {
    where: { id: string; tenantId: string; versione: number }
  }): Promise<{ count: number }>
}

/** Cio' che cambia da una tabella all'altra. */
export interface ConfigCodifiche<G extends string> {
  /** Il suo `prefisso` e' anche quello dei codici di errore e delle azioni di audit. */
  entita: DescrizioneEntita
  vincoli: VincoliNoti
  /** Nome SQL della tabella e del tipo enum del genere, per le letture dei codici usati. */
  tabellaSql: string
  tipoGenereSql: string
  /** Chiave del lock consultivo sul primo codice libero (azienda + genere). */
  prefissoLock: string
  /** Testo del log di audit: `${descrizioneAudit} creata|modificata|eliminata`. */
  descrizioneAudit: string
  /** Messaggio quando in modifica il codice resta vuoto (R24). */
  messaggioCodiceMancante: string
  delegato: (client: ClientUsi) => DelegatoCodifica<G>
  controllaGenere: (genere: unknown) => G | null
  normalizza: (dati: Partial<Record<keyof DatiNormalizzati, unknown>>) => DatiNormalizzati
  valida: (dati: DatiNormalizzati) => string[]
  contaUsi: (
    client: ClientUsi,
    tenantId: string,
    ids: readonly string[]
  ) => Promise<Map<string, number>>
}

const MSG_ESAURITI = 'Non si possono creare più di 999 codici per questo elenco.'
const MSG_GENERE = 'Il genere della codifica non è ammesso.'

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = ['codice', 'descrizione', 'attiva'] as const
type Campo = (typeof CAMPI)[number]

const eP2002 = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export class CodificheTabella<G extends string> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ConfigCodifiche<G>
  ) {}

  private lanciaNonValida(errori: string[]): never {
    throw new BadRequestException({
      message: errori,
      error: `${this.cfg.entita.prefisso}_NON_VALIDA`,
    })
  }

  private nonTrovata() {
    return new NotFoundException({
      message: 'Codifica non trovata.',
      error: `${this.cfg.entita.prefisso}_NON_TROVATA`,
    })
  }

  private controllaGenere(genere: unknown): G {
    const g = this.cfg.controllaGenere(genere)
    if (g === null) this.lanciaNonValida([MSG_GENERE])
    return g as G
  }

  private vista(r: RigaCodifica, usi: number): CodificaVistaBase<G> {
    return {
      id: r.id,
      genere: r.genere as G,
      codice: r.codice,
      descrizione: r.descrizione,
      attiva: r.attiva,
      versione: r.versione,
      eliminabile: usi === 0,
    }
  }

  private async comeVista(r: RigaCodifica, tenantId: string, client: ClientUsi) {
    const usi = (await this.cfg.contaUsi(client, tenantId, [r.id])).get(r.id) ?? 0
    return this.vista(r, usi)
  }

  async list(tenantId: string, filtro: FiltroCodificheBase<G>): Promise<CodificaVistaBase<G>[]> {
    const genere = this.controllaGenere(filtro.genere)
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.cfg.delegato(this.prisma).findMany({
        where: filtro.incluseDisattivate
          ? { tenantId, genere }
          : { tenantId, genere, attiva: true },
        orderBy: [{ attiva: 'desc' }, { codice: 'asc' }],
      })
      const usi = await this.cfg.contaUsi(
        this.prisma,
        tenantId,
        righe.map(r => r.id)
      )
      return righe.map(r => this.vista(r, usi.get(r.id) ?? 0))
    })
  }

  async getById(tenantId: string, id: string): Promise<CodificaVistaBase<G>> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.cfg.delegato(this.prisma).findFirst({ where: { id, tenantId } })
      if (!riga) throw this.nonTrovata()
      return this.comeVista(riga, tenantId, this.prisma)
    })
  }

  /** Il codice che la creazione in linea assegnerebbe adesso (solo informativo: non riserva nulla). */
  async prossimoCodice(tenantId: string, genere: G): Promise<string> {
    const g = this.controllaGenere(genere)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx =>
        this.assegnaCodice(await this.codiciUsati(tx, tenantId, g))
      )
    )
  }

  async crea(
    tenantId: string,
    utenteId: string,
    dati: NuovaCodificaBase<G>
  ): Promise<CodificaVistaBase<G>> {
    const valori = this.cfg.normalizza(dati)
    const errori = this.cfg.valida(valori)
    if (errori.length > 0) this.lanciaNonValida(errori)
    const genere = valori.genere as G

    return nelContestoTenant(tenantId, async () => {
      // Il P2002 si cattura FUORI dalla transazione: una transazione interrotta (25P02) non si
      // riprova. Le creazioni senza codice si serializzano col lock consultivo per azienda e genere
      // (vedi `creaInTransazione`); non copre pero' una creazione a codice esplicito, che non lo
      // prende e puo' prendere il codice che l'altra sta per calcolare: su P2002 si riprova UNA
      // volta in una transazione nuova, che rilegge i codici e prende il successivo.
      const tentativi = valori.codice === null ? 2 : 1
      for (let tentativo = 1; ; tentativo++) {
        try {
          return await this.creaInTransazione(tenantId, utenteId, genere, valori)
        } catch (err) {
          if (eP2002(err) && tentativo < tentativi) continue
          return await traduciErrorePrisma(err, this.cfg.entita, this.cfg.vincoli)
        }
      }
    })
  }

  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaCodificaBase
  ): Promise<CodificaVistaBase<G>> {
    const { entita, vincoli } = this.cfg
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const tabella = this.cfg.delegato(tx)
          const prima = await tabella.findFirst({ where: { id, tenantId } })
          if (!prima) throw this.nonTrovata()
          confrontaVersione(prima.versione, m.versione, entita)

          const attuali = {
            codice: prima.codice,
            descrizione: prima.descrizione,
            attiva: prima.attiva,
          }
          // Il genere resta quello della riga: la modifica non lo conosce.
          const unione = this.cfg.normalizza({
            genere: prima.genere,
            codice: m.codice !== undefined ? m.codice : attuali.codice,
            descrizione: m.descrizione ?? attuali.descrizione,
          })
          const errori = this.cfg.valida(unione)
          // Un codice inviato ma vuoto non e' "assente": in modifica il codice non si toglie (R24).
          if (unione.codice === null) errori.push(this.cfg.messaggioCodiceMancante)
          if (errori.length > 0) this.lanciaNonValida(errori)
          const nuovi: Record<Campo, unknown> = {
            codice: unione.codice,
            descrizione: unione.descrizione,
            attiva: m.attiva ?? attuali.attiva,
          }

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return this.comeVista(prima, tenantId, tx)

          await scriviCondizionato(
            () =>
              tabella.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...(Object.fromEntries(campi.map(c => [c, nuovi[c]])) as Partial<
                    Pick<RigaCodifica, Campo>
                  >),
                  versione: { increment: 1 },
                },
              }),
            entita
          )
          const dopo = await tabella.findFirst({ where: { id, tenantId } })
          if (!dopo) throw this.nonTrovata()
          await this.audit(tx, tenantId, utenteId, 'MODIFICATA', 'modificata', {
            codificaId: id,
            genere: dopo.genere,
            codice: dopo.codice,
            campi,
          })
          return this.comeVista(dopo, tenantId, tx)
        })
        .catch(err => traduciErrorePrisma(err, entita, vincoli))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    const { entita, vincoli } = this.cfg
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const tabella = this.cfg.delegato(tx)
          const riga = await tabella.findFirst({ where: { id, tenantId } })
          if (!riga) throw this.nonTrovata()
          confrontaVersione(riga.versione, versione, entita)
          await scriviCondizionato(
            () => tabella.deleteMany({ where: { id, tenantId, versione } }),
            entita
          )
          await this.audit(tx, tenantId, utenteId, 'ELIMINATA', 'eliminata', {
            codificaId: id,
            genere: riga.genere,
            codice: riga.codice,
          })
        })
        .catch(err => traduciErrorePrisma(err, entita, vincoli))
    )
  }

  private async codiciUsati(
    tx: Prisma.TransactionClient,
    tenantId: string,
    genere: string
  ): Promise<Array<{ codice: string }>> {
    const { tabellaSql, tipoGenereSql } = this.cfg
    // Tabella e tipo sono costanti del codice (mai input): per questo `Prisma.raw`.
    return tx.$queryRaw<Array<{ codice: string }>>`
      SELECT codice
      FROM ${Prisma.raw(tabellaSql)}
      WHERE tenant_id = ${tenantId}::uuid
        AND genere = ${genere}::${Prisma.raw(tipoGenereSql)}`
  }

  /** Un tentativo di creazione: codice esplicito, oppure primo libero letto sotto lock consultivo. */
  private creaInTransazione(
    tenantId: string,
    utenteId: string,
    genere: G,
    valori: DatiNormalizzati
  ): Promise<CodificaVistaBase<G>> {
    return this.prisma.$transaction(async tx => {
      let codice = valori.codice
      if (codice === null) {
        // Lock consultivo per azienda e genere (nessun lock di riga): serializza le creazioni senza
        // codice senza aspettare le altre scritture. Si rilascia da solo a fine transazione.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${this.cfg.prefissoLock + genere}), hashtext(${tenantId}))`
        codice = this.assegnaCodice(await this.codiciUsati(tx, tenantId, genere))
      }
      const riga = await this.cfg
        .delegato(tx)
        .create({ data: { tenantId, genere, codice, descrizione: valori.descrizione } })
      await this.audit(tx, tenantId, utenteId, 'CREATA', 'creata', {
        codificaId: riga.id,
        genere: riga.genere,
        codice: riga.codice,
      })
      return this.comeVista(riga, tenantId, tx)
    })
  }

  private assegnaCodice(usati: Array<{ codice: string }>): string {
    const libero = primoCodiceLibero(usati.map(r => r.codice))
    if (libero === null) {
      throw new BadRequestException({
        message: MSG_ESAURITI,
        error: `${this.cfg.entita.prefisso}_CODICI_ESAURITI`,
      })
    }
    return libero
  }

  /** Audit nella stessa transazione: solo id, genere, codice e nomi dei campi (D16). */
  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    azione: string,
    esito: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action: `${this.cfg.entita.prefisso}_${azione}`,
        description: `${this.cfg.descrizioneAudit} ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
