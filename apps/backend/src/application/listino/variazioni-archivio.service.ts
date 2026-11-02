// Variazione dei prezzi dell'archivio addebiti (4.2a, D21, E22): anteprima e applicazione.
//
// L'anteprima calcola vecchio -> nuovo per (addebito, listino) senza scrivere. L'applicazione e'
// atomica (D20): una sola transazione che blocca gli addebiti e i loro prezzi `FOR NO KEY UPDATE` in
// ordine stabile, rilegge, ricalcola, confronta l'impronta dell'anteprima e solo allora scrive
// (`versione + 1` sugli addebiti toccati) con un unico audit. Qualunque errore dell'anteprima
// (prezzo negativo...) rifiuta tutta la variazione: niente applicazioni parziali.
//
// Non tocca i contratti: l'archivio propone, le righe degli elenchi hanno i loro prezzi.
// Regole di calcolo e impronta stanno nel dominio (`variazione-prezzi`); i riferimenti IVA sono
// letti da `riferimenti-listino`.
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { prezzoCalcolato } from '../../domain/listino/importi-riga'
import { tipoAddebitoValido } from '../../domain/listino/tipi-addebito'
import {
  TIPI_VARIAZIONE,
  improntaVariazione,
  nuovoPrezzo,
  validaValoreVariazione,
  type TipoVariazione,
} from '../../domain/listino/variazione-prezzi'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { MSG_VARIAZIONE_SUPERATA, traduciConflitto } from './conflitti-variazione'
import { controllaRiferimentiListino } from './riferimenti-listino'

export interface FiltroVariazioneArchivio {
  addebitiIds?: string[]
  categorieIds?: string[]
  tipi?: string[]
  listini?: number[]
}

export interface CorpoVariazione<F> {
  tipo: TipoVariazione
  valore?: string
  daCodiceIvaId?: string
  aCodiceIvaId?: string
  filtri: F
}

export interface AnteprimaVariazione {
  totale: number
  /** Una riga per (addebito, listino); nella sostituzione IVA una per addebito con `listino` 0. */
  righe: { id: string; descrizione: string; listino: number; prima: string; dopo: string }[]
  errori: { id: string; descrizione: string; messaggio: string }[]
  impronta: string
}

export interface EsitoVariazione {
  aggiornati: number
}

/** Tetto di righe per variazione (R12): oltre, si restringono i filtri. */
const MAX_RIGHE = 10_000
const MSG_TROPPE = 'La variazione tocca troppe righe: restringi i filtri.'
const MSG_SUPERATA = MSG_VARIAZIONE_SUPERATA
const TUTTI_I_LISTINI = [1, 2, 3, 4, 5, 6]
/** La variazione e' una sola transazione: piu' tempo del default di Prisma (5 s). */
const OPZIONI_TRANSAZIONE = { timeout: 30_000, maxWait: 5_000 } as const

interface Normalizzata {
  tipo: TipoVariazione
  valore: string
  da: string
  a: string
  addebitiIds: string[]
  categorieIds: string[]
  tipi: string[]
  listini: number[]
}

type AddebitoLetto = Prisma.AddebitoGetPayload<{
  select: {
    id: true
    descrizione: true
    versione: true
    codiceIvaId: true
    listini: { select: { id: true; numero: true; prezzo: true } }
  }
}>

interface Calcolo {
  righe: AnteprimaVariazione['righe']
  errori: AnteprimaVariazione['errori']
  /** Per l'applicazione: prezzi da scrivere (id riga prezzo -> nuovo prezzo). */
  prezzi: { id: string; prezzo: string }[]
  addebitiIds: string[]
  impronta: string
}

const nonValida = (messaggi: string[], error = 'VARIAZIONE_NON_VALIDA'): never => {
  throw new BadRequestException({ message: messaggi, error })
}

function normalizza(corpo: CorpoVariazione<FiltroVariazioneArchivio>): Normalizzata {
  const errori: string[] = []
  if (!(TIPI_VARIAZIONE as readonly string[]).includes(corpo.tipo)) {
    return nonValida(['Il tipo di variazione non è ammesso.'])
  }
  const f = corpo.filtri ?? {}
  const tipi = [...new Set((f.tipi ?? []).map(t => t.trim()))]
  if (tipi.some(t => !tipoAddebitoValido(t))) errori.push('Il tipo di addebito non è ammesso.')
  const listini = [...new Set(f.listini ?? [])].sort((x, y) => x - y)
  if (listini.some(l => !Number.isInteger(l) || l < 1 || l > 6)) {
    errori.push('I listini sono numerati da 1 a 6.')
  }

  let valore = ''
  let da = ''
  let a = ''
  if (corpo.tipo === 'SOSTITUZIONE_IVA') {
    da = (corpo.daCodiceIvaId ?? '').toLowerCase()
    a = (corpo.aCodiceIvaId ?? '').toLowerCase()
    if (da === '' || a === '') errori.push('Indica il codice IVA da sostituire e quello nuovo.')
    else if (da === a) errori.push('I due codici IVA devono essere diversi.')
  } else {
    valore = (corpo.valore ?? '').trim().replace(',', '.')
    if (valore === '') errori.push('Indica il valore della variazione.')
    else {
      const erroreValore = validaValoreVariazione(corpo.tipo, valore)
      if (erroreValore !== null) errori.push(erroreValore)
    }
  }
  if (errori.length > 0) nonValida(errori)

  const ordinati = (v: string[] | undefined) =>
    [...new Set(v ?? [])].map(x => x.toLowerCase()).sort()
  return {
    tipo: corpo.tipo,
    valore,
    da,
    a,
    addebitiIds: ordinati(f.addebitiIds),
    categorieIds: ordinati(f.categorieIds),
    tipi: tipi.sort(),
    listini: listini.length > 0 ? listini : TUTTI_I_LISTINI,
  }
}

@Injectable()
export class VariazioniArchivioService {
  constructor(private readonly prisma: PrismaService) {}

  async anteprima(
    tenantId: string,
    corpo: CorpoVariazione<FiltroVariazioneArchivio>
  ): Promise<AnteprimaVariazione> {
    const n = normalizza(corpo)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const codici = await this.codiciIva(tx, tenantId, n)
        const trovati = await this.trova(tx, tenantId, n)
        const { righe, errori, impronta } = this.calcola(trovati, n, codici)
        return { totale: righe.length, righe, errori, impronta }
      }, OPZIONI_TRANSAZIONE)
    )
  }

  async applica(
    tenantId: string,
    utenteId: string,
    corpo: CorpoVariazione<FiltroVariazioneArchivio> & { impronta: string }
  ): Promise<EsitoVariazione> {
    const n = normalizza(corpo)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          // Chi aspetta un lock piu' di 10 s rinuncia (55P03 -> 409), invece di tenere la transazione.
          await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`
          const codici = await this.codiciIva(tx, tenantId, n)

          // `FOR NO KEY UPDATE` (gli UPDATE non toccano colonne chiave): non confligge col FOR KEY SHARE
          // delle FK da `righe_addebito`. Blocco in ordine stabile (id degli addebiti, poi addebito e numero dei prezzi): due
          // applicazioni concorrenti non si incrociano. Chi arriva dopo aspetta il commit e poi
          // trova un'impronta diversa (409).
          const candidati = (await this.trova(tx, tenantId, n)).map(a => a.id).sort()
          if (candidati.length > 0) {
            await tx.$queryRaw`
            SELECT id::text AS id FROM addebiti
            WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${candidati}::uuid[])
            ORDER BY id FOR NO KEY UPDATE`
            await tx.$queryRaw`
            SELECT id::text AS id FROM prezzi_listino_addebito
            WHERE tenant_id = ${tenantId}::uuid AND addebito_id = ANY(${candidati}::uuid[])
            ORDER BY addebito_id, numero FOR NO KEY UPDATE`
          }

          // Rilettura dopo il blocco: e' questo lo stato che si confronta e si scrive.
          const calcolo = this.calcola(await this.trova(tx, tenantId, n), n, codici)
          if (calcolo.impronta !== corpo.impronta) {
            throw new ConflictException({ message: MSG_SUPERATA, error: 'VARIAZIONE_SUPERATA' })
          }
          if (calcolo.errori.length > 0) {
            nonValida(
              calcolo.errori.map(e => `${e.descrizione}: ${e.messaggio}`),
              'VARIAZIONE_CON_ERRORI'
            )
          }

          const aggiornati =
            n.tipo === 'SOSTITUZIONE_IVA' ? calcolo.addebitiIds.length : calcolo.prezzi.length
          if (calcolo.addebitiIds.length > 0) {
            if (n.tipo === 'SOSTITUZIONE_IVA') {
              await tx.$executeRaw`
              UPDATE addebiti SET codice_iva_id = ${n.a}::uuid, versione = versione + 1,
                updated_at = now()
              WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${calcolo.addebitiIds}::uuid[])`
            } else {
              const ids = calcolo.prezzi.map(p => p.id)
              const valori = calcolo.prezzi.map(p => p.prezzo)
              await tx.$executeRaw`
              UPDATE prezzi_listino_addebito p SET prezzo = v.prezzo
              FROM (SELECT unnest(${ids}::uuid[]) AS id, unnest(${valori}::numeric[]) AS prezzo) v
              WHERE p.tenant_id = ${tenantId}::uuid AND p.id = v.id`
              await tx.$executeRaw`
              UPDATE addebiti SET versione = versione + 1, updated_at = now()
              WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${calcolo.addebitiIds}::uuid[])`
            }
          }

          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'PREZZI_ARCHIVIO_VARIATI',
              description: 'Prezzi dell’archivio variati',
              // Solo parametri e conteggi (D25): niente descrizioni ne' dati liberi.
              metadata: {
                tipo: n.tipo,
                ...(n.tipo === 'SOSTITUZIONE_IVA'
                  ? { daCodiceIvaId: n.da, aCodiceIvaId: n.a }
                  : { valore: n.valore, listini: n.listini }),
                filtri: {
                  addebitiIds: n.addebitiIds,
                  categorieIds: n.categorieIds,
                  tipi: n.tipi,
                },
                addebiti: calcolo.addebitiIds.length,
                prezzi: n.tipo === 'SOSTITUZIONE_IVA' ? 0 : calcolo.prezzi.length,
              } as Prisma.InputJsonValue,
            },
          })
          return { aggiornati }
        }, OPZIONI_TRANSAZIONE)
        .catch(traduciConflitto)
    )
  }

  /** Sostituzione IVA: il codice nuovo deve essere attivo; ritorna i codici per l'anteprima. */
  private async codiciIva(
    tx: Prisma.TransactionClient,
    tenantId: string,
    n: Normalizzata
  ): Promise<Map<string, string>> {
    if (n.tipo !== 'SOSTITUZIONE_IVA') return new Map()
    const errori = await controllaRiferimentiListino(tx, tenantId, { codiceIvaId: n.a })
    if (errori.length > 0) nonValida(errori)
    const righe = await tx.codiceIva.findMany({
      where: { tenantId, id: { in: [n.da, n.a] } },
      select: { id: true, codice: true },
    })
    return new Map(righe.map(r => [r.id.toLowerCase(), r.codice]))
  }

  /** Addebiti che corrispondono ai filtri, in ordine di id; oltre il tetto → 400. */
  private async trova(
    tx: Prisma.TransactionClient,
    tenantId: string,
    n: Normalizzata
  ): Promise<AddebitoLetto[]> {
    const where: Prisma.AddebitoWhereInput = {
      tenantId,
      ...(n.addebitiIds.length > 0 ? { id: { in: n.addebitiIds } } : {}),
      ...(n.categorieIds.length > 0 ? { categoriaId: { in: n.categorieIds } } : {}),
      ...(n.tipi.length > 0 ? { tipo: { in: n.tipi } } : {}),
      ...(n.tipo === 'SOSTITUZIONE_IVA'
        ? { codiceIvaId: n.da }
        : { listini: { some: { numero: { in: n.listini }, prezzo: { gt: 0 } } } }),
    }
    const trovati = await tx.addebito.findMany({
      where,
      select: {
        id: true,
        descrizione: true,
        versione: true,
        codiceIvaId: true,
        listini: { select: { id: true, numero: true, prezzo: true }, orderBy: { numero: 'asc' } },
      },
      orderBy: { id: 'asc' },
      take: MAX_RIGHE + 1,
    })
    // Un addebito ha almeno una riga: piu' addebiti del tetto sono gia' troppe righe.
    if (trovati.length > MAX_RIGHE) nonValida([MSG_TROPPE], 'VARIAZIONE_TROPPE_RIGHE')
    return trovati
  }

  private calcola(trovati: AddebitoLetto[], n: Normalizzata, codici: Map<string, string>): Calcolo {
    const righe: Calcolo['righe'] = []
    const errori: Calcolo['errori'] = []
    const prezzi: Calcolo['prezzi'] = []

    for (const a of trovati) {
      if (n.tipo === 'SOSTITUZIONE_IVA') {
        righe.push({
          id: a.id,
          descrizione: a.descrizione,
          listino: 0,
          prima: codici.get(n.da) ?? '',
          dopo: codici.get(n.a) ?? '',
        })
        continue
      }
      for (const l of a.listini) {
        if (!n.listini.includes(l.numero) || l.prezzo === null || !l.prezzo.gt(0)) continue
        const prima = prezzoCalcolato(l.prezzo.toString())
        const esito = nuovoPrezzo(
          prima,
          n.tipo as Exclude<TipoVariazione, 'SOSTITUZIONE_IVA'>,
          n.valore
        )
        if ('errore' in esito) {
          errori.push({
            id: a.id,
            descrizione: a.descrizione,
            messaggio: `Listino ${l.numero}: ${esito.errore}`,
          })
          continue
        }
        righe.push({
          id: a.id,
          descrizione: a.descrizione,
          listino: l.numero,
          prima,
          dopo: esito.prezzo,
        })
        prezzi.push({ id: l.id, prezzo: esito.prezzo })
      }
    }
    if (righe.length + errori.length > MAX_RIGHE) nonValida([MSG_TROPPE], 'VARIAZIONE_TROPPE_RIGHE')

    // Impronta: (addebito, versione) deduplicati (R12) piu' i parametri della variazione, cosi' un
    // corpo diverso da quello dell'anteprima non puo' riusarne l'impronta.
    const parametri = JSON.stringify([
      n.tipo,
      n.valore,
      n.da,
      n.a,
      n.addebitiIds,
      n.categorieIds,
      n.tipi,
      n.listini,
    ])
    const impronta = improntaVariazione([
      ...trovati.map(a => ({ id: a.id, versione: a.versione })),
      { id: `parametri:${parametri}`, versione: 0 },
    ])
    return { righe, errori, prezzi, addebitiIds: trovati.map(a => a.id), impronta }
  }
}
