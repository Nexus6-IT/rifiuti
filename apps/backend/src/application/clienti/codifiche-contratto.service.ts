// Codifiche del contratto: categorie, tipi e motivi di annullo (4.1a, D26). Una tabella per tre
// elenchi, distinti dal `genere`, con codice unico per (azienda, genere). Lock ottimistico (D14),
// disattivazione al posto della cancellazione quando la codifica e' in uso (D13) e audit (D16).
// Le regole sui dati e il calcolo del primo codice libero stanno in `domain/clienti/codifica-contratto`.
//
// Creazione in linea: senza `codice` il servizio assegna il primo codice numerico libero del genere.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  normalizzaCodifica,
  primoCodiceLibero,
  validaCodifica,
  type GenereCodifica,
} from '../../domain/clienti/codifica-contratto'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from './anagrafica-versionata'
import { COLONNE_CODIFICA, contaUsi, type ClientUsi } from './uso-tabelle-fatturazione'

const ENTITA: DescrizioneEntita = {
  prefisso: 'CODIFICA_CONTRATTO',
  soggetto: 'La codifica del contratto',
  femminile: true,
}

/** Unica chiave unica di business della tabella: (azienda, genere, codice). */
const VINCOLI: VincoliNoti = {
  codifiche_contratto_tenant_id_genere_codice_key: {
    codice: 'CODIFICA_CONTRATTO_CODICE_DUPLICATO',
    messaggio: 'Esiste già una codifica con questo codice in questo elenco.',
  },
}

const MSG_ESAURITI = 'Non si possono creare più di 999 codici per questo elenco.'

export interface CodificaVista {
  id: string
  genere: GenereCodifica
  codice: string
  descrizione: string
  attiva: boolean
  versione: number
  /** Nessun cliente o contratto la cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

/** Il `genere` si sceglie alla creazione e non cambia piu'. */
export interface NuovaCodifica {
  genere: GenereCodifica
  descrizione: string
  /** Omesso = primo codice numerico libero del genere (D26). */
  codice?: string | null
}

export type ModificaCodifica = {
  codice?: string
  descrizione?: string
  attiva?: boolean
  versione: number
}

export interface FiltroCodifiche {
  genere: GenereCodifica
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
  client: ClientUsi,
  usiNoti?: number
): Promise<CodificaVista> {
  const usi = usiNoti ?? (await contaUsi(client, tenantId, [r.id], COLONNE_CODIFICA)).get(r.id) ?? 0
  return {
    id: r.id,
    genere: r.genere as GenereCodifica,
    codice: r.codice,
    descrizione: r.descrizione,
    attiva: r.attiva,
    versione: r.versione,
    eliminabile: usi === 0,
  }
}

function lanciaNonValida(errori: string[]): never {
  throw new BadRequestException({ message: errori, error: 'CODIFICA_CONTRATTO_NON_VALIDA' })
}

const nonTrovata = () =>
  new NotFoundException({
    message: 'Codifica non trovata.',
    error: 'CODIFICA_CONTRATTO_NON_TROVATA',
  })

const GENERI: readonly string[] = ['CATEGORIA', 'TIPO', 'MOTIVO_ANNULLO']

function controllaGenere(genere: unknown): GenereCodifica {
  if (typeof genere !== 'string' || !GENERI.includes(genere)) {
    lanciaNonValida(['Il genere della codifica non è ammesso.'])
  }
  return genere as GenereCodifica
}

const eP2002 = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class CodificheContrattoService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, filtro: FiltroCodifiche): Promise<CodificaVista[]> {
    const genere = controllaGenere(filtro.genere)
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.codificaContratto.findMany({
        where: filtro.incluseDisattivate
          ? { tenantId, genere }
          : { tenantId, genere, attiva: true },
        orderBy: [{ attiva: 'desc' }, { codice: 'asc' }],
      })
      const usi = await contaUsi(
        this.prisma,
        tenantId,
        righe.map(r => r.id),
        COLONNE_CODIFICA
      )
      return Promise.all(righe.map(r => comeVista(r, tenantId, this.prisma, usi.get(r.id) ?? 0)))
    })
  }

  async getById(tenantId: string, id: string): Promise<CodificaVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.codificaContratto.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovata()
      return comeVista(riga, tenantId, this.prisma)
    })
  }

  /** Il codice che la creazione in linea assegnerebbe adesso (solo informativo: non riserva nulla). */
  async prossimoCodice(tenantId: string, genere: GenereCodifica): Promise<string> {
    const g = controllaGenere(genere)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const usati = await tx.$queryRaw<Array<{ codice: string }>>`
          SELECT codice
          FROM codifiche_contratto
          WHERE tenant_id = ${tenantId}::uuid
            AND genere = ${g}::genere_codifica_contratto`
        return this.assegnaCodice(usati)
      })
    )
  }

  async crea(tenantId: string, utenteId: string, dati: NuovaCodifica): Promise<CodificaVista> {
    const valori = normalizzaCodifica(dati)
    const errori = validaCodifica(valori)
    if (errori.length > 0) lanciaNonValida(errori)

    return nelContestoTenant(tenantId, async () => {
      // Il P2002 si cattura FUORI dalla transazione: una transazione interrotta (25P02) non si
      // riprova. Senza codice esplicito si riprova UNA volta in una transazione nuova, che rilegge
      // i codici e prende il successivo. Il test concorrente (due POST in parallelo = 001 e 002)
      // passa grazie a questo nuovo tentativo: il FOR UPDATE non blocca gli insert quando il
      // genere non ha ancora righe, quindi i due possono calcolare entrambi `001`.
      const tentativi = valori.codice === null ? 2 : 1
      for (let tentativo = 1; ; tentativo++) {
        try {
          return await this.creaInTransazione(tenantId, utenteId, valori)
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
    m: ModificaCodifica
  ): Promise<CodificaVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.codificaContratto.findFirst({ where: { id, tenantId } })
          if (!prima) throw nonTrovata()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = {
            codice: prima.codice,
            descrizione: prima.descrizione,
            attiva: prima.attiva,
          }
          // Il genere resta quello della riga: la modifica non lo conosce.
          const unione = normalizzaCodifica({
            genere: prima.genere,
            codice: m.codice ?? attuali.codice,
            descrizione: m.descrizione ?? attuali.descrizione,
          })
          const errori = validaCodifica(unione)
          if (unione.codice === null) errori.push('Indica il codice.')
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
              tx.codificaContratto.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c]])),
                  versione: { increment: 1 },
                } as Prisma.CodificaContrattoUpdateManyMutationInput,
              }),
            ENTITA
          )
          const dopo = await tx.codificaContratto.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovata()
          await this.audit(tx, tenantId, utenteId, 'CODIFICA_CONTRATTO_MODIFICATA', 'modificata', {
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
          const riga = await tx.codificaContratto.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovata()
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.codificaContratto.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'CODIFICA_CONTRATTO_ELIMINATA', 'eliminata', {
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
    valori: ReturnType<typeof normalizzaCodifica>
  ): Promise<CodificaVista> {
    return this.prisma.$transaction(async tx => {
      let codice = valori.codice
      if (codice === null) {
        const usati = await tx.$queryRaw<Array<{ codice: string }>>`
          SELECT codice
          FROM codifiche_contratto
          WHERE tenant_id = ${tenantId}::uuid
            AND genere = ${valori.genere}::genere_codifica_contratto
          FOR UPDATE`
        codice = this.assegnaCodice(usati)
      }
      const riga = await tx.codificaContratto.create({
        data: { tenantId, genere: valori.genere, codice, descrizione: valori.descrizione },
      })
      await this.audit(tx, tenantId, utenteId, 'CODIFICA_CONTRATTO_CREATA', 'creata', {
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
        error: 'CODIFICA_CONTRATTO_CODICI_ESAURITI',
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
        description: `Codifica del contratto ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
