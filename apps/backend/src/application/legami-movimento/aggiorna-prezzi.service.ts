// «Aggiorna prezzi» dei legami movimento-cliente-prezzo (fase 4.3, Task 17; spec §7.4, decisioni
// 2 e 16): anteprima, poi applicazione con la firma dell'anteprima vista dall'utente.
//
// Solo i legami NON fatturati (`PROPOSTO`, `CONFERMATO`, `DA_COLLEGARE`) e solo le righe a prezzo
// singolo non manuali: i valori del listino (prezzo, sconto, IVA) si copiano e `congelata_il` si
// aggiorna. Si saltano `FATTURATO`, `IMPORTATO_FATTURATO`, `ESCLUSO`, `ANNULLATO`, le righe a
// prezzo speciale e quelle con `prezzo_manuale` (l'anteprima le elenca come «escluse, prezzo
// modificato a mano»). Se la riga di listino non e' piu' della stessa famiglia (tipo o CER
// cambiati) il legame passa a `DA_COLLEGARE` con `SENZA_RIGA_CER`; se il prezzo e' stato tolto,
// con `SENZA_PREZZO`. Una riga di listino usata da un legame non si elimina (FK `NoAction`): il
// caso «riga sparita» non esiste.
//
// L'applicazione e' UNA transazione, con l'ordine dei lock di spec §5 senza i passi che qui non
// servono (nessun lock del registro: non si scrive mai su `waste_movements`; nessun lock
// consultivo per radice: i legami si bloccano FOR UPDATE per id e ogni altra azione sul legame li
// prende dopo il proprio lock consultivo, quindi l'ordine fra le due resta lo stesso):
//
//   timeout dei lock -> lettura e controllo della firma -> contratto FOR SHARE -> elenchi FOR SHARE
//   -> righe di listino FOR SHARE -> testate e righe dei legami FOR UPDATE (per id) -> rilettura
//   -> scrittura set-based (una UPDATE per le righe, una per i testate) -> audit.
//
// Sotto lock si rilegge tutto. Un legame diventato fatturato, escluso o annullato nel frattempo
// (la 4.4 marca `FATTURATO` mentre noi aspettavamo) si salta senza errore; qualunque altra
// differenza rispetto all'anteprima (prezzo di listino cambiato durante l'attesa, una riga resa
// manuale, un legame entrato nel perimetro) e' 409 `ANTEPRIMA_SUPERATA` e non si scrive nulla:
// non si scrive un prezzo che l'utente non ha visto.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { AvvisoLegame, MotivoLegame, StatoLegame } from '../../domain/legami-movimento/codici'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../clienti/anagrafica-versionata'
import {
  impostaTimeoutLock,
  joinLineari,
  OPZIONI_TRANSAZIONE_SCRITTURA,
} from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  calcolaAggiornamento,
  type CalcoloAggiornamento,
  type LegameLetto,
  type RigaLegameLetta,
  type StatoSaltato,
} from './aggiorna-prezzi-calcolo'
import { bloccaListinoInCondivisione, bloccaRigheLegame } from './lock-legame'

export interface PerimetroAggiornamento {
  contrattoId?: string
  elencoId?: string
  /** `AAAA-MM-GG`, estremo incluso, sulla `data_movimento` del legame. */
  dal?: string
  al?: string
}

export type MotivoSaltoAggiornamento =
  | StatoSaltato
  | 'PREZZO_SPECIALE'
  | 'QUANTITA_MANUALE_NON_COINVOLTA'
  | 'PREZZO_MANUALE'

/** Una riga che cambia (nomi di `DifferenzaAggiornamento` di `legami.model.ts`). */
export interface DifferenzaAggiornamento {
  legameId: string
  movimentoId: string
  prezzoPrima: string | null
  prezzoDopo: string | null
  scontoPrima: string | null
  scontoDopo: string | null
}

export interface AnteprimaAggiornamento {
  /** Impronta del perimetro e dei dati che l'utente ha visto: va rimandata per applicare. */
  firma: string
  /** Legami che cambiano. */
  cambiano: number
  /** Legami non fatturati gia' allineati al listino. */
  invariati: number
  /** Le prime righe che cambiano (al massimo `MAX_DIFFERENZE`), in ordine di legame. */
  differenze: DifferenzaAggiornamento[]
  /** Solo i motivi con almeno un elemento: legami per stato, righe per prezzo speciale e manuale. */
  saltati: { motivo: MotivoSaltoAggiornamento; numero: number }[]
  /** Legami che dopo l'aggiornamento tornano `DA_COLLEGARE` (prima non lo erano). */
  daCollegare: number
  /** Righe con prezzo scritto a mano: «escluse, prezzo modificato a mano» (decisione 16). */
  righeEscluseManuali: number
}

export interface EsitoAggiornamento {
  /** Legami scritti. */
  aggiornati: number
  /** Legami saltati per stato piu' righe speciali e manuali (lo stesso totale di `saltati`). */
  saltati: number
  daCollegare: number
}

export const MAX_DIFFERENZE = 200
export const MSG_ANTEPRIMA_SUPERATA = 'I dati sono cambiati dopo l’anteprima: rifai l’anteprima.'

const ENTITA: DescrizioneEntita = {
  prefisso: 'LEGAMI_PREZZI',
  soggetto: 'Il legame',
  femminile: false,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function perimetroNonValido(message: string): BadRequestException {
  return new BadRequestException({ error: 'PERIMETRO_NON_VALIDO', message })
}

function superata(): ConflictException {
  return new ConflictException({ error: 'ANTEPRIMA_SUPERATA', message: MSG_ANTEPRIMA_SUPERATA })
}

/** Data `AAAA-MM-GG` esistente. */
function dataValida(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export interface PerimetroNorm {
  contrattoId: string | null
  elencoId: string | null
  dal: string | null
  al: string | null
}

export function normalizzaPerimetro(p: PerimetroAggiornamento): PerimetroNorm {
  const campo = (v: unknown): string | null =>
    v === undefined || v === null || v === '' ? null : String(v)
  const n: PerimetroNorm = {
    contrattoId: campo(p?.contrattoId),
    elencoId: campo(p?.elencoId),
    dal: campo(p?.dal),
    al: campo(p?.al),
  }
  if (n.contrattoId === null && n.elencoId === null) {
    throw perimetroNonValido('Indica un contratto o un elenco di addebiti.')
  }
  for (const id of [n.contrattoId, n.elencoId]) {
    if (id !== null && !UUID.test(id)) throw perimetroNonValido('Contratto o elenco non valido.')
  }
  for (const d of [n.dal, n.al]) {
    if (d !== null && !dataValida(d)) throw perimetroNonValido('Le date vanno scritte AAAA-MM-GG.')
  }
  if (n.dal !== null && n.al !== null && n.dal > n.al) {
    throw perimetroNonValido('La data iniziale e’ dopo quella finale.')
  }
  return n
}

interface RigaSql {
  legameId: string
  versione: number
  stato: StatoLegame
  movimentoId: string
  clienteId: string | null
  contrattoId: string | null
  elencoId: string | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  rigaId: string | null
  rigaAddebitoId: string | null
  tipo: string | null
  speciale: boolean | null
  manuale: boolean | null
  prezzo: string | null
  sconto: string | null
  quantita: string | null
  ivaId: string | null
  aliquota: string | null
  natura: string | null
  lstTipo: string | null
  lstSpeciale: boolean | null
  lstPrezzo: string | null
  lstSconto: string | null
  lstIvaId: string | null
  lstAliquota: string | null
  lstNatura: string | null
  cerCoerente: boolean | null
}

/**
 * Una sola query per tutto il perimetro (nessuna per legame): legami con le loro righe, i valori
 * correnti del listino e il CER del movimento vigente. Le righe si leggono solo dei legami non
 * fatturati. Tutti i join sono su chiavi primarie: nessun elenco di id da rimandare.
 */
async function leggiLegami(
  tx: Prisma.TransactionClient,
  tenantId: string,
  p: PerimetroNorm
): Promise<LegameLetto[]> {
  // Perimetri di migliaia di legami: con le statistiche vuote e il piano generico il planner
  // sceglierebbe un nested loop quadratico (stesso rimedio dei lock su liste grandi).
  await joinLineari(tx)
  const righe = await tx.$queryRaw<RigaSql[]>`
    SELECT l.id::text AS "legameId", l.versione AS versione, l.stato::text AS stato,
           l.movimento_vigente_id::text AS "movimentoId", l.cliente_id::text AS "clienteId",
           l.contratto_id::text AS "contrattoId", l.elenco_id::text AS "elencoId",
           l.motivi AS motivi, l.avvisi AS avvisi,
           r.id::text AS "rigaId", r.riga_addebito_id::text AS "rigaAddebitoId", r.tipo AS tipo,
           r.prezzo_speciale AS speciale, r.prezzo_manuale AS manuale, r.prezzo::text AS prezzo,
           r.sconto AS sconto, r.quantita::text AS quantita, r.codice_iva_id::text AS "ivaId",
           r.aliquota_iva::text AS aliquota, r.natura_iva AS natura,
           ra.tipo AS "lstTipo", ra.prezzo_speciale AS "lstSpeciale", ra.prezzo::text AS "lstPrezzo",
           ra.sconto AS "lstSconto", ra.codice_iva_id::text AS "lstIvaId",
           ci.aliquota::text AS "lstAliquota", ci.natura AS "lstNatura",
           (regexp_replace(COALESCE(m.cer_code, ''), '[^0-9]', '', 'g') = ''
            OR regexp_replace(COALESCE(ra.cer_code, ''), '[^0-9]', '', 'g')
               = regexp_replace(m.cer_code, '[^0-9]', '', 'g')) AS "cerCoerente"
    FROM legami_movimento l
    LEFT JOIN righe_legame_movimento r
      ON r.legame_id = l.id AND r.tenant_id = l.tenant_id
         AND l.stato IN ('PROPOSTO', 'CONFERMATO', 'DA_COLLEGARE')
    LEFT JOIN righe_addebito ra ON ra.id = r.riga_addebito_id AND ra.tenant_id = r.tenant_id
    LEFT JOIN codici_iva ci ON ci.id = ra.codice_iva_id AND ci.tenant_id = ra.tenant_id
    LEFT JOIN waste_movements m ON m.id = l.movimento_vigente_id AND m.tenant_id = l.tenant_id
    WHERE l.tenant_id = ${tenantId}::uuid
      AND (${p.contrattoId}::uuid IS NULL OR l.contratto_id = ${p.contrattoId}::uuid)
      AND (${p.elencoId}::uuid IS NULL OR l.elenco_id = ${p.elencoId}::uuid)
      AND (${p.dal}::date IS NULL OR l.data_movimento >= ${p.dal}::date)
      AND (${p.al}::date IS NULL OR l.data_movimento <= ${p.al}::date)
    ORDER BY l.id, r.ordine, r.id`
  const perId = new Map<string, LegameLetto>()
  for (const x of righe) {
    let l = perId.get(x.legameId)
    if (!l) {
      l = {
        id: x.legameId,
        versione: x.versione,
        stato: x.stato,
        movimentoVigenteId: x.movimentoId,
        clienteId: x.clienteId,
        contrattoId: x.contrattoId,
        elencoId: x.elencoId,
        motivi: x.motivi,
        avvisi: x.avvisi,
        righe: [],
      }
      perId.set(x.legameId, l)
    }
    if (x.rigaId === null) continue
    const riga: RigaLegameLetta = {
      id: x.rigaId,
      rigaAddebitoId: x.rigaAddebitoId!,
      tipo: x.tipo!,
      prezzoSpeciale: x.speciale!,
      prezzoManuale: x.manuale!,
      prezzo: x.prezzo,
      sconto: x.sconto,
      quantita: x.quantita,
      codiceIvaId: x.ivaId!,
      aliquotaIva: x.aliquota!,
      naturaIva: x.natura,
      listino:
        x.lstTipo === null
          ? null
          : {
              tipo: x.lstTipo,
              prezzoSpeciale: x.lstSpeciale!,
              prezzo: x.lstPrezzo,
              sconto: x.lstSconto,
              codiceIvaId: x.lstIvaId!,
              aliquota: x.lstAliquota,
              natura: x.lstNatura,
              cerCoerente: x.cerCoerente === true,
            },
    }
    l.righe.push(riga)
  }
  return [...perId.values()]
}

/** Contratto del perimetro (anche dedotto dall'elenco): esiste, non e' eliminato e non e' annullato. */
async function risolviContratto(
  tx: Prisma.TransactionClient,
  tenantId: string,
  p: PerimetroNorm
): Promise<string> {
  if (p.elencoId !== null) {
    const e = await tx.$queryRaw<{ contrattoId: string }[]>`
      SELECT e.contratto_id::text AS "contrattoId" FROM elenchi_addebiti e
      JOIN contratti_cliente c ON c.id = e.contratto_id AND c.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${tenantId}::uuid AND e.id = ${p.elencoId}::uuid
        AND c.eliminato_il IS NULL
        AND (${p.contrattoId}::uuid IS NULL OR e.contratto_id = ${p.contrattoId}::uuid)`
    if (e.length === 0) {
      throw new NotFoundException({
        error: 'ELENCO_ADDEBITI_NON_TROVATO',
        message: 'Elenco di addebiti non trovato.',
      })
    }
    return e[0].contrattoId
  }
  return p.contrattoId!
}

function riepilogoSaltati(
  c: CalcoloAggiornamento
): { motivo: MotivoSaltoAggiornamento; numero: number }[] {
  const voci: { motivo: MotivoSaltoAggiornamento; numero: number }[] = [
    { motivo: 'FATTURATO', numero: c.legamiSaltati.FATTURATO },
    { motivo: 'IMPORTATO_FATTURATO', numero: c.legamiSaltati.IMPORTATO_FATTURATO },
    { motivo: 'ESCLUSO', numero: c.legamiSaltati.ESCLUSO },
    { motivo: 'ANNULLATO', numero: c.legamiSaltati.ANNULLATO },
    { motivo: 'PREZZO_SPECIALE', numero: c.righeSpeciali },
    { motivo: 'PREZZO_MANUALE', numero: c.righeManuali },
  ]
  return voci.filter(v => v.numero > 0)
}

function chiave(p: PerimetroNorm): string {
  return JSON.stringify([p.contrattoId, p.elencoId, p.dal, p.al])
}

@Injectable()
export class AggiornaPrezziService {
  constructor(private readonly prisma: PrismaService) {}

  /** Calcola che cosa cambierebbe, senza scrivere ne' bloccare. */
  anteprima(tenantId: string, perimetro: PerimetroAggiornamento): Promise<AnteprimaAggiornamento> {
    const p = normalizzaPerimetro(perimetro)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const contrattoId = await risolviContratto(tx, tenantId, p)
        await verificaContratto(tx, tenantId, contrattoId)
        const c = calcolaAggiornamento(await leggiLegami(tx, tenantId, p), chiave(p))
        const saltati = riepilogoSaltati(c)
        return {
          firma: c.firma,
          cambiano: c.daScrivere.length,
          invariati: c.invariati,
          differenze: c.daScrivere
            .flatMap(l => l.righe)
            .filter(r => r.prezzoPrima !== r.prezzoDopo || r.scontoPrima !== r.scontoDopo)
            .slice(0, MAX_DIFFERENZE)
            .map(r => ({
              legameId: r.legameId,
              movimentoId: r.movimentoId,
              prezzoPrima: r.prezzoPrima,
              prezzoDopo: r.prezzoDopo,
              scontoPrima: r.scontoPrima,
              scontoDopo: r.scontoDopo,
            })),
          saltati,
          daCollegare: c.daCollegare,
          righeEscluseManuali: c.righeManuali,
        }
      })
    )
  }

  /**
   * Applica l'aggiornamento mostrato dall'anteprima con quella `firma`. 409 `ANTEPRIMA_SUPERATA` se
   * nel frattempo e' cambiato qualcosa che l'utente non ha visto; nulla viene scritto.
   */
  applica(
    tenantId: string,
    utenteId: string,
    perimetro: PerimetroAggiornamento,
    firma: string
  ): Promise<EsitoAggiornamento> {
    const p = normalizzaPerimetro(perimetro)
    if (typeof firma !== 'string' || firma === '') {
      throw new BadRequestException({
        error: 'FIRMA_MANCANTE',
        message: 'Manca la firma dell’anteprima.',
      })
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const contrattoId = await risolviContratto(tx, tenantId, p)
          await verificaContratto(tx, tenantId, contrattoId)
          const lettiPrima = await leggiLegami(tx, tenantId, p)
          const prima = calcolaAggiornamento(lettiPrima, chiave(p))
          if (prima.firma !== firma) throw superata()

          // Lock nell'ordine di spec §5: contratto, elenchi, righe di listino (FOR SHARE), poi
          // testate e righe dei legami che potremmo scrivere (FOR UPDATE, per id).
          const scrivibili = lettiPrima.filter(l => prima.scrivibili.has(l.id))
          await bloccaListinoInCondivisione(
            tx,
            tenantId,
            contrattoId,
            [...new Set(scrivibili.map(l => l.elencoId).filter((x): x is string => x !== null))],
            [...new Set(scrivibili.flatMap(l => l.righe.map(r => r.rigaAddebitoId)))]
          )
          await bloccaRigheLegame(
            tx,
            tenantId,
            scrivibili.map(l => l.id)
          )

          // Rilettura sotto lock: e' questo lo stato che si confronta e si scrive.
          const sotto = calcolaAggiornamento(await leggiLegami(tx, tenantId, p), chiave(p))
          for (const id of sotto.scrivibili.keys()) {
            if (!prima.scrivibili.has(id)) throw superata()
          }
          for (const [id, digest] of sotto.scrivibili) {
            if (prima.scrivibili.get(id) !== digest) throw superata()
          }
          // Legami usciti dall'insieme scrivibile mentre aspettavamo (fatturati, esclusi...): si
          // saltano. Si contano fra i saltati con lo stato che hanno adesso.
          const usciti = [...prima.scrivibili.keys()].filter(id => !sotto.scrivibili.has(id)).length

          await this.scrivi(tx, tenantId, sotto)

          const saltati = riepilogoSaltati(sotto).reduce((n, v) => n + v.numero, 0)
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'LEGAMI_PREZZI_AGGIORNATI',
              description: 'Prezzi dei legami movimento aggiornati dal listino',
              // Solo parametri e conteggi: niente ragioni sociali, note o descrizioni libere.
              metadata: {
                contrattoId: p.contrattoId,
                elencoId: p.elencoId,
                dal: p.dal,
                al: p.al,
                firma,
                aggiornati: sotto.daScrivere.length,
                righeAggiornate: sotto.daScrivere.reduce((n, l) => n + l.righe.length, 0),
                daCollegare: sotto.daCollegare,
                invariati: sotto.invariati,
                saltati: Object.fromEntries(riepilogoSaltati(sotto).map(v => [v.motivo, v.numero])),
                usciti,
              } as Prisma.InputJsonValue,
            },
          })
          return {
            aggiornati: sotto.daScrivere.length,
            saltati,
            daCollegare: sotto.daCollegare,
          }
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => {
          if (err instanceof ConflictException) throw err
          return traduciErrorePrisma(err, ENTITA, {})
        })
    )
  }

  /** Una UPDATE per le righe e una per le testate, qualunque sia il numero di legami. */
  private async scrivi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    c: CalcoloAggiornamento
  ): Promise<void> {
    if (c.daScrivere.length === 0) return
    await joinLineari(tx)
    const righe = c.daScrivere.flatMap(l => l.righe)
    if (righe.length > 0) {
      const n = await tx.$executeRaw`
        UPDATE righe_legame_movimento r
        SET prezzo = NULLIF(v.prezzo, '')::numeric, sconto = NULLIF(v.sconto, ''),
            codice_iva_id = v.iva::uuid, aliquota_iva = v.aliquota::numeric,
            natura_iva = NULLIF(v.natura, ''), congelata_il = now(), updated_at = now()
        FROM (SELECT unnest(${righe.map(r => r.rigaId)}::uuid[]) AS id,
                     unnest(${righe.map(r => r.prezzoDopo ?? '')}::text[]) AS prezzo,
                     unnest(${righe.map(r => r.scontoDopo ?? '')}::text[]) AS sconto,
                     unnest(${righe.map(r => r.codiceIvaId)}::text[]) AS iva,
                     unnest(${righe.map(r => r.aliquotaIva)}::text[]) AS aliquota,
                     unnest(${righe.map(r => r.naturaIva ?? '')}::text[]) AS natura) v
        WHERE r.tenant_id = ${tenantId}::uuid AND r.id = v.id
          AND NOT r.prezzo_manuale AND NOT r.prezzo_speciale`
      if (n !== righe.length) throw superata()
    }
    const l = c.daScrivere
    const n = await tx.$executeRaw`
      UPDATE legami_movimento t
      SET stato = v.stato::stato_legame_movimento,
          motivi = COALESCE(string_to_array(NULLIF(v.motivi, ''), ','), '{}'::text[]),
          avvisi = COALESCE(string_to_array(NULLIF(v.avvisi, ''), ','), '{}'::text[]),
          confermato_il = CASE WHEN v.stato = 'CONFERMATO' THEN t.confermato_il ELSE NULL END,
          confermato_da = CASE WHEN v.stato = 'CONFERMATO' THEN t.confermato_da ELSE NULL END,
          versione = t.versione + 1, updated_at = now()
      FROM (SELECT unnest(${l.map(x => x.legameId)}::uuid[]) AS id,
                   unnest(${l.map(x => x.stato)}::text[]) AS stato,
                   unnest(${l.map(x => x.motivi.join(','))}::text[]) AS motivi,
                   unnest(${l.map(x => x.avvisi.join(','))}::text[]) AS avvisi) v
      WHERE t.tenant_id = ${tenantId}::uuid AND t.id = v.id
        AND t.stato IN ('PROPOSTO', 'CONFERMATO', 'DA_COLLEGARE')`
    if (n !== l.length) throw superata()
  }
}

/** Il contratto esiste, non e' eliminato e non e' annullato (stessi errori del listino). */
async function verificaContratto(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contrattoId: string
): Promise<void> {
  const r = await tx.$queryRaw<{ stato: string }[]>`
    SELECT stato::text AS stato FROM contratti_cliente
    WHERE tenant_id = ${tenantId}::uuid AND id = ${contrattoId}::uuid AND eliminato_il IS NULL`
  if (r.length === 0) {
    throw new NotFoundException({
      error: 'CONTRATTO_CLIENTE_NON_TROVATO',
      message: 'Contratto non trovato.',
    })
  }
  if (r[0].stato === 'ANNULLATO') {
    throw new ConflictException({
      error: 'LISTINO_NON_MODIFICABILE',
      message: 'Il listino di un contratto annullato non si modifica.',
    })
  }
}
