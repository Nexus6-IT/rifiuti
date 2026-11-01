// Codifiche di addebito: gruppo, categoria, categorie statistiche e centro di ricavo (4.2a, D4).
// Una tabella per cinque elenchi, distinti dal `genere`, con codice unico per (azienda, genere).
// Stesso schema delle codifiche del contratto della 4.1: lock ottimistico (D14), disattivazione
// al posto della cancellazione quando la codifica e' citata da un addebito (D13), audit (D16).
// Le regole sui dati stanno in `domain/listino/codifica-addebito`; il primo codice libero e'
// `primoCodiceLibero` della 4.1 (non si duplica).
//
// Creazione in linea: senza `codice` (assente o null, R24) il servizio assegna il primo codice
// libero del genere, con un nuovo tentativo in una transazione nuova su P2002.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { primoCodiceLibero } from '../../domain/clienti/codifica-contratto'
import {
  ETICHETTE_GENERE_ADDEBITO,
  normalizzaCodificaAddebito,
  validaCodificaAddebito,
  type GenereCodificaAddebito,
} from '../../domain/listino/codifica-addebito'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from '../clienti/anagrafica-versionata'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { COLONNE_CODIFICA_ADDEBITO, contaUsiListino, type ListinoUsi } from './uso-listino'

const ENTITA: DescrizioneEntita = {
  prefisso: 'CODIFICA_ADDEBITO',
  soggetto: 'La codifica di addebito',
  femminile: true,
  // R9: il testo di ripiego direbbe "clienti o contratti", che qui non c'entrano.
  inUso: {
    codice: 'CODIFICA_ADDEBITO_IN_USO',
    messaggio: "La codifica è usata da addebiti dell'archivio: disattivala invece di eliminarla.",
  },
}

/** Unica chiave unica di business della tabella: (azienda, genere, codice). */
const VINCOLI: VincoliNoti = {
  codifiche_addebito_tenant_id_genere_codice_key: {
    codice: 'CODIFICA_ADDEBITO_CODICE_DUPLICATO',
    messaggio: 'Esiste già una codifica con questo codice in questo elenco.',
  },
}

const MSG_ESAURITI = 'Non si possono creare più di 999 codici per questo elenco.'
const MSG_CODICE = 'Il codice ha da 1 a 3 cifre.'

export interface CodificaAddebitoVista {
  id: string
  genere: GenereCodificaAddebito
  codice: string
  descrizione: string
  attiva: boolean
  versione: number
  /** Nessun addebito la cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

/** Il `genere` si sceglie alla creazione e non cambia piu'. */
export interface NuovaCodificaAddebito {
  genere: GenereCodificaAddebito
  descrizione: string
  /** Assente o null = primo codice libero del genere. */
  codice?: string | null
}

export type ModificaCodificaAddebito = {
  codice?: string
  descrizione?: string
  attiva?: boolean
  versione: number
}

export interface FiltroCodificheAddebito {
  genere: GenereCodificaAddebito
  incluseDisattivate: boolean
}

type RigaCodifica = {
  id: string
  genere: string
  codice: string
  descrizione: string
  attiva: boolean
  versione: number
}

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = ['codice', 'descrizione', 'attiva'] as const
type Campo = (typeof CAMPI)[number]

async function comeVista(
  r: RigaCodifica,
  tenantId: string,
  client: ListinoUsi,
  usiNoti?: number
): Promise<CodificaAddebitoVista> {
  const usi =
    usiNoti ??
    (await contaUsiListino(client, tenantId, [r.id], COLONNE_CODIFICA_ADDEBITO)).get(r.id) ??
    0
  return {
    id: r.id,
    genere: r.genere as GenereCodificaAddebito,
    codice: r.codice,
    descrizione: r.descrizione,
    attiva: r.attiva,
    versione: r.versione,
    eliminabile: usi === 0,
  }
}

function lanciaNonValida(errori: string[]): never {
  throw new BadRequestException({ message: errori, error: 'CODIFICA_ADDEBITO_NON_VALIDA' })
}

const nonTrovata = () =>
  new NotFoundException({
    message: 'Codifica non trovata.',
    error: 'CODIFICA_ADDEBITO_NON_TROVATA',
  })

function controllaGenere(genere: unknown): GenereCodificaAddebito {
  if (
    typeof genere !== 'string' ||
    !Object.prototype.hasOwnProperty.call(ETICHETTE_GENERE_ADDEBITO, genere)
  ) {
    lanciaNonValida(['Il genere della codifica non è ammesso.'])
  }
  return genere as GenereCodificaAddebito
}

const eP2002 = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class CodificheAddebitoService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, filtro: FiltroCodificheAddebito): Promise<CodificaAddebitoVista[]> {
    const genere = controllaGenere(filtro.genere)
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.codificaAddebito.findMany({
        where: filtro.incluseDisattivate
          ? { tenantId, genere }
          : { tenantId, genere, attiva: true },
        orderBy: [{ attiva: 'desc' }, { codice: 'asc' }],
      })
      const usi = await contaUsiListino(
        this.prisma,
        tenantId,
        righe.map(r => r.id),
        COLONNE_CODIFICA_ADDEBITO
      )
      return Promise.all(righe.map(r => comeVista(r, tenantId, this.prisma, usi.get(r.id) ?? 0)))
    })
  }

  async getById(tenantId: string, id: string): Promise<CodificaAddebitoVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.codificaAddebito.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovata()
      return comeVista(riga, tenantId, this.prisma)
    })
  }

  /** Il codice che la creazione in linea assegnerebbe adesso (solo informativo: non riserva nulla). */
  async prossimoCodice(tenantId: string, genere: GenereCodificaAddebito): Promise<string> {
    const g = controllaGenere(genere)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const usati = await tx.$queryRaw<Array<{ codice: string }>>`
          SELECT codice
          FROM codifiche_addebito
          WHERE tenant_id = ${tenantId}::uuid
            AND genere = ${g}::genere_codifica_addebito`
        return this.assegnaCodice(usati)
      })
    )
  }

  async crea(
    tenantId: string,
    utenteId: string,
    dati: NuovaCodificaAddebito
  ): Promise<CodificaAddebitoVista> {
    const valori = normalizzaCodificaAddebito(dati)
    const errori = validaCodificaAddebito(valori)
    if (errori.length > 0) lanciaNonValida(errori)
    const genere = valori.genere as GenereCodificaAddebito

    return nelContestoTenant(tenantId, async () => {
      // Il P2002 si cattura FUORI dalla transazione: una transazione interrotta (25P02) non si
      // riprova. Senza codice esplicito si riprova UNA volta in una transazione nuova, che rilegge
      // i codici e prende il successivo: il FOR UPDATE non blocca gli insert quando il genere non
      // ha ancora righe, quindi due creazioni parallele possono calcolare entrambe `001`.
      const tentativi = valori.codice === null ? 2 : 1
      for (let tentativo = 1; ; tentativo++) {
        try {
          return await this.creaInTransazione(tenantId, utenteId, genere, valori)
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
    m: ModificaCodificaAddebito
  ): Promise<CodificaAddebitoVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.codificaAddebito.findFirst({ where: { id, tenantId } })
          if (!prima) throw nonTrovata()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = {
            codice: prima.codice,
            descrizione: prima.descrizione,
            attiva: prima.attiva,
          }
          // Il genere resta quello della riga: la modifica non lo conosce.
          const unione = normalizzaCodificaAddebito({
            genere: prima.genere,
            codice: m.codice !== undefined ? m.codice : attuali.codice,
            descrizione: m.descrizione ?? attuali.descrizione,
          })
          const errori = validaCodificaAddebito(unione)
          // Un codice inviato ma vuoto non e' "assente": in modifica il codice non si toglie (R24).
          if (unione.codice === null) errori.push(MSG_CODICE)
          if (errori.length > 0) lanciaNonValida(errori)
          const nuovi: Record<Campo, unknown> = {
            codice: unione.codice,
            descrizione: unione.descrizione,
            attiva: m.attiva ?? attuali.attiva,
          }

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return comeVista(prima, tenantId, tx)

          await scriviCondizionato(
            () =>
              tx.codificaAddebito.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c]])),
                  versione: { increment: 1 },
                } as Prisma.CodificaAddebitoUpdateManyMutationInput,
              }),
            ENTITA
          )
          const dopo = await tx.codificaAddebito.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovata()
          await this.audit(tx, tenantId, utenteId, 'CODIFICA_ADDEBITO_MODIFICATA', 'modificata', {
            codificaId: id,
            genere: dopo.genere,
            codice: dopo.codice,
            campi,
          })
          return comeVista(dopo, tenantId, tx)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.codificaAddebito.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovata()
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.codificaAddebito.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'CODIFICA_ADDEBITO_ELIMINATA', 'eliminata', {
            codificaId: id,
            genere: riga.genere,
            codice: riga.codice,
          })
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /** Un tentativo di creazione: codice esplicito, oppure primo libero letto con `FOR UPDATE`. */
  private creaInTransazione(
    tenantId: string,
    utenteId: string,
    genere: GenereCodificaAddebito,
    valori: ReturnType<typeof normalizzaCodificaAddebito>
  ): Promise<CodificaAddebitoVista> {
    return this.prisma.$transaction(async tx => {
      let codice = valori.codice
      if (codice === null) {
        const usati = await tx.$queryRaw<Array<{ codice: string }>>`
          SELECT codice
          FROM codifiche_addebito
          WHERE tenant_id = ${tenantId}::uuid
            AND genere = ${genere}::genere_codifica_addebito
          FOR UPDATE`
        codice = this.assegnaCodice(usati)
      }
      const riga = await tx.codificaAddebito.create({
        data: { tenantId, genere, codice, descrizione: valori.descrizione },
      })
      await this.audit(tx, tenantId, utenteId, 'CODIFICA_ADDEBITO_CREATA', 'creata', {
        codificaId: riga.id,
        genere: riga.genere,
        codice: riga.codice,
      })
      return comeVista(riga, tenantId, tx)
    })
  }

  private assegnaCodice(usati: Array<{ codice: string }>): string {
    const libero = primoCodiceLibero(usati.map(r => r.codice))
    if (libero === null) {
      throw new BadRequestException({
        message: MSG_ESAURITI,
        error: 'CODIFICA_ADDEBITO_CODICI_ESAURITI',
      })
    }
    return libero
  }

  /** Audit nella stessa transazione: solo id, genere, codice e nomi dei campi (D16). */
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
        description: `Codifica di addebito ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
