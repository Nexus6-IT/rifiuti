// Archivio generale degli addebiti (4.2a, D6/D23/D25): anagrafica per azienda con codice a cinque
// cifre, sei listini scritti in blocco, lock ottimistico (D23), cancellazione fisica solo se
// nessuno lo cita (D13) e audit senza dati liberi (D25). Le regole sui dati stanno in
// `domain/listino/addebito`; i riferimenti (codice IVA, codifiche) sono letti con `FOR SHARE` da
// `riferimenti-listino`; i conteggi d'uso da `uso-listino`.
//
// Senza `codice` (creazione in linea, R7) il servizio assegna il primo codice libero con un nuovo
// tentativo, in una transazione nuova, su P2002.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  MSG_CODICE_ADDEBITO,
  normalizzaAddebito,
  prossimoCodiceAddebito,
  validaAddebito,
  type DatiAddebito,
  type PrezzoListino,
  type TipoProvvigione,
} from '../../domain/listino/addebito'
import { prezzoCalcolato } from '../../domain/listino/importi-riga'
import { etichettaTipo } from '../../domain/listino/tipi-addebito'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from '../clienti/anagrafica-versionata'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { controllaRiferimentiListino, type RiferimentiAddebito } from './riferimenti-listino'
import { COLONNE_ADDEBITO, contaUsiListino, type ListinoUsi } from './uso-listino'

const ENTITA: DescrizioneEntita = {
  prefisso: 'ADDEBITO',
  soggetto: "L'addebito",
  femminile: false,
  // R9: il testo di ripiego direbbe "clienti o contratti", che qui non c'entrano.
  inUso: {
    codice: 'ADDEBITO_IN_USO',
    messaggio: "L'addebito è usato da elenchi di addebito: disattivalo invece di eliminarlo.",
  },
}

/** Unica chiave unica di business della tabella: (azienda, codice). */
const VINCOLI: VincoliNoti = {
  addebiti_tenant_id_codice_key: {
    codice: 'ADDEBITO_CODICE_DUPLICATO',
    messaggio: 'Esiste già un addebito con questo codice.',
  },
}

const MSG_ESAURITI = 'Non si possono creare più di 99999 addebiti.'
const TENTATIVI_SENZA_CODICE = 3

const INCLUDE = {
  gruppo: true,
  codiceIva: true,
  categoria: true,
  centroRicavo: true,
  categoriaStatistica1: true,
  categoriaStatistica2: true,
  listini: { orderBy: { numero: 'asc' } },
} satisfies Prisma.AddebitoInclude

type RigaAddebito = Prisma.AddebitoGetPayload<{ include: typeof INCLUDE }>

export interface RiferimentoCodifica {
  id: string
  codice: string
  descrizione: string
}

export interface AddebitoVista {
  id: string
  codice: string
  descrizione: string
  gruppo: RiferimentoCodifica
  unitaMisura: string
  codiceIva: RiferimentoCodifica | null
  tipo: string
  etichettaTipo: string
  categoria: RiferimentoCodifica | null
  tipoProvvigione: TipoProvvigione
  centroRicavo: RiferimentoCodifica | null
  categoriaStatistica1: RiferimentoCodifica | null
  categoriaStatistica2: RiferimentoCodifica | null
  notaUsoInterno: string | null
  appunti: string | null
  /** Sempre sei, per numero; i vuoti hanno i tre campi null. */
  listini: PrezzoListino[]
  attivo: boolean
  versione: number
  /** Nessuno lo cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

/** Alla creazione `codice`, `attivo` e `listini` omessi valgono: primo libero, true, sei vuoti (R7/R24). */
export type NuovoAddebito = Partial<Record<keyof DatiAddebito, unknown>>

/** Un campo assente resta com'e'; `null` azzera i riferimenti e i testi facoltativi; `listini` sostituisce tutti e sei. */
export type ModificaAddebito = Partial<Record<keyof DatiAddebito, unknown>> & { versione: number }

export interface FiltroAddebiti {
  testo?: string
  tipo?: string
  soloAttivi?: boolean
  pagina: number
  dimensione: number
}

/** Campi scalari modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = [
  'codice',
  'descrizione',
  'gruppoId',
  'unitaMisura',
  'codiceIvaId',
  'tipo',
  'categoriaId',
  'tipoProvvigione',
  'centroRicavoId',
  'categoriaStatistica1Id',
  'categoriaStatistica2Id',
  'notaUsoInterno',
  'appunti',
  'attivo',
] as const satisfies ReadonlyArray<keyof DatiAddebito>

const RIFERIMENTI = [
  'gruppoId',
  'codiceIvaId',
  'categoriaId',
  'centroRicavoId',
  'categoriaStatistica1Id',
  'categoriaStatistica2Id',
] as const satisfies ReadonlyArray<keyof RiferimentiAddebito>

const rif = (r: RiferimentoCodifica | null): RiferimentoCodifica | null =>
  r === null ? null : { id: r.id, codice: r.codice, descrizione: r.descrizione }

const listiniDi = (r: RigaAddebito): PrezzoListino[] =>
  [1, 2, 3, 4, 5, 6].map(numero => {
    const l = r.listini.find(x => x.numero === numero)
    return {
      numero: numero as PrezzoListino['numero'],
      prezzo: l?.prezzo != null ? prezzoCalcolato(l.prezzo.toString()) : null,
      sconto: l?.sconto ?? null,
      provvigione: l?.provvigione ?? null,
    }
  })

function comeVista(r: RigaAddebito, usi: number): AddebitoVista {
  return {
    id: r.id,
    codice: r.codice,
    descrizione: r.descrizione,
    gruppo: rif(r.gruppo) as RiferimentoCodifica,
    unitaMisura: r.unitaMisura,
    codiceIva: rif(r.codiceIva),
    tipo: r.tipo,
    etichettaTipo: etichettaTipo(r.tipo),
    categoria: rif(r.categoria),
    tipoProvvigione: r.tipoProvvigione,
    centroRicavo: rif(r.centroRicavo),
    categoriaStatistica1: rif(r.categoriaStatistica1),
    categoriaStatistica2: rif(r.categoriaStatistica2),
    notaUsoInterno: r.notaUsoInterno,
    appunti: r.appunti,
    listini: listiniDi(r),
    attivo: r.attivo,
    versione: r.versione,
    eliminabile: usi === 0,
  }
}

const datiDi = (r: RigaAddebito): DatiAddebito => ({
  codice: r.codice,
  descrizione: r.descrizione,
  gruppoId: r.gruppoId,
  unitaMisura: r.unitaMisura,
  codiceIvaId: r.codiceIvaId,
  tipo: r.tipo,
  categoriaId: r.categoriaId,
  tipoProvvigione: r.tipoProvvigione,
  centroRicavoId: r.centroRicavoId,
  categoriaStatistica1Id: r.categoriaStatistica1Id,
  categoriaStatistica2Id: r.categoriaStatistica2Id,
  notaUsoInterno: r.notaUsoInterno,
  appunti: r.appunti,
  listini: listiniDi(r),
  attivo: r.attivo,
})

/** Forma di confronto dei listini: "10.5" e "10.50" sono lo stesso prezzo. */
const listiniCanonici = (l: readonly PrezzoListino[]) =>
  JSON.stringify(
    l.map(x => [
      x.numero,
      x.prezzo === null ? null : prezzoCalcolato(x.prezzo),
      x.sconto,
      x.provvigione,
    ])
  )

function lanciaNonValido(errori: string[]): never {
  throw new BadRequestException({ message: errori, error: 'ADDEBITO_NON_VALIDO' })
}

const nonTrovato = () =>
  new NotFoundException({ message: 'Addebito non trovato.', error: 'ADDEBITO_NON_TROVATO' })

const eP2002 = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class AddebitiService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    f: FiltroAddebiti
  ): Promise<{ elementi: AddebitoVista[]; totale: number }> {
    const testo = f.testo?.trim()
    const where: Prisma.AddebitoWhereInput = {
      tenantId,
      ...(f.soloAttivi ? { attivo: true } : {}),
      ...(f.tipo ? { tipo: f.tipo } : {}),
      ...(testo
        ? {
            OR: [
              { codice: { contains: testo, mode: 'insensitive' } },
              { descrizione: { contains: testo, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    return nelContestoTenant(tenantId, async () => {
      const [righe, totale] = await Promise.all([
        this.prisma.addebito.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ attivo: 'desc' }, { codice: 'asc' }, { id: 'asc' }],
          skip: (f.pagina - 1) * f.dimensione,
          take: f.dimensione,
        }),
        this.prisma.addebito.count({ where }),
      ])
      const usi = await contaUsiListino(
        this.prisma,
        tenantId,
        righe.map(r => r.id),
        COLONNE_ADDEBITO
      )
      return { elementi: righe.map(r => comeVista(r, usi.get(r.id) ?? 0)), totale }
    })
  }

  async getById(tenantId: string, id: string): Promise<AddebitoVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.addebito.findFirst({
        where: { id, tenantId },
        include: INCLUDE,
      })
      if (!riga) throw nonTrovato()
      return this.vista(this.prisma, tenantId, riga)
    })
  }

  /** Il codice che la creazione in linea assegnerebbe adesso (informativo: non riserva nulla). */
  async prossimoCodice(tenantId: string): Promise<string> {
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const usati = await tx.$queryRaw<Array<{ codice: string }>>`
          SELECT codice FROM addebiti WHERE tenant_id = ${tenantId}::uuid`
        return this.assegnaCodice(usati)
      })
    )
  }

  async crea(tenantId: string, utenteId: string, dati: NuovoAddebito): Promise<AddebitoVista> {
    const valori = normalizzaAddebito(dati)
    const errori = validaAddebito(valori)
    if (errori.length > 0) lanciaNonValido(errori)

    return nelContestoTenant(tenantId, async () => {
      // Il P2002 si cattura FUORI dalla transazione: una transazione interrotta (25P02) non si
      // riprova. Le creazioni senza codice si serializzano col lock consultivo per azienda (vedi
      // `creaInTransazione`); non copre pero' una creazione a codice esplicito, che non lo prende
      // e puo' prendere il codice che l'altra sta per calcolare: su P2002 si riprova in una
      // transazione nuova, che rilegge i codici e prende il successivo.
      const tentativi = valori.codice === '' ? TENTATIVI_SENZA_CODICE : 1
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
    m: ModificaAddebito
  ): Promise<AddebitoVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.addebito.findFirst({ where: { id, tenantId }, include: INCLUDE })
          if (!prima) throw nonTrovato()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = datiDi(prima)
          const { versione: _versione, ...inviati } = m
          const definiti = Object.fromEntries(
            Object.entries(inviati).filter(([, v]) => v !== undefined)
          )
          const unione = normalizzaAddebito({ ...attuali, ...definiti })
          const errori = validaAddebito(unione)
          // Un codice inviato ma vuoto non e' "assente": in modifica il codice non si toglie.
          if (unione.codice === '') errori.push(MSG_CODICE_ADDEBITO)
          if (errori.length > 0) lanciaNonValido(errori)

          const campi: string[] = CAMPI.filter(c => !uguali(unione[c], attuali[c]))
          const listiniCambiati =
            listiniCanonici(unione.listini) !== listiniCanonici(attuali.listini)
          if (campi.length === 0 && !listiniCambiati) return this.vista(tx, tenantId, prima)

          // Solo i riferimenti cambiati e non null si rileggono (e restano bloccati FOR SHARE).
          const daControllare: RiferimentiAddebito = {}
          for (const c of RIFERIMENTI) {
            if (campi.includes(c) && unione[c] !== null) daControllare[c] = unione[c]
          }
          const erroriRif = await controllaRiferimentiListino(tx, tenantId, daControllare)
          if (erroriRif.length > 0) lanciaNonValido(erroriRif)

          // La riga si scrive PRIMA delle figlie: se la versione e' cambiata, nulla si tocca.
          await scriviCondizionato(
            () =>
              tx.addebito.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(
                    CAMPI.filter(c => campi.includes(c)).map(c => [c, unione[c]])
                  ),
                  versione: { increment: 1 },
                } as Prisma.AddebitoUncheckedUpdateManyInput,
              }),
            ENTITA
          )
          if (listiniCambiati) {
            await tx.prezzoListinoAddebito.deleteMany({ where: { addebitoId: id, tenantId } })
            await tx.prezzoListinoAddebito.createMany({
              data: unione.listini.map(l => ({ tenantId, addebitoId: id, ...datiListino(l) })),
            })
          }
          const dopo = await tx.addebito.findFirst({ where: { id, tenantId }, include: INCLUDE })
          if (!dopo) throw nonTrovato()
          await this.audit(tx, tenantId, utenteId, 'ADDEBITO_MODIFICATO', 'modificato', {
            addebitoId: id,
            codice: dopo.codice,
            campi: listiniCambiati ? [...campi, 'listini'] : campi,
          })
          return this.vista(tx, tenantId, dopo)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.addebito.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovato()
          confrontaVersione(riga.versione, versione, ENTITA)
          // Le righe dei listini cadono a cascata (FK CASCADE); chi cita l'addebito lo blocca (P2003).
          await scriviCondizionato(
            () => tx.addebito.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'ADDEBITO_ELIMINATO', 'eliminato', {
            addebitoId: id,
            codice: riga.codice,
          })
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /** Un tentativo di creazione: codice esplicito, oppure primo libero letto sotto lock consultivo. */
  private creaInTransazione(
    tenantId: string,
    utenteId: string,
    valori: DatiAddebito
  ): Promise<AddebitoVista> {
    return this.prisma.$transaction(async tx => {
      let codice = valori.codice
      if (codice === '') {
        // Lock consultivo per azienda (nessun lock di riga): le creazioni senza codice si
        // serializzano fra loro, ma non aspettano ne' si incrociano con la variazione dei prezzi,
        // che blocca le righe in ordine di id. Si rilascia da solo a fine transazione.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext('addebiti-codice'), hashtext(${tenantId}))`
        const usati = await tx.$queryRaw<Array<{ codice: string }>>`
          SELECT codice FROM addebiti WHERE tenant_id = ${tenantId}::uuid`
        codice = this.assegnaCodice(usati)
      }
      const erroriRif = await controllaRiferimentiListino(tx, tenantId, valori)
      if (erroriRif.length > 0) lanciaNonValido(erroriRif)

      const { listini, ...scalari } = valori
      const creato = await tx.addebito.create({
        data: { ...scalari, codice, tenantId, gruppoId: valori.gruppoId as string },
      })
      await tx.prezzoListinoAddebito.createMany({
        data: listini.map(l => ({ tenantId, addebitoId: creato.id, ...datiListino(l) })),
      })
      const riga = await tx.addebito.findFirst({
        where: { id: creato.id, tenantId },
        include: INCLUDE,
      })
      if (!riga) throw nonTrovato()
      await this.audit(tx, tenantId, utenteId, 'ADDEBITO_CREATO', 'creato', {
        addebitoId: riga.id,
        codice: riga.codice,
      })
      return this.vista(tx, tenantId, riga)
    })
  }

  private async vista(
    client: ListinoUsi,
    tenantId: string,
    riga: RigaAddebito
  ): Promise<AddebitoVista> {
    const usi = (await contaUsiListino(client, tenantId, [riga.id], COLONNE_ADDEBITO)).get(riga.id)
    return comeVista(riga, usi ?? 0)
  }

  private assegnaCodice(usati: Array<{ codice: string }>): string {
    const libero = prossimoCodiceAddebito(usati.map(r => r.codice))
    if (libero === null) {
      throw new BadRequestException({ message: MSG_ESAURITI, error: 'ADDEBITO_CODICI_ESAURITI' })
    }
    return libero
  }

  /** Audit nella stessa transazione: solo id, codice e nomi dei campi (D25). */
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
        description: `Addebito ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}

const datiListino = (l: PrezzoListino) => ({
  numero: l.numero,
  prezzo: l.prezzo,
  sconto: l.sconto,
  provvigione: l.provvigione,
})
