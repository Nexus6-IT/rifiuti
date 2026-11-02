// Righe di addebito di un elenco (4.2b, D9-D12, D14, D16, D17, R36, R37, R40, R41, R43): lista,
// creazione, modifica con lock ottimistico, eliminazione, proposta dall'archivio e codifiche RENTRI.
// Le regole sui dati stanno in `domain/listino/riga-addebito` (+ prezzo speciale e scadenze); qui
// ci sono quelle che chiedono il database: CER nel catalogo, riferimenti, regole fra righe (D11).
//
// Ordine dei lock (R40): contratto FOR SHARE -> lock consultivo per cliente (solo `$D` con UM `#`)
// -> lock consultivo per contratto (`M…` e `$…`) -> elenco FOR UPDATE -> riferimenti FOR SHARE.
// Le scritture del listino non cambiano la `versione` del contratto (D16).
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  prezzoProposto,
  provvigioneProposta,
  normalizzaCodiceAddebito,
  type PrezzoListino,
  type TipoProvvigione,
} from '../../domain/listino/addebito'
import {
  cascataValida,
  normalizzaCascata,
  prezzoCalcolato,
} from '../../domain/listino/importi-riga'
import type { Scaglione } from '../../domain/listino/prezzo-speciale'
import {
  ETICHETTE_CAMPI_RIGA,
  formaCerValida,
  normalizzaRiga,
  tipologiaDaCer,
  validaRiga,
  type CampoRiga,
  type DatiRiga,
  type ErroreRiga,
} from '../../domain/listino/riga-addebito'
import { scadenzeNelPeriodo, type Scadenza } from '../../domain/listino/scadenze-fisse'
import {
  etichettaTipo,
  famigliaTipo,
  type FamigliaAddebito,
} from '../../domain/listino/tipi-addebito'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from '../clienti/anagrafica-versionata'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  bloccaContrattoListino,
  impostaTimeoutLock,
  lockConsultivoContratto,
  OPZIONI_TRANSAZIONE_SCRITTURA,
  type ContrattoBloccato,
} from './lock-listino'
import {
  cerNelCatalogo,
  normalizzaCerCode,
  type LettoreCatalogoCer,
} from '../registro/cer-catalogo'
import { controllaRiferimentiRiga, MSG_CER_NON_NEL_CATALOGO } from './riferimenti-listino'

const ENTITA: DescrizioneEntita = {
  prefisso: 'RIGA_ADDEBITO',
  soggetto: 'La riga di addebito',
  femminile: true,
  inUso: {
    codice: 'RIGA_ADDEBITO_IN_USO',
    messaggio: 'La riga è usata da movimenti: non si può eliminare.',
  },
}

const MSG_DUPLICATA = 'L’addebito è già nell’elenco con lo stesso riferimento.'

/** R43: l'indice unico della riga (elenco, tipo, CER, addebito, riferimento). */
const VINCOLI: VincoliNoti = {
  righe_addebito_elenco_tipo_cer_addebito_rif_key: {
    codice: 'RIGA_ADDEBITO_DUPLICATA',
    messaggio: MSG_DUPLICATA,
  },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MSG_MINIMO = 'Nel contratto c’è già un addebito di minimo fatturabile.'
const MSG_ACCONTO = 'Nel contratto c’è già un acconto, una detrazione o un anticipo.'
const MSG_DETRAZIONE = 'Il cliente ha già una detrazione a scalare in un altro contratto.'
const MSG_CONDIZIONI_SENZA_CONDIZIONATI =
  'Le condizioni indicate non trovano addebiti condizionati con la stessa unità di misura in questo elenco.'

/** Tabelle RENTRI esposte da `GET righe-addebito/codifiche-rentri` (R42). */
export const TABELLE_CODIFICHE_RENTRI = ['stati-fisici', 'attivita-rs'] as const
export type TabellaCodificheRentri = (typeof TABELLE_CODIFICHE_RENTRI)[number]

export interface RiferimentoCodifica {
  id: string
  codice: string
  descrizione: string
}

export interface RigaAddebitoVista {
  id: string
  elencoId: string
  tipo: string
  etichettaTipo: string
  famiglia: FamigliaAddebito
  cerCode: string | null
  addebito: { id: string; codice: string; descrizione: string } | null
  riferimento: string | null
  descrizione: string | null
  tipoQuantita: string | null
  quantitaFissa: string | null
  unitaMisura: string
  prezzo: string | null
  prezzoSpeciale: boolean
  sconto: string | null
  codiceIva: { id: string; codice: string; descrizione: string }
  provvigione: string | null
  tipoProvvigione: TipoProvvigione | null
  tipologiaRifiuto: string | null
  statoFisico: string | null
  operazione: string | null
  categoria: RiferimentoCodifica | null
  centroRicavo: RiferimentoCodifica | null
  applicaA: string | null
  scaglioni: Scaglione[]
  condizione: number | null
  condizioniRiferite: string | null
  minimoFatturabile: string | null
  minimoPerCategoria: boolean
  riferimentoGiorno: number | null
  riferimentoMese: number | null
  periodoScadenze: string | null
  periodoExtraDal: string | null
  periodoExtraAl: string | null
  scadenze: (Scadenza & { fatturabileNelContratto: boolean })[]
  stimaAnnuaKg: string | null
  cerProposta: string[]
  addebitiProposti: string[]
  appunti: string | null
  notaUsoInterno: string | null
  versione: number
}

/** `GET /contratti-clienti/:id/righe-proposta` (D6, D7). */
export interface PropostaRiga {
  descrizione: string | null
  unitaMisura: string | null
  codiceIva: { id: string; codice: string; descrizione: string } | null
  tipo: string | null
  categoria: RiferimentoCodifica | null
  centroRicavo: RiferimentoCodifica | null
  prezzo: string | null
  sconto: string | null
  provvigione: string | null
  tipoProvvigione: TipoProvvigione | null
  tipologiaRifiuto: string | null
}

/** Corpo grezzo di creazione o modifica: il DTO controlla i tipi, il dominio i valori. */
export type CorpoRiga = object
/** Corpo di modifica: qualunque oggetto con la `versione` letta (il DTO, o un letterale nei test). */
export interface ModificaRiga {
  versione: number
}

const INCLUDE = {
  addebito: { select: { id: true, codice: true, descrizione: true } },
  codiceIva: { select: { id: true, codice: true, descrizione: true } },
  categoria: { select: { id: true, codice: true, descrizione: true } },
  centroRicavo: { select: { id: true, codice: true, descrizione: true } },
  scaglioni: { orderBy: { ordine: 'asc' } },
  scadenze: { orderBy: { ordine: 'asc' } },
  elenco: {
    select: {
      codice: true,
      contratto: {
        select: { id: true, numero: true, dataInizio: true, dataFine: true },
      },
    },
  },
} satisfies Prisma.RigaAddebitoInclude

type RigaDb = Prisma.RigaAddebitoGetPayload<{ include: typeof INCLUDE }>

const CAMPI = Object.keys(ETICHETTE_CAMPI_RIGA) as CampoRiga[]
const CAMPI_FIGLI: readonly CampoRiga[] = ['scaglioni', 'scadenze']
const CAMPI_SCALARI = CAMPI.filter(c => !CAMPI_FIGLI.includes(c)) as Exclude<
  CampoRiga,
  'scaglioni' | 'scadenze'
>[]
const CAMPI_DATA: readonly CampoRiga[] = ['periodoExtraDal', 'periodoExtraAl']
const CAMPI_DECIMALI: readonly CampoRiga[] = [
  'prezzo',
  'quantitaFissa',
  'minimoFatturabile',
  'stimaAnnuaKg',
]
/** Campi che cambiano le regole fra righe (D11): se nessuno cambia non si rileggono. */
const CAMPI_D11: readonly CampoRiga[] = [
  'tipo',
  'cerCode',
  'addebitoId',
  'riferimento',
  'unitaMisura',
  'condizione',
  'condizioniRiferite',
]

const giorno = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10))
const comeData = (s: string | null): Date | null =>
  s === null ? null : new Date(`${s}T00:00:00.000Z`)

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

const rigaNonTrovata = () =>
  new NotFoundException({
    message: 'Riga di addebito non trovata.',
    error: 'RIGA_ADDEBITO_NON_TROVATA',
  })

/**
 * R36: 400 con `errori` per campo; `message` resta la lista dei testi. Il filtro globale delle
 * eccezioni (`core/filters`) inoltra al client solo `error`, `message` e `details`: per questo gli
 * stessi `errori` stanno anche in `details.errori`, l'unica copia che oggi arriva fino al FE.
 */
function lanciaNonValida(errori: readonly ErroreRiga[]): never {
  throw new BadRequestException({
    error: 'RIGA_ADDEBITO_NON_VALIDA',
    message: errori.map(e => e.messaggio),
    errori,
    details: { errori },
  })
}

function senzaDoppioni(errori: readonly ErroreRiga[]): ErroreRiga[] {
  const visti = new Set<string>()
  return errori.filter(e => {
    const chiave = `${e.campo ?? ''}|${e.messaggio}`
    if (visti.has(chiave)) return false
    visti.add(chiave)
    return true
  })
}

/** Forma di confronto di un decimale: "10.50" e "10.5" sono lo stesso valore. */
function decimaleCanonico(v: unknown): unknown {
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return new Prisma.Decimal(v).toFixed()
  return v
}

/** Ogni campo della riga come testo confrontabile (numeri in forma canonica). */
function firma(d: DatiRiga): Record<CampoRiga, string> {
  const valori = d as unknown as Record<CampoRiga, unknown>
  const f = {} as Record<CampoRiga, string>
  for (const c of CAMPI) {
    let v = valori[c]
    if (CAMPI_DECIMALI.includes(c)) v = decimaleCanonico(v)
    if (c === 'scaglioni') {
      v = (v as Scaglione[]).map(s => ({
        ...s,
        finoA: decimaleCanonico(s.finoA),
        prezzo: decimaleCanonico(s.prezzo),
      }))
    }
    f[c] = JSON.stringify(v ?? null)
  }
  return f
}

/** Il corpo non vuoto: `undefined` = chiave assente. */
const definiti = (corpo: CorpoRiga): Record<string, unknown> =>
  Object.fromEntries(Object.entries(corpo).filter(([, v]) => v !== undefined))

/** Le colonne scalari della riga, nel formato del database. */
function scalariPerDatabase(d: DatiRiga): Record<string, unknown> {
  const v = d as unknown as Record<string, unknown>
  const r: Record<string, unknown> = {}
  for (const c of CAMPI_SCALARI)
    r[c] = CAMPI_DATA.includes(c) ? comeData(v[c] as string | null) : v[c]
  return r
}

/**
 * La riga letta dal database nel formato grezzo del corpo (R37: base del PATCH). Serve anche alla
 * copia delle righe (Task 23), che le riconvalida con le regole del dominio.
 */
export function grezzoDaRiga<
  R extends {
    scaglioni: {
      ordine: number
      finoA: unknown
      prezzo: unknown
      sconto: string | null
      provvigione: string | null
      tipoCalcolo: string
    }[]
    scadenze: { ordine: number; giorno: number; mese: number; anno: number | null }[]
  },
>(r: R): Record<string, unknown> {
  return {
    ...r,
    scaglioni: r.scaglioni.map(s => ({
      ordine: s.ordine,
      finoA: s.finoA,
      prezzo: s.prezzo,
      sconto: s.sconto,
      provvigione: s.provvigione,
      tipoCalcolo: s.tipoCalcolo,
    })),
    scadenze: r.scadenze.map(s => ({
      ordine: s.ordine,
      giorno: s.giorno,
      mese: s.mese,
      anno: s.anno,
    })),
  }
}

@Injectable()
export class RigheAddebitoService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------------------------
  // Letture
  // -------------------------------------------------------------------------------------------

  async list(tenantId: string, elencoId: string): Promise<RigaAddebitoVista[]> {
    if (!UUID.test(elencoId)) throw elencoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const elenco = await tx.elencoAddebiti.findFirst({
          where: { id: elencoId, tenantId, contratto: { eliminatoIl: null } },
          select: { id: true },
        })
        if (!elenco) throw elencoNonTrovato()
        const righe = await tx.rigaAddebito.findMany({
          where: { tenantId, elencoId },
          include: INCLUDE,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
        // Come WinWaste (`ORDER BY TIPO, addeb`): tipo, poi CER o codice dell'addebito, riferimento.
        const chiave = (r: (typeof righe)[number]) =>
          [r.tipo, r.cerCode ?? r.addebito?.codice ?? '', r.riferimento ?? ''].join('\u0000')
        righe.sort((a, b) => (chiave(a) < chiave(b) ? -1 : chiave(a) > chiave(b) ? 1 : 0))
        return righe.map(r => this.vista(r))
      })
    )
  }

  async getById(tenantId: string, id: string): Promise<RigaAddebitoVista> {
    if (!UUID.test(id)) throw rigaNonTrovata()
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.rigaAddebito.findFirst({
        where: { id, tenantId, elenco: { contratto: { eliminatoIl: null } } },
        include: INCLUDE,
      })
      if (!riga) throw rigaNonTrovata()
      return this.vista(riga)
    })
  }

  /** Stati fisici o operazioni RENTRI: `codice` e' l'`external_id`, quello che la riga salva (R42). */
  async codificheRentri(
    tabella: TabellaCodificheRentri
  ): Promise<{ codice: string; descrizione: string }[]> {
    const voci = await this.prisma.rentriCodificaSemplice.findMany({
      where: { tabella, presenteInRentri: true },
      select: { externalId: true, name: true },
      orderBy: [{ name: 'asc' }, { externalId: 'asc' }],
    })
    return voci.map(v => ({ codice: v.externalId, descrizione: v.name }))
  }

  /**
   * Valori proposti alla scelta di un addebito o di un CER (D6, D7). Il prezzo dall'archivio si
   * propone solo se il listino ha un prezzo (R6, Q9); la provvigione del cliente, se positiva,
   * sostituisce quella del listino (R23, R57).
   */
  async proposta(
    tenantId: string,
    contrattoId: string,
    scelta: { addebitoId?: string; cerCode?: string }
  ): Promise<PropostaRiga> {
    if (!UUID.test(contrattoId)) throw contrattoNonTrovato()
    const addebitoId = scelta.addebitoId?.trim() || undefined
    const cerCode = scelta.cerCode?.trim() || undefined
    if ((addebitoId === undefined) === (cerCode === undefined)) {
      throw new BadRequestException({
        error: 'PROPOSTA_RIGA_NON_VALIDA',
        message: ['Indica l’addebito oppure il codice CER.'],
      })
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const contratto = await tx.contrattoCliente.findFirst({
          where: { id: contrattoId, tenantId, eliminatoIl: null },
          select: { clienteId: true },
        })
        if (!contratto) throw contrattoNonTrovato()
        const cliente = await tx.cliente.findFirst({
          where: { id: contratto.clienteId, tenantId },
          select: { listino: true, provvigionePredefinita: true, tipoProvvigionePredefinita: true },
        })
        if (cerCode !== undefined) return this.propostaDaCer(tx, cerCode, cliente)
        return this.propostaDaAddebito(tx, tenantId, addebitoId as string, cliente)
      })
    )
  }

  private async propostaDaCer(
    tx: Prisma.TransactionClient,
    cerCode: string,
    cliente: ClienteListino | null
  ): Promise<PropostaRiga> {
    const canonico = normalizzaCerCode(cerCode)
    const nelCatalogo = formaCerValida(canonico)
      ? await cerNelCatalogo(tx as unknown as LettoreCatalogoCer, canonico)
      : null
    if (nelCatalogo === null) {
      lanciaNonValida([{ campo: 'cerCode', messaggio: MSG_CER_NON_NEL_CATALOGO }])
    }
    const voce = await tx.cERCode.findFirst({
      where: { code: nelCatalogo },
      select: { description: true },
    })
    // D7, E7: anche sulle righe CER la provvigione del cliente, se positiva, e' proposta.
    const provv = provvigioneProposta(
      { provvigione: null, tipo: 'SCONTATO' },
      provvigioneDelCliente(cliente)
    )
    return {
      ...proposteVuote(),
      descrizione: voce ? voce.description.slice(0, 45) : null,
      tipo: 'CER',
      tipologiaRifiuto: tipologiaDaCer(nelCatalogo),
      provvigione: provv.provvigione,
      tipoProvvigione: provv.provvigione === null ? null : provv.tipo,
    }
  }

  private async propostaDaAddebito(
    tx: Prisma.TransactionClient,
    tenantId: string,
    addebitoId: string,
    cliente: ClienteListino | null
  ): Promise<PropostaRiga> {
    const a = UUID.test(addebitoId)
      ? await tx.addebito.findFirst({
          where: { id: addebitoId, tenantId },
          include: {
            codiceIva: { select: { id: true, codice: true, descrizione: true } },
            categoria: { select: { id: true, codice: true, descrizione: true } },
            centroRicavo: { select: { id: true, codice: true, descrizione: true } },
            listini: { orderBy: { numero: 'asc' } },
          },
        })
      : null
    if (!a) {
      throw new NotFoundException({
        message: 'Addebito non trovato.',
        error: 'ADDEBITO_NON_TROVATO',
      })
    }
    if (!a.attivo) {
      lanciaNonValida([{ campo: 'addebitoId', messaggio: 'L’addebito scelto è disattivato.' }])
    }
    const listini: PrezzoListino[] = [1, 2, 3, 4, 5, 6].map(numero => {
      const l = a.listini.find(x => x.numero === numero)
      return {
        numero: numero as PrezzoListino['numero'],
        prezzo: l?.prezzo != null ? l.prezzo.toFixed() : null,
        sconto: l?.sconto ?? null,
        provvigione: l?.provvigione ?? null,
      }
    })
    const scelto = prezzoProposto(listini, cliente?.listino ?? null)

    const provv = provvigioneProposta(
      { provvigione: scelto?.provvigione ?? null, tipo: a.tipoProvvigione },
      provvigioneDelCliente(cliente)
    )

    return {
      descrizione: a.descrizione,
      unitaMisura: a.unitaMisura,
      codiceIva: a.codiceIva,
      tipo: a.tipo,
      categoria: a.categoria,
      centroRicavo: a.centroRicavo,
      prezzo: scelto?.prezzo != null ? prezzoCalcolato(scelto.prezzo) : null,
      sconto: scelto?.sconto ?? null,
      provvigione: provv.provvigione,
      tipoProvvigione: provv.provvigione === null ? null : provv.tipo,
      tipologiaRifiuto: null,
    }
  }

  // -------------------------------------------------------------------------------------------
  // Scritture
  // -------------------------------------------------------------------------------------------

  async crea(
    tenantId: string,
    utenteId: string,
    elencoId: string,
    corpo: CorpoRiga
  ): Promise<RigaAddebitoVista> {
    if (!UUID.test(elencoId)) throw elencoNonTrovato()
    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const noto = await tx.elencoAddebiti.findFirst({
            where: { id: elencoId, tenantId, contratto: { eliminatoIl: null } },
            select: { contrattoId: true, codice: true },
          })
          if (!noto) throw elencoNonTrovato()
          const dati = definiti(corpo)
          const contratto = await bloccaContrattoListino(tx, tenantId, noto.contrattoId)
          await this.lockPerTipo(tx, contratto, dati.tipo, dati.unitaMisura)
          await this.bloccaElencoRighe(tx, tenantId, elencoId)

          const { nuovi } = await this.preparaDati(tx, tenantId, {
            contratto,
            elencoId,
            rigaId: null,
            base: {},
            corpo: dati,
            prima: null,
          })
          const creata = await tx.rigaAddebito.create({
            data: {
              ...(scalariPerDatabase(nuovi) as Prisma.RigaAddebitoUncheckedCreateInput),
              tenantId,
              elencoId,
            },
          })
          await this.scriviFigli(tx, tenantId, creata.id, nuovi)
          const dopo = await this.rileggi(tx, tenantId, creata.id)
          await this.audit(tx, tenantId, utenteId, 'RIGA_ADDEBITO_CREATA', 'creata', dopo, [])
          return this.vista(dopo)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
      } catch (err) {
        return await traduciErrorePrisma(err, ENTITA, VINCOLI)
      }
    })
  }

  async modifica<M extends ModificaRiga>(
    tenantId: string,
    utenteId: string,
    id: string,
    m: M
  ): Promise<RigaAddebitoVista> {
    if (!UUID.test(id)) throw rigaNonTrovata()
    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const { versione, ...corpo } = m
          const patch = definiti(corpo)
          const { contratto, riga: prima } = await this.bloccaRiga(tx, tenantId, id, patch)
          confrontaVersione(prima.versione, versione, ENTITA)

          const { nuovi, precedenti } = await this.preparaDati(tx, tenantId, {
            contratto,
            elencoId: prima.elencoId,
            rigaId: id,
            base: this.grezzoDa(prima),
            corpo: patch,
            prima,
          })
          const fn = firma(nuovi)
          const fp = firma(precedenti)
          const campi = CAMPI.filter(c => fn[c] !== fp[c])
          if (campi.length === 0) return this.vista(prima)

          const valori = scalariPerDatabase(nuovi)
          const scalari = campi.filter(c => !CAMPI_FIGLI.includes(c))
          await scriviCondizionato(
            () =>
              tx.rigaAddebito.updateMany({
                where: { id, tenantId, versione },
                data: {
                  ...Object.fromEntries(scalari.map(c => [c, valori[c]])),
                  versione: { increment: 1 },
                } as Prisma.RigaAddebitoUncheckedUpdateManyInput,
              }),
            ENTITA
          )
          // Fasce e scadenze si sostituiscono in blocco, ma solo se sono cambiate (R37).
          if (campi.includes('scaglioni')) {
            await tx.scaglioneRigaAddebito.deleteMany({ where: { tenantId, rigaId: id } })
          }
          if (campi.includes('scadenze')) {
            await tx.scadenzaRigaAddebito.deleteMany({ where: { tenantId, rigaId: id } })
          }
          await this.scriviFigli(tx, tenantId, id, nuovi, {
            scaglioni: campi.includes('scaglioni'),
            scadenze: campi.includes('scadenze'),
          })
          const dopo = await this.rileggi(tx, tenantId, id)
          await this.audit(tx, tenantId, utenteId, 'RIGA_ADDEBITO_MODIFICATA', 'modificata', dopo, [
            ...campi,
          ])
          return this.vista(dopo)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
      } catch (err) {
        return await traduciErrorePrisma(err, ENTITA, VINCOLI)
      }
    })
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    if (!UUID.test(id)) throw rigaNonTrovata()
    return nelContestoTenant(tenantId, async () => {
      try {
        await this.prisma.$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const { riga } = await this.bloccaRiga(tx, tenantId, id, {})
          confrontaVersione(riga.versione, versione, ENTITA)
          // Fasce e scadenze vanno a cascata (FK ON DELETE CASCADE).
          await scriviCondizionato(
            () => tx.rigaAddebito.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'RIGA_ADDEBITO_ELIMINATA', 'eliminata', riga, [])
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
      } catch (err) {
        await traduciErrorePrisma(err, ENTITA, VINCOLI)
      }
    })
  }

  // -------------------------------------------------------------------------------------------
  // Normalizzazione, validazione e regole fra righe
  // -------------------------------------------------------------------------------------------

  /**
   * Porta il corpo ai dati della riga e li valida (R35-R37, R41, D11). `base` e' la riga di prima nel
   * formato grezzo (vuoto in creazione). `inviati` sono solo le chiavi che cambiano davvero: un
   * PATCH che rimanda lo stesso CER non deve ripristinare la tipologia scelta a mano.
   */
  private async preparaDati(
    tx: Prisma.TransactionClient,
    tenantId: string,
    c: {
      contratto: ContrattoBloccato
      elencoId: string
      rigaId: string | null
      base: Record<string, unknown>
      corpo: Record<string, unknown>
      prima: RigaDb | null
    }
  ): Promise<{ nuovi: DatiRiga; precedenti: DatiRiga; inviati: ReadonlySet<string> }> {
    const unione = { ...c.base, ...c.corpo }
    const vuoto = normalizzaRiga({}, new Set()).dati
    const precedenti = c.prima ? normalizzaRiga(c.base, new Set()).dati : vuoto

    let inviati: Set<string>
    if (c.prima) {
      const soloUnione = firma(normalizzaRiga(unione, new Set()).dati)
      const soloPrima = firma(precedenti)
      inviati = new Set(
        Object.keys(c.corpo).filter(k => soloUnione[k as CampoRiga] !== soloPrima[k as CampoRiga])
      )
    } else {
      inviati = new Set(Object.keys(c.corpo))
    }

    // Il CER del catalogo si legge PRIMA di normalizzare (sul CER effettivo, anche non cambiato).
    const tipoEffettivo = typeof unione.tipo === 'string' ? unione.tipo.trim().toUpperCase() : ''
    const cerScritto = typeof unione.cerCode === 'string' ? unione.cerCode.trim() : ''
    let cerCatalogo: string | null = null
    let cerFormaValida = false
    if (tipoEffettivo === 'CER' && cerScritto !== '') {
      const canonico = normalizzaCerCode(cerScritto)
      cerFormaValida = formaCerValida(canonico)
      if (cerFormaValida) {
        cerCatalogo = await cerNelCatalogo(tx as unknown as LettoreCatalogoCer, canonico)
      }
    }

    const { dati: nuovi, errori: eNorm } = normalizzaRiga(unione, inviati, { cerCatalogo })
    nuovi.addebitiProposti = nuovi.addebitiProposti.map(x => normalizzaCodiceAddebito(x) ?? x)
    nuovi.cerProposta = await this.cerPropostaDelCatalogo(tx, nuovi.cerProposta)

    const errori: ErroreRiga[] = [...eNorm]
    if (tipoEffettivo === 'CER' && cerFormaValida && cerCatalogo === null) {
      errori.push({ campo: 'cerCode', messaggio: MSG_CER_NON_NEL_CATALOGO })
    }
    errori.push(
      ...validaRiga(nuovi, { contrattoAllegato: c.contratto.contrattoPrincipaleId !== null })
    )
    errori.push(
      ...(await controllaRiferimentiRiga(tx, tenantId, {
        addebitoId: inviati.has('addebitoId') ? nuovi.addebitoId : null,
        codiceIvaId: inviati.has('codiceIvaId') ? nuovi.codiceIvaId : null,
        categoriaId: inviati.has('categoriaId') ? nuovi.categoriaId : null,
        centroRicavoId: inviati.has('centroRicavoId') ? nuovi.centroRicavoId : null,
        statoFisico: inviati.has('statoFisico') ? nuovi.statoFisico : null,
        operazione: inviati.has('operazione') ? nuovi.operazione : null,
        addebitiProposti: inviati.has('addebitiProposti') ? nuovi.addebitiProposti : [],
        cerProposta: inviati.has('cerProposta') ? nuovi.cerProposta : [],
      }))
    )
    const unici = senzaDoppioni(errori)
    if (unici.length > 0) lanciaNonValida(unici)

    if (!c.prima || CAMPI_D11.some(k => inviati.has(k))) {
      await this.controllaFraRighe(tx, tenantId, c.contratto, c.elencoId, c.rigaId, nuovi)
    }
    return { nuovi, precedenti, inviati }
  }

  /**
   * m5/R35: del CER di ogni elemento (`CER`, `CER/RIF`, `CER/*`) si scrive la forma del catalogo, con
   * l'asterisco dei pericolosi. Un CER non trovato resta com'e': lo segnala `controllaRiferimentiRiga`.
   */
  private async cerPropostaDelCatalogo(
    tx: Prisma.TransactionClient,
    elementi: readonly string[]
  ): Promise<string[]> {
    const parti = elementi.map(el => {
      const barra = el.indexOf('/')
      return { cer: barra < 0 ? el : el.slice(0, barra), coda: barra < 0 ? '' : el.slice(barra) }
    })
    const senza = (c: string) => c.replace(/\*$/, '')
    const validi = parti.filter(p => formaCerValida(p.cer)).map(p => senza(p.cer))
    if (validi.length === 0) return [...elementi]
    const candidati = [...new Set(validi.flatMap(c => [c, `${c}*`]))]
    const trovati = await tx.cERCode.findMany({
      where: { code: { in: candidati } },
      select: { code: true },
    })
    const delCatalogo = new Map<string, string>()
    for (const t of trovati) {
      const base = senza(t.code)
      if (!delCatalogo.has(base) || t.code.endsWith('*')) delCatalogo.set(base, t.code)
    }
    return parti.map(p => {
      const nelCatalogo = formaCerValida(p.cer) ? delCatalogo.get(senza(p.cer)) : undefined
      return `${nelCatalogo ?? p.cer}${p.coda}`
    })
  }

  /** D11, dentro i lock di R40: i 409 per riga, contratto e cliente e il 400 delle condizioni. */
  private async controllaFraRighe(
    tx: Prisma.TransactionClient,
    tenantId: string,
    contratto: ContrattoBloccato,
    elencoId: string,
    rigaId: string | null,
    d: DatiRiga
  ): Promise<void> {
    const escludi = rigaId === null ? {} : { id: { not: rigaId } }
    const conflitto = (codice: string, messaggio: string) =>
      new ConflictException({ error: codice, message: messaggio })

    const doppia = await tx.rigaAddebito.findFirst({
      where: {
        tenantId,
        elencoId,
        tipo: d.tipo,
        cerCode: d.cerCode,
        addebitoId: d.addebitoId,
        riferimento: d.riferimento,
        ...escludi,
      },
      select: { id: true },
    })
    if (doppia) throw conflitto('RIGA_ADDEBITO_DUPLICATA', MSG_DUPLICATA)

    const delContratto = { elenco: { contrattoId: contratto.id } }
    if (/^(M[FW]|M\d{3})$/.test(d.tipo)) {
      const tipi = d.tipo === 'MF' || d.tipo === 'MW' ? ['MF', 'MW'] : [d.tipo]
      const altra = await tx.rigaAddebito.findFirst({
        where: { tenantId, tipo: { in: tipi }, ...delContratto, ...escludi },
        select: { id: true },
      })
      if (altra) throw conflitto('MINIMO_GIA_PRESENTE', MSG_MINIMO)
    }
    if (d.tipo === '$A' || d.tipo === '$D' || d.tipo === '$R') {
      const altra = await tx.rigaAddebito.findFirst({
        where: { tenantId, tipo: { in: ['$A', '$D', '$R'] }, ...delContratto, ...escludi },
        select: { id: true },
      })
      if (altra) throw conflitto('ACCONTO_GIA_PRESENTE', MSG_ACCONTO)
    }
    if (d.tipo === '$D' && (d.unitaMisura === '#' || d.unitaMisura === '%')) {
      // Contratti annullati esclusi: il loro listino e' in sola lettura e non si fattura piu'.
      const altra = await tx.rigaAddebito.findFirst({
        where: {
          tenantId,
          tipo: '$D',
          // WinWaste (ADDEBCON.cs:6735-6760) incrocia % e #: una # trova una % o una #, una %
          // trova una #.
          unitaMisura: { in: d.unitaMisura === '#' ? ['#', '%'] : ['#'] },
          elenco: {
            contratto: {
              clienteId: contratto.clienteId,
              eliminatoIl: null,
              stato: { not: 'ANNULLATO' },
            },
          },
          ...escludi,
        },
        select: { id: true },
      })
      if (altra) throw conflitto('DETRAZIONE_GIA_PRESENTE', MSG_DETRAZIONE)
    }
    if (d.condizioniRiferite !== null) {
      const cifre = [...new Set(d.condizioniRiferite.slice(0, -1).split('').map(Number))]
      // D11, WinWaste `giaesist` (ADDEBCON.cs:6625-6658): una cifra delle condizioni sommate da
      // una sola riga dell'elenco. Piu' righe possono avere lo stesso `condizione` (i condizionati).
      const altre = await tx.rigaAddebito.findMany({
        where: { tenantId, elencoId, condizioniRiferite: { not: null }, ...escludi },
        select: { condizioniRiferite: true },
      })
      const giaSommate = new Set(
        altre.flatMap(a => (a.condizioniRiferite ?? '').slice(0, -1).split('').map(Number))
      )
      const doppia = cifre.find(n => giaSommate.has(n))
      if (doppia !== undefined) {
        throw conflitto(
          'CONDIZIONE_GIA_DEFINITA',
          `La condizione ${doppia} è già definita da un altro addebito di questo elenco.`
        )
      }
      const trovate = await tx.rigaAddebito.findMany({
        where: {
          tenantId,
          elencoId,
          unitaMisura: d.unitaMisura,
          condizione: { in: cifre },
          ...escludi,
        },
        select: { condizione: true },
      })
      const note = new Set(trovate.map(t => t.condizione))
      if (cifre.some(n => !note.has(n))) {
        lanciaNonValida([
          { campo: 'condizioniRiferite', messaggio: MSG_CONDIZIONI_SENZA_CONDIZIONATI },
        ])
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Lock (R40)
  // -------------------------------------------------------------------------------------------

  /**
   * Lock consultivi di R40 sul tipo e l'unita' di misura effettivi: per cliente solo per `$D` con
   * UM `#`, per contratto per `M…` e `$…` (poi la riga e' serializzata con le altre dello stesso
   * tipo anche fra elenchi diversi, dove il `FOR UPDATE` dell'elenco non basta).
   */
  private async lockPerTipo(
    tx: Prisma.TransactionClient,
    contratto: ContrattoBloccato,
    tipo: unknown,
    unitaMisura: unknown
  ): Promise<void> {
    const t = typeof tipo === 'string' ? tipo.trim().toUpperCase() : ''
    const um = typeof unitaMisura === 'string' ? unitaMisura.trim().toUpperCase() : ''
    if (t === '$D' && (um === '#' || um === '%')) {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext('listino-cliente'), hashtext(${contratto.clienteId}))`
    }
    if (t.startsWith('M') || t.startsWith('$')) {
      await lockConsultivoContratto(tx, contratto.id)
    }
  }

  private async bloccaElencoRighe(
    tx: Prisma.TransactionClient,
    tenantId: string,
    elencoId: string
  ): Promise<void> {
    const r = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "elenchi_addebiti"
      WHERE tenant_id = ${tenantId}::uuid AND id = ${elencoId}::uuid FOR UPDATE`
    // Elenco eliminato da un'altra operazione fra la lettura e il lock.
    if (r.length === 0) throw elencoNonTrovato()
  }

  /**
   * Passi 1-4 di R40 per una riga esistente: lettura senza lock per sapere elenco e contratto,
   * contratto FOR SHARE, lock consultivi sul tipo effettivo (quello della riga, o quello del patch),
   * elenco FOR UPDATE e rilettura della riga.
   */
  private async bloccaRiga(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<{ contratto: ContrattoBloccato; riga: RigaDb }> {
    const nota = await tx.rigaAddebito.findFirst({
      where: { id, tenantId, elenco: { contratto: { eliminatoIl: null } } },
      select: {
        elencoId: true,
        tipo: true,
        unitaMisura: true,
        elenco: { select: { contrattoId: true } },
      },
    })
    if (!nota) throw rigaNonTrovata()
    const contratto = await bloccaContrattoListino(tx, tenantId, nota.elenco.contrattoId)
    await this.lockPerTipo(
      tx,
      contratto,
      patch.tipo ?? nota.tipo,
      patch.unitaMisura ?? nota.unitaMisura
    )
    await this.bloccaElencoRighe(tx, tenantId, nota.elencoId)
    const riga = await tx.rigaAddebito.findFirst({ where: { id, tenantId }, include: INCLUDE })
    if (!riga) throw rigaNonTrovata()
    return { contratto, riga }
  }

  // -------------------------------------------------------------------------------------------
  // Scrittura dei figli, vista, audit
  // -------------------------------------------------------------------------------------------

  private async scriviFigli(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rigaId: string,
    d: DatiRiga,
    quali: { scaglioni: boolean; scadenze: boolean } = { scaglioni: true, scadenze: true }
  ): Promise<void> {
    if (quali.scaglioni && d.scaglioni.length > 0) {
      await tx.scaglioneRigaAddebito.createMany({
        data: d.scaglioni.map(s => ({
          tenantId,
          rigaId,
          ordine: s.ordine,
          finoA: s.finoA,
          prezzo: s.prezzo,
          sconto: s.sconto,
          provvigione: s.provvigione,
          tipoCalcolo: s.tipoCalcolo,
        })),
      })
    }
    if (quali.scadenze && d.scadenze.length > 0) {
      await tx.scadenzaRigaAddebito.createMany({
        data: d.scadenze.map(s => ({
          tenantId,
          rigaId,
          ordine: s.ordine,
          giorno: s.giorno,
          mese: s.mese,
          anno: s.anno,
        })),
      })
    }
  }

  private async rileggi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<RigaDb> {
    const r = await tx.rigaAddebito.findFirst({ where: { id, tenantId }, include: INCLUDE })
    if (!r) throw rigaNonTrovata()
    return r
  }

  /** La riga letta dal database nel formato grezzo del corpo (R37: base del PATCH). */
  private grezzoDa(r: RigaDb): Record<string, unknown> {
    return grezzoDaRiga(r)
  }

  private vista(r: RigaDb): RigaAddebitoVista {
    const dal = giorno(r.elenco.contratto.dataInizio) as string
    const fine = giorno(r.elenco.contratto.dataFine)
    // Contratto senza fine: basta guardare abbastanza anni avanti perche' ogni data "ogni anno" cada.
    const al = fine ?? `${Number(dal.slice(0, 4)) + 50}-12-31`
    const rif = (x: { id: string; codice: string; descrizione: string } | null) =>
      x === null ? null : { id: x.id, codice: x.codice, descrizione: x.descrizione }
    return {
      id: r.id,
      elencoId: r.elencoId,
      tipo: r.tipo,
      etichettaTipo: etichettaTipo(r.tipo),
      famiglia: famigliaTipo(r.tipo),
      cerCode: r.cerCode,
      addebito: rif(r.addebito),
      riferimento: r.riferimento,
      descrizione: r.descrizione,
      tipoQuantita: r.tipoQuantita,
      quantitaFissa: r.quantitaFissa === null ? null : r.quantitaFissa.toFixed(),
      unitaMisura: r.unitaMisura,
      prezzo: r.prezzo === null ? null : prezzoCalcolato(r.prezzo.toFixed()),
      prezzoSpeciale: r.prezzoSpeciale,
      sconto: r.sconto,
      codiceIva: rif(r.codiceIva) as RigaAddebitoVista['codiceIva'],
      provvigione: r.provvigione,
      tipoProvvigione: r.tipoProvvigione,
      tipologiaRifiuto: r.tipologiaRifiuto,
      statoFisico: r.statoFisico,
      operazione: r.operazione,
      categoria: rif(r.categoria),
      centroRicavo: rif(r.centroRicavo),
      applicaA: r.applicaA,
      scaglioni: r.scaglioni.map(s => ({
        ordine: s.ordine,
        finoA: s.finoA === null ? null : s.finoA.toFixed(),
        prezzo: prezzoCalcolato(s.prezzo.toFixed()),
        sconto: s.sconto,
        provvigione: s.provvigione,
        tipoCalcolo: s.tipoCalcolo as Scaglione['tipoCalcolo'],
      })),
      condizione: r.condizione,
      condizioniRiferite: r.condizioniRiferite,
      minimoFatturabile: r.minimoFatturabile === null ? null : r.minimoFatturabile.toFixed(2),
      minimoPerCategoria: r.minimoPerCategoria,
      riferimentoGiorno: r.riferimentoGiorno,
      riferimentoMese: r.riferimentoMese,
      periodoScadenze: r.periodoScadenze,
      periodoExtraDal: giorno(r.periodoExtraDal),
      periodoExtraAl: giorno(r.periodoExtraAl),
      scadenze: r.scadenze.map(s => {
        const scadenza: Scadenza = {
          ordine: s.ordine,
          giorno: s.giorno,
          mese: s.mese,
          anno: s.anno,
        }
        return {
          ...scadenza,
          fatturabileNelContratto:
            scadenzeNelPeriodo([scadenza], dal, al, { dataInizio: dal, dataFine: fine }).length > 0,
        }
      }),
      stimaAnnuaKg: r.stimaAnnuaKg === null ? null : r.stimaAnnuaKg.toFixed(2),
      cerProposta: r.cerProposta,
      addebitiProposti: r.addebitiProposti,
      appunti: r.appunti,
      notaUsoInterno: r.notaUsoInterno,
      versione: r.versione,
    }
  }

  /**
   * Audit nella stessa transazione (D25): id, numero del contratto, codici di elenco, addebito e
   * CER, tipo e nomi dei campi cambiati. Mai appunti, note, descrizioni o testi liberi.
   */
  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    action: string,
    esito: string,
    r: RigaDb,
    campi: string[]
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action,
        description: `Riga di addebito ${esito}`,
        metadata: {
          rigaId: r.id,
          elencoId: r.elencoId,
          codiceElenco: r.elenco.codice,
          contrattoId: r.elenco.contratto.id,
          numeroContratto: r.elenco.contratto.numero,
          tipo: r.tipo,
          cerCode: r.cerCode,
          codiceAddebito: r.addebito?.codice ?? null,
          riferimento: r.riferimento,
          ...(campi.length > 0 ? { campi } : {}),
        } as Prisma.InputJsonValue,
      },
    })
  }
}

interface ClienteListino {
  listino: number | null
  provvigionePredefinita: string | null
  tipoProvvigionePredefinita: TipoProvvigione | null
}

/** R23: la cascata del cliente deve essere valida prima di giudicarla positiva. */
function provvigioneDelCliente(cliente: ClienteListino | null): {
  provvigione: string | null
  tipo: TipoProvvigione | null
} {
  const p = normalizzaCascata(cliente?.provvigionePredefinita ?? null)
  return p !== null && cascataValida(p)
    ? { provvigione: p, tipo: cliente?.tipoProvvigionePredefinita ?? null }
    : { provvigione: null, tipo: null }
}

function proposteVuote(): PropostaRiga {
  return {
    descrizione: null,
    unitaMisura: null,
    codiceIva: null,
    tipo: null,
    categoria: null,
    centroRicavo: null,
    prezzo: null,
    sconto: null,
    provvigione: null,
    tipoProvvigione: null,
    tipologiaRifiuto: null,
  }
}
