// Conferma, modifica, esclusione e riammissione del legame movimento-cliente-prezzo (fase 4.3,
// spec §7.2, §4.4; decisioni 13, 16, 17). Ogni azione e' UNA transazione, con l'ordine dei lock
// di spec §5 (mai invertito):
//
//   timeout dei lock -> lock consultivo della radice (`bloccaLegamePerRadice`) -> rilettura della
//   testata e controllo di `versione` e stato -> contratto, elenchi e righe di listino FOR SHARE
//   (`calcolaEBloccaInTx`) -> testata e righe del legame FOR UPDATE (`bloccaRigheLegame`) ->
//   nuovo controllo di `versione` -> scrittura -> audit.
//
// Il lock del registro non c'e': queste azioni non scrivono mai sul registro (`waste_movements`
// si legge soltanto, guardia del Task 14). La riga di `impostazioni_fatturazione` non si blocca:
// un legame che esiste gia' non dipende piu' da «fatturazione da».
//
// Il ricalcolo (cliente, contratto, elenco, righe, quantita', valori di listino) lo fa
// `PropostaLegameService.calcolaEBloccaInTx` sul movimento VIGENTE del legame; qui si decide cosa
// tenere di quello che c'e' gia' (prezzi scritti a mano, quantita' MANUALI, valori congelati) e si
// scrive. I conflitti di versione sono 409 `VERSIONE_SUPERATA`; i dati cambiati fra la proposta e
// la conferma sono 409 `LEGAME_INCOMPLETO` con `details.motivi` (e `details.dettaglioCliente`).
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  eStatoFatturato,
  MOTIVI_LEGAME,
  sonoAvvisiValidi,
  sonoMotiviValidi,
  validaMotivoEsclusione,
  type AvvisoLegame,
  type MotivoLegame,
  type StatoLegame,
} from '../../domain/legami-movimento/codici'
import { quantitaPerRiga } from '../../domain/legami-movimento/proposta-righe'
import type { TipoQuantita } from '../../domain/listino/riga-addebito'
import {
  esitoCorrezione,
  statoDopoRicalcolo,
  transizioneEscludi,
} from '../../domain/legami-movimento/stato-legame'
import { avvisiDaRighe, motiviRighe } from '../../domain/legami-movimento/valori-legame'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  MSG_OPERAZIONE_CONCORRENTE,
  traduciErrorePrisma,
  type DescrizioneEntita,
} from '../clienti/anagrafica-versionata'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  applicaModificheRighe,
  eUuid,
  fondiRighe,
  normalizzaDec,
  righaDaProposta,
  validaModifiche,
  type CambioRiga,
  type ModificheLegame,
  type ModificheNorm,
  type RigaMem,
} from './conferma-legame-righe'
import { leggiFatturazioneDaInTx } from './impostazioni-fatturazione.service'
import { eViolazioneFk } from './legame-scrittura'
import {
  clienteDaFir,
  leggiCliente,
  leggiEtichetteListino,
  leggiMovimentoPerLegame,
  leggiRadiceDelMovimento,
  leggiStatoContratto,
  leggiTestaCatena,
  leggiValiditaElenco,
  type MovimentoPerLegame,
  type TestaCatena,
} from './letture-legame'
import { bloccaLegamePerRadice, bloccaRigheLegame } from './lock-legame'
import {
  importoVista,
  PropostaLegameService,
  type InputProposta,
  type PropostaVista,
  type ScelteProposta,
} from './proposta-legame.service'

export type { ModificaRigaLegame, ModificheLegame } from './conferma-legame-righe'

/** Riga del legame come la vede il client (nomi di `RigaLegame` di `legami.model.ts`). */
export interface RigaLegameVista {
  id: string
  rigaAddebitoId: string
  ordine: number
  origine: 'PRINCIPALE' | 'PROPOSTA' | 'MANUALE'
  tipo: string
  descrizione: string | null
  tipoQuantita: string | null
  unitaMisura: string
  quantita: string | null
  quantitaOrigine: 'DA_MOVIMENTO' | 'MANUALE' | null
  prezzoSpeciale: boolean
  prezzo: string | null
  sconto: string | null
  prezzoManuale: boolean
  codiceIvaId: string
  aliquotaIva: string
  naturaIva: string | null
  congelataIl: string | null
  /** Importo netto calcolato con `importoRiga`; `null` se non calcolabile. */
  importo: string | null
}

interface VoceVista {
  id: string
  etichetta: string
}

/** Come `LegameVista` di `legami.model.ts` (senza `candidati`, che sta nella proposta). */
export interface LegameVista {
  id: string
  movimentoOriginaleId: string
  movimentoVigenteId: string
  stato: StatoLegame
  dataMovimento: string
  cliente: (VoceVista & { fonte: 'FIR' | 'UTENTE' | null }) | null
  dettaglioCliente: string | null
  contratto: VoceVista | null
  elenco: VoceVista | null
  righe: RigaLegameVista[]
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  motivoEsclusione: string | null
  confermatoIl: string | null
  fatturatoIl: string | null
  riferimentoFattura: string | null
  scostamentoDopoFattura: boolean
  scostamentoIl: string | null
  versione: number
}

/** `LegameVista` piu' i candidati per le scelte (solo nel dettaglio dell'API). */
export type LegameVistaDettaglio = LegameVista & { candidati?: PropostaVista['candidati'] }

interface Testata {
  id: string
  movimentoOriginaleId: string
  movimentoVigenteId: string
  stato: StatoLegame
  dataMovimento: string
  clienteId: string | null
  fonteCliente: 'FIR' | 'UTENTE' | null
  contrattoId: string | null
  elencoId: string | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  motivoEsclusione: string | null
  confermatoIl: Date | null
  confermatoDa: string | null
  fatturatoIl: Date | null
  riferimentoFattura: string | null
  scostamentoDopoFattura: boolean
  scostamentoIl: Date | null
  versione: number
}

type RigaLetta = RigaMem & { congelataIl: Date | null }

type ModoConferma = 'mantieni' | 'ora' | 'azzera'

/** Cio' che si scrive (testata e righe finali) piu' quello che serve all'audit. */
interface Esito {
  stato: StatoLegame
  clienteId: string | null
  fonteCliente: 'FIR' | 'UTENTE' | null
  contrattoId: string | null
  elencoId: string | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  motivoEsclusione: string | null
  conferma: ModoConferma
  /** Righe finali; vuote = non si toccano (esclusione). */
  righe: RigaMem[]
  /** Cancella tutte le righe e riscrivile (cambio di elenco, riammissione). */
  sostituisciRighe: boolean
  /** Le righe senza valori congelati si congelano ora. */
  congela: boolean
  dettaglioCliente: string | null
  cambi: CambioRiga[]
  righeAggiunte: string[]
  righeRimosse: string[]
  /** Prezzi scritti a mano che il ricalcolo ha buttato via (cambio di elenco/contratto/cliente). */
  prezziManualiPersi?: { rigaAddebitoId: string; prezzo: string | null; sconto: string | null }[]
  /** Riallineamento alla testa della catena (`allineaAlVigente`): nuovo movimento vigente. */
  vigenteId?: string
  /** Idem: nuovo giorno del movimento (`AAAA-MM-GG`); assente = la data del legame non cambia. */
  dataMovimento?: string
  /** Idem: legame gia' fatturato, registra solo lo scostamento. */
  scostamento?: boolean
}

type DatiEsito = Omit<
  Esito,
  'stato' | 'avvisi' | 'motivoEsclusione' | 'conferma' | 'congela' | 'motivi'
> & { motivi: MotivoLegame[]; avvisi: readonly AvvisoLegame[]; strutturaCambiata: boolean }

const ENTITA: DescrizioneEntita = {
  prefisso: 'LEGAME_MOVIMENTO',
  soggetto: 'Il legame',
  femminile: false,
}

/** Il legame esiste gia': «fatturazione da» non lo riguarda piu', qualunque sia il giorno. */
const FATTURAZIONE_SEMPRE = '0001-01-01'

const AVVISI_DEL_RICALCOLO: readonly AvvisoLegame[] = ['CLIENTE_NON_DA_FIR', 'CONTRATTO_ALTRA_SEDE']
const MOTIVI_DELLE_RIGHE: readonly MotivoLegame[] = ['SENZA_PREZZO', 'SENZA_QUANTITA']

/** Stati in cui il legame si puo' ancora cambiare (i fatturati, gli annullati e gli esclusi no). */
const STATI_MODIFICABILI: readonly StatoLegame[] = ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO']

const versioneSuperata = () =>
  new ConflictException({
    error: 'VERSIONE_SUPERATA',
    message: 'Il legame è stato modificato nel frattempo: ricarica per vedere i dati aggiornati.',
  })

const nonTrovato = () =>
  new NotFoundException({ error: 'LEGAME_MOVIMENTO_NON_TROVATO', message: 'Legame non trovato.' })

const statoNonAmmesso = () =>
  new ConflictException({
    error: 'STATO_LEGAME_NON_AMMESSO',
    message: 'Nello stato attuale il legame non si può modificare.',
  })

const daRiallineare = () =>
  new ConflictException({
    error: 'LEGAME_DA_RIALLINEARE',
    message: 'Il movimento è stato corretto: apri la riga per aggiornarla prima di procedere.',
  })

const concorrente = () =>
  new ConflictException({ error: 'OPERAZIONE_CONCORRENTE', message: MSG_OPERAZIONE_CONCORRENTE })

const causaleNonFatturabile = () =>
  new ConflictException({
    error: 'CAUSALE_NON_FATTURABILE',
    message: 'La causale del movimento non è fatturabile.',
  })

function incompleto(motivi: readonly MotivoLegame[], dettaglioCliente: string | null) {
  return new ConflictException({
    error: 'LEGAME_INCOMPLETO',
    message: 'Il legame non è completo: correggi quanto indicato e riprova.',
    details: { motivi: [...motivi], ...(dettaglioCliente ? { dettaglioCliente } : {}) },
  })
}

const ordinaMotivi = (m: Iterable<MotivoLegame>): MotivoLegame[] => {
  const insieme = new Set(m)
  return MOTIVI_LEGAME.filter(x => insieme.has(x))
}

export function inputDaMovimento(mov: MovimentoPerLegame): InputProposta {
  return {
    causale: mov.causale,
    causaleAziendaId: mov.causaleAziendaId,
    type: mov.type,
    cerCode: mov.cerCode,
    movementDate: mov.giorno,
    unit: mov.unit,
    quantity: new Prisma.Decimal(mov.quantity).toFixed(),
    firId: mov.firId,
  }
}

@Injectable()
export class LegamiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposta: PropostaLegameService
  ) {}

  /**
   * Cambia cliente, contratto, elenco, righe, quantita', prezzo e sconto. Il legame resta (o
   * torna) PROPOSTO o DA_COLLEGARE; un CONFERMATO di cui cambia solo un valore resta CONFERMATO.
   */
  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    versione: number,
    m: ModificheLegame
  ): Promise<LegameVista> {
    const mods = validaModifiche(m)
    return this.inTransazione(tenantId, id, versione, async (tx, l) => {
      if (!STATI_MODIFICABILI.includes(l.stato)) throw statoNonAmmesso()
      const righe = await leggiRighe(tx, tenantId, l.id)
      const e = await this.ricalcola(tx, tenantId, l, righe, mods, false)
      return this.scrivi(tx, tenantId, utenteId, l, e, righe, {
        azione: 'LEGAME_MOVIMENTO_MODIFICATO',
        descrizione: 'Legame movimento modificato',
        bloccato: false,
      })
    })
  }

  /**
   * Conferma: ricontrolla i dati sulla data del movimento, ricalcola quantita' non manuali e
   * valori di listino, congela. Accetta le stesse modifiche di `modifica`. Se manca qualcosa:
   * 409 `LEGAME_INCOMPLETO`, nulla scritto. Su un legame gia' CONFERMATO, senza modifiche: 200
   * senza cambiare nulla.
   */
  async conferma(
    tenantId: string,
    utenteId: string,
    id: string,
    versione: number,
    m?: ModificheLegame
  ): Promise<LegameVista> {
    const mods = validaModifiche(m)
    const senzaModifiche =
      mods.clienteId === undefined &&
      mods.contrattoId === undefined &&
      mods.elencoId === undefined &&
      mods.righe.size === 0
    return this.inTransazione(tenantId, id, versione, async (tx, l) => {
      if (!STATI_MODIFICABILI.includes(l.stato)) throw statoNonAmmesso()
      if (l.stato === 'CONFERMATO' && senzaModifiche) {
        return costruisciVista(tx, tenantId, l.id, null)
      }
      const righe = await leggiRighe(tx, tenantId, l.id)
      const e = await this.ricalcola(tx, tenantId, l, righe, mods, true)
      return this.scrivi(tx, tenantId, utenteId, l, e, righe, {
        azione: 'LEGAME_MOVIMENTO_CONFERMATO',
        descrizione: 'Legame movimento confermato',
        bloccato: false,
      })
    })
  }

  /** Esclude il legame dalla fatturazione, con un motivo scritto dall'utente (reversibile con `riammetti`). */
  async escludi(
    tenantId: string,
    utenteId: string,
    id: string,
    versione: number,
    motivo: string
  ): Promise<LegameVista> {
    const m = validaMotivoEsclusione(motivo)
    if (!m.ok) {
      throw new BadRequestException({ error: 'MOTIVO_ESCLUSIONE_NON_VALIDO', message: m.errore })
    }
    return this.inTransazione(tenantId, id, versione, async (tx, l) => {
      if (transizioneEscludi(l.stato) === null) throw statoNonAmmesso()
      await bloccaRigheLegame(tx, tenantId, [l.id])
      await controllaVersione(tx, tenantId, l)
      const righe = await leggiRighe(tx, tenantId, l.id)
      const e: Esito = {
        stato: 'ESCLUSO',
        clienteId: l.clienteId,
        fonteCliente: l.fonteCliente,
        contrattoId: l.contrattoId,
        elencoId: l.elencoId,
        motivi: l.motivi,
        avvisi: l.avvisi,
        motivoEsclusione: m.valore,
        conferma: 'azzera',
        righe: [],
        sostituisciRighe: false,
        congela: false,
        dettaglioCliente: null,
        cambi: [],
        righeAggiunte: [],
        righeRimosse: [],
      }
      return this.scrivi(tx, tenantId, utenteId, l, e, righe, {
        azione: 'LEGAME_MOVIMENTO_ESCLUSO',
        descrizione: 'Legame movimento escluso',
        bloccato: true,
      })
    })
  }

  /**
   * Riammette un legame ESCLUSO: motivo azzerato e proposta rifatta da zero sul movimento
   * vigente (resta il cliente scelto dall'utente, se ancora attivo). Lo stato e' quello della
   * proposta: DA_COLLEGARE se manca qualcosa, PROPOSTO se e' completa.
   */
  async riammetti(
    tenantId: string,
    utenteId: string,
    id: string,
    versione: number
  ): Promise<LegameVista> {
    return this.inTransazione(tenantId, id, versione, async (tx, l) => {
      if (l.stato !== 'ESCLUSO') throw statoNonAmmesso()
      const righePrima = await leggiRighe(tx, tenantId, l.id)
      const mov = await leggiMovimentoPerLegame(tx, tenantId, l.movimentoVigenteId)
      if (!mov) throw new Error('Legame: movimento vigente non trovato')
      let scelte: ScelteProposta = {}
      if (l.fonteCliente === 'UTENTE' && l.clienteId) {
        const c = await leggiCliente(tx, tenantId, l.clienteId)
        if (c?.attivo) scelte = { clienteId: c.id }
      }
      // Qui «fatturazione da» conta (decisione 11): riammettere non fa entrare in fatturazione un
      // movimento precedente alla data. Riga delle impostazioni FOR SHARE, come `proponiEScrivi`.
      const fatturazioneDa = await leggiFatturazioneDaInTx(tx, tenantId, { condividi: true })
      const p = await this.proposta.calcolaEBloccaInTx(
        tx,
        tenantId,
        inputDaMovimento(mov),
        scelte,
        {
          fatturazioneDa,
        }
      )
      if (!p.fatturabile) throw causaleNonFatturabile()
      if (!p.attiva) {
        throw new ConflictException({
          error: 'MOVIMENTO_FUORI_FATTURAZIONE',
          message:
            'Il movimento è precedente alla data di «fatturazione da» (o la fatturazione è spenta): non si può riammettere.',
        })
      }
      await bloccaRigheLegame(tx, tenantId, [l.id])
      await controllaVersione(tx, tenantId, l)
      const righe = p.righe.map(righaDaProposta)
      const completo = !!p.cliente && !!p.contratto && !!p.elenco && righe.length > 0
      const motivi = ordinaMotivi(p.motivi)
      const e: Esito = {
        stato: statoDopoRicalcolo('DA_COLLEGARE', { motivi, completo }) as StatoLegame,
        clienteId: p.cliente?.id ?? null,
        fonteCliente: p.cliente?.fonte ?? null,
        contrattoId: p.contratto?.id ?? null,
        elencoId: p.elenco?.id ?? null,
        motivi,
        avvisi: avvisiDaRighe(p.avvisi, righe),
        motivoEsclusione: null,
        conferma: 'azzera',
        righe,
        sostituisciRighe: true,
        congela: false,
        dettaglioCliente: p.dettaglioCliente,
        cambi: [],
        righeAggiunte: [],
        righeRimosse: [],
      }
      return this.scrivi(tx, tenantId, utenteId, l, e, righePrima, {
        azione: 'LEGAME_MOVIMENTO_RIAMMESSO',
        descrizione: 'Legame movimento riammesso',
        bloccato: true,
      })
    })
  }

  /**
   * Dettaglio per l'API (`GET :id`): la vista del legame piu' i `candidati` per le scelte (dialog
   * della pagina «Da collegare») e, se manca il cliente e quello del FIR e' disattivato, il
   * dettaglio «cliente disattivato» (decisione 19). Sola lettura. 404 se non c'e' o e' di un'altra
   * azienda.
   */
  async dettaglio(tenantId: string, id: string): Promise<LegameVistaDettaglio> {
    if (!eUuid(id)) throw nonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx => this.vistaCompletaInTx(tx, tenantId, id))
    )
  }

  /**
   * Legame della catena a cui appartiene il movimento (uno qualunque della catena). 404
   * `LEGAME_MOVIMENTO_NON_TROVATO` se la catena non ha un legame o il movimento non e' dell'azienda.
   */
  async perMovimento(tenantId: string, movimentoId: string): Promise<LegameVistaDettaglio> {
    if (!eUuid(movimentoId)) throw nonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const radice = await leggiRadiceDelMovimento(tx, tenantId, movimentoId)
        if (!radice) throw nonTrovato()
        const l = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM legami_movimento
          WHERE tenant_id = ${tenantId}::uuid AND movimento_originale_id = ${radice}::uuid`
        if (l.length === 0) throw nonTrovato()
        return this.vistaCompletaInTx(tx, tenantId, l[0].id)
      })
    )
  }

  private async vistaCompletaInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<LegameVistaDettaglio> {
    const v: LegameVistaDettaglio = await costruisciVista(tx, tenantId, id, null)
    if (!STATI_MODIFICABILI.includes(v.stato) && v.stato !== 'ESCLUSO') return v
    const mov = await leggiMovimentoPerLegame(tx, tenantId, v.movimentoVigenteId)
    if (!mov) return v
    if (v.cliente === null && v.dettaglioCliente === null && mov.firId) {
      const fir = await clienteDaFir(tx, tenantId, mov.firId)
      if (fir.cliente && !fir.cliente.attivo) v.dettaglioCliente = 'cliente disattivato'
    }
    if (v.stato === 'ESCLUSO') return v
    try {
      const p = await this.proposta.calcolaInTx(tx, tenantId, inputDaMovimento(mov), {
        ...(v.cliente && { clienteId: v.cliente.id }),
        ...(v.contratto && { contrattoId: v.contratto.id }),
        ...(v.elenco && { elencoId: v.elenco.id }),
      })
      v.candidati = p.candidati
    } catch (err) {
      // I candidati sono un aiuto per le scelte: un 4xx del calcolo (scelta non piu' valida) non
      // deve impedire di leggere il legame. Gli errori veri (database) salgono.
      if (!(err instanceof HttpException)) throw err
    }
    return v
  }

  /** Vista del legame come la scrive il database ora, dentro una transazione gia' aperta. */
  async vistaInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<LegameVista> {
    return costruisciVista(tx, tenantId, id, null)
  }

  /**
   * Applica a un legame le scelte dell'utente con le regole di `modifica` (senza `conferma`) o di
   * `conferma`, dentro una transazione che ha gia' il lock consultivo della radice (la rettifica
   * del movimento, Task 21). Nessun controllo della `versione`: il chiamante ha appena riallineato il
   * legame sotto lock. Errori di dominio (cliente inesistente, `LEGAME_INCOMPLETO`...) come i
   * metodi pubblici: il chiamante li gestisce in un savepoint.
   */
  async applicaSceltaInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string | null,
    legameId: string,
    m: ModificheLegame,
    conferma: boolean
  ): Promise<LegameVista> {
    const mods = validaModifiche(m)
    const l = await leggiTestata(tx, tenantId, legameId)
    if (!l) throw nonTrovato()
    if (!STATI_MODIFICABILI.includes(l.stato)) throw statoNonAmmesso()
    const senzaModifiche =
      mods.clienteId === undefined &&
      mods.contrattoId === undefined &&
      mods.elencoId === undefined &&
      mods.righe.size === 0
    if (conferma && l.stato === 'CONFERMATO' && senzaModifiche) {
      return costruisciVista(tx, tenantId, l.id, null)
    }
    const righe = await leggiRighe(tx, tenantId, l.id)
    const e = await this.ricalcola(tx, tenantId, l, righe, mods, conferma)
    return this.scrivi(tx, tenantId, utenteId, l, e, righe, {
      azione: conferma ? 'LEGAME_MOVIMENTO_CONFERMATO' : 'LEGAME_MOVIMENTO_MODIFICATO',
      descrizione: conferma
        ? 'Legame movimento confermato dalla rettifica'
        : 'Legame movimento modificato dalla rettifica',
      bloccato: false,
    })
  }

  /**
   * Riallinea un legame rimasto indietro rispetto alla testa della catena (allineamento fallito
   * dopo una correzione, lista «da collegare» `DA_RIALLINEARE`). Va chiamato DENTRO una
   * transazione che ha gia' il lock consultivo della radice (`bloccaLegamePerRadice`), con la
   * testa letta dopo quel lock. Idempotente: se il vigente e' gia' la testa non scrive nulla.
   *
   * L'effetto e' quello della tabella §7.5 (`esitoCorrezione`, lo stesso che usera' il Task 21):
   * - FATTURATO / IMPORTATO_FATTURATO (decisione 21): cambiano SOLO `movimento_vigente_id`,
   *   `scostamento_dopo_fattura` e `scostamento_il`; stato, cliente, righe e data restano;
   * - ANNULLAMENTO in testa: ANNULLATO, righe conservate;
   * - causale non piu' fatturabile o data prima di «fatturazione da»: ESCLUSO col testo fisso;
   *   un ESCLUSO a mano resta tale (col suo testo) anche se la causale torna idonea;
   * - CER cambiato, o ESCLUSO automatico tornato idoneo: proposta rifatta da zero, un CONFERMATO
   *   torna PROPOSTO con l'avviso `CAMBIO_CER_DA_CONFERMARE` (i prezzi congelati si perdono);
   * - altrimenti: ricalcolo sulla nuova testa, prezzi congelati e manuali invariati, quantita'
   *   `DA_MOVIMENTO` riallineate, contratto ed elenco ricontrollati sulla nuova data.
   * Mai una scrittura su `waste_movements`.
   */
  async allineaAlVigente(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string | null,
    legameId: string,
    testa: TestaCatena,
    modifiche?: ModificheLegame
  ): Promise<{ vista: LegameVista; scostamento: boolean }> {
    const l = await leggiTestata(tx, tenantId, legameId)
    if (!l) throw nonTrovato()
    if (l.movimentoVigenteId === testa.id) {
      return { vista: await costruisciVista(tx, tenantId, l.id, null), scostamento: false }
    }
    const mods = validaModifiche(modifiche)
    const scrivi = async (e: Esito) => ({
      vista: await this.scrivi(tx, tenantId, utenteId, l, e, righe, {
        ...opzioni,
        bloccato: false,
      }),
      scostamento: e.scostamento === true,
    })
    if (l.stato === 'ANNULLATO') throw statoNonAmmesso()
    const righe = await leggiRighe(tx, tenantId, l.id)
    const base: Esito = {
      stato: l.stato,
      clienteId: l.clienteId,
      fonteCliente: l.fonteCliente,
      contrattoId: l.contrattoId,
      elencoId: l.elencoId,
      motivi: l.motivi,
      avvisi: l.avvisi,
      motivoEsclusione: l.motivoEsclusione,
      conferma: 'mantieni',
      righe: [],
      sostituisciRighe: false,
      congela: false,
      dettaglioCliente: null,
      cambi: [],
      righeAggiunte: [],
      righeRimosse: [],
      vigenteId: testa.id,
    }
    const opzioni = {
      azione: 'LEGAME_MOVIMENTO_ALLINEATO',
      descrizione: 'Legame movimento riallineato al movimento vigente',
    }

    if (eStatoFatturato(l.stato)) {
      return scrivi({ ...base, scostamento: true })
    }

    const tipo = testa.tipoAnnotazione === 'ANNULLAMENTO' ? 'ANNULLAMENTO' : 'RETTIFICA'
    const prima = await leggiMovimentoPerLegame(tx, tenantId, l.movimentoVigenteId)
    const fatturazioneDa = await leggiFatturazioneDaInTx(tx, tenantId, { condividi: true })
    const input = inputDaMovimento(testa)
    const fatturabile =
      tipo === 'ANNULLAMENTO'
        ? true
        : (
            await this.proposta.calcolaInTx(
              tx,
              tenantId,
              input,
              {},
              {
                fatturazioneDa: FATTURAZIONE_SEMPRE,
              }
            )
          ).fatturabile
    const cerCambiato = !!prima && prima.cerCode !== testa.cerCode
    const e = esitoCorrezione({
      statoPrima: l.stato,
      tipo,
      causaleFatturabileDopo: fatturabile,
      cerCambiato,
      dataDopo: testa.giorno,
      fatturazioneDa,
      dataPrima: l.dataMovimento,
      motivoEsclusionePrima: l.motivoEsclusione,
      haQuantitaManuali: righe.some(r => r.quantitaOrigine === 'MANUALE'),
      quantitaCambiata:
        !prima ||
        prima.unit !== testa.unit ||
        new Prisma.Decimal(prima.quantity).cmp(new Prisma.Decimal(testa.quantity)) !== 0,
    })
    // La data si scrive solo se il dominio lo dice (mai per i fatturati: ramo gestito sopra).
    const comune = { ...base, ...(e.aggiornaData ? { dataMovimento: testa.giorno } : {}) }

    if (e.statoDopo === 'ANNULLATO') {
      return scrivi({ ...comune, stato: 'ANNULLATO' })
    }
    if (e.statoDopo === 'ESCLUSO') {
      return scrivi({
        ...comune,
        stato: 'ESCLUSO',
        motivoEsclusione: e.motivoEsclusione ?? l.motivoEsclusione,
        conferma: 'azzera',
      })
    }
    if (e.statoDopo === 'NESSUN_LEGAME') {
      // Non puo' succedere (un legame esiste): se il dominio cambia, meglio fermarsi che scrivere.
      throw new Error('Legame: esito di correzione senza legame per un legame esistente')
    }

    if (e.ricalcolaProposta) {
      // Da zero: ESCLUSO automatico tornato idoneo, o CER cambiato. Resta il cliente scelto
      // dall'utente, se ancora attivo; i prezzi manuali e congelati si perdono (audit).
      let scelte: ScelteProposta = {}
      if (l.fonteCliente === 'UTENTE' && l.clienteId) {
        const c = await leggiCliente(tx, tenantId, l.clienteId)
        if (c?.attivo) scelte = { clienteId: c.id }
      }
      const p = await this.proposta.calcolaEBloccaInTx(tx, tenantId, input, scelte, {
        fatturazioneDa: FATTURAZIONE_SEMPRE,
      })
      if (!p.fatturabile) throw causaleNonFatturabile()
      const nuove = p.righe.map(righaDaProposta)
      const completo = !!p.cliente && !!p.contratto && !!p.elenco && nuove.length > 0
      const motivi = ordinaMotivi(p.motivi)
      const avvisi = [...p.avvisi, ...e.avvisiDaAggiungere].filter(
        (a, i, tutti) => tutti.indexOf(a) === i
      )
      const prezziManualiPersi = righe
        .filter(r => r.prezzoManuale || r.congelataIl !== null)
        .map(r => ({ rigaAddebitoId: r.rigaAddebitoId, prezzo: r.prezzo, sconto: r.sconto }))
      return scrivi({
        ...comune,
        stato: statoDopoRicalcolo(e.statoDopo, { motivi, completo }) as StatoLegame,
        clienteId: p.cliente?.id ?? null,
        fonteCliente: p.cliente?.fonte ?? null,
        contrattoId: p.contratto?.id ?? null,
        elencoId: p.elenco?.id ?? null,
        motivi,
        avvisi: avvisiDaRighe(avvisi, nuove),
        motivoEsclusione: null,
        conferma: 'azzera',
        righe: nuove,
        sostituisciRighe: true,
        dettaglioCliente: p.dettaglioCliente,
        prezziManualiPersi,
      })
    }

    // Stesso CER: ricalcolo sulla nuova testa.
    const eraConfermato = l.stato === 'CONFERMATO'
    const lNuovo: Testata = {
      ...l,
      movimentoVigenteId: testa.id,
      ...(e.aggiornaData ? { dataMovimento: testa.giorno } : {}),
    }
    if (eraConfermato && !e.ricontrollaValidita) {
      // La data non cambia: un CONFERMATO resta tale (§7.5 riga 1, §10) e non si ricontrollano
      // cliente, contratto ed elenco. Si rifanno solo le quantita' DA_MOVIMENTO (percorso
      // «stabile» di `ricalcola`: `quantita: null` = torna alla quantita' del movimento).
      for (const r of righe) {
        if (r.quantitaOrigine === 'DA_MOVIMENTO' && !mods.righe.has(r.rigaAddebitoId)) {
          mods.righe.set(r.rigaAddebitoId, { rimuovi: false, quantita: null })
        }
      }
      const r = await this.ricalcola(tx, tenantId, lNuovo, righe, mods, false)
      const avvisiS = [...r.avvisi, ...e.avvisiDaAggiungere].filter(
        (a, i, tutti) => tutti.indexOf(a) === i
      )
      return scrivi({
        ...r,
        vigenteId: testa.id,
        avvisi: avvisiDaRighe(avvisiS, r.righe),
      })
    }
    // Con il ricontrollo (la data cambia) o per un legame non confermato: un CONFERMATO si
    // ricalcola come PROPOSTO, cosi' contratto ed elenco si ricontrollano sulla nuova data, e lo
    // si ripristina se resta completo e senza motivi (altrimenti DA_COLLEGARE, §7.5).
    const r = await this.ricalcola(
      tx,
      tenantId,
      { ...lNuovo, stato: eraConfermato ? 'PROPOSTO' : l.stato },
      righe,
      mods,
      false
    )
    const ripristina = eraConfermato && r.stato === 'PROPOSTO'
    const avvisi = [...r.avvisi, ...e.avvisiDaAggiungere].filter(
      (a, i, tutti) => tutti.indexOf(a) === i
    )
    return scrivi({
      ...r,
      vigenteId: testa.id,
      ...(e.aggiornaData ? { dataMovimento: testa.giorno } : {}),
      stato: ripristina ? 'CONFERMATO' : r.stato,
      avvisi: avvisiDaRighe(avvisi, r.righe),
      conferma: ripristina ? 'mantieni' : 'azzera',
      congela: ripristina,
    })
  }

  // -----------------------------------------------------------------------------------------
  // Transazione
  // -----------------------------------------------------------------------------------------

  /** Apre la transazione, prende il lock della radice e controlla `versione`; poi esegue `fn`. */
  private async inTransazione(
    tenantId: string,
    id: string,
    versione: number,
    fn: (tx: Prisma.TransactionClient, l: Testata) => Promise<LegameVista>
  ): Promise<LegameVista> {
    if (!eUuid(id)) throw nonTrovato()
    if (!Number.isInteger(versione)) {
      throw new BadRequestException({
        error: 'VERSIONE_NON_VALIDA',
        message: 'La versione del legame non è valida.',
      })
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const radice = await tx.$queryRaw<{ radice: string }[]>`
            SELECT movimento_originale_id::text AS radice FROM legami_movimento
            WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`
          if (radice.length === 0) throw nonTrovato()
          await bloccaLegamePerRadice(tx, radice[0].radice)
          // La testata si legge DOPO il lock: chi ci precedeva ha gia' scritto.
          const l = await leggiTestata(tx, tenantId, id)
          if (!l) throw nonTrovato()
          if (l.versione !== versione) throw versioneSuperata()
          if (STATI_MODIFICABILI.includes(l.stato)) {
            // Legame rimasto indietro rispetto alla testa della catena (DA_RIALLINEARE): agire
            // ora congelerebbe o escluderebbe sui dati del movimento superato.
            const testa = await leggiTestaCatena(tx, tenantId, radice[0].radice)
            if (testa && testa.id !== l.movimentoVigenteId) throw daRiallineare()
          }
          return fn(tx, l)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => {
          if (eViolazioneFk(err)) throw concorrente()
          return traduciErrorePrisma(err, ENTITA, {})
        })
    )
  }

  // -----------------------------------------------------------------------------------------
  // Ricalcolo
  // -----------------------------------------------------------------------------------------

  /**
   * Dati finali del legame dopo `mods`. Il ricalcolo completo (movimento vigente, listino
   * bloccato) c'e' sempre, tranne per un CONFERMATO di cui cambiano solo quantita', prezzo o
   * sconto di righe che ci sono gia': li' non si tocca nulla di quello che l'utente ha gia'
   * confermato.
   */
  private async ricalcola(
    tx: Prisma.TransactionClient,
    tenantId: string,
    l: Testata,
    righeL: RigaLetta[],
    mods: ModificheNorm,
    conferma: boolean
  ): Promise<Esito> {
    const presenti = new Set(righeL.map(r => r.rigaAddebitoId))
    const nominate = [...mods.righe.keys()]
    const rimosse = nominate.filter(x => mods.righe.get(x)!.rimuovi)
    for (const x of rimosse) {
      if (!presenti.has(x)) {
        throw new BadRequestException({
          error: 'RIGA_NON_NEL_LEGAME',
          message: 'La riga da togliere non è nel legame.',
        })
      }
    }
    const aggiunte = nominate.filter(x => !presenti.has(x) && !mods.righe.get(x)!.rimuovi)
    const riderivaQuantita = new Set(nominate.filter(x => mods.righe.get(x)!.quantita === null))

    const clienteCambia = mods.clienteId !== undefined && mods.clienteId !== l.clienteId
    const contrattoCambia =
      mods.contrattoId !== undefined && (clienteCambia || mods.contrattoId !== l.contrattoId)
    const elencoCambia =
      mods.elencoId !== undefined &&
      (clienteCambia || contrattoCambia || mods.elencoId !== l.elencoId)
    const capoCambiato = clienteCambia || contrattoCambia || elencoCambia
    const strutturaCambiata = capoCambiato || aggiunte.length > 0 || rimosse.length > 0

    // Un CONFERMATO resta tale finche' le sue righe sono complete (spec §10: un elenco chiuso dopo
    // il congelamento non lo invalida): per lui testata e scelte NON si ricontrollano, a meno che
    // l'utente cambi cliente, contratto o elenco (allora torna PROPOSTO, decisione 2).
    const confermatoStabile = l.stato === 'CONFERMATO' && !capoCambiato
    const righeCambiate = aggiunte.length > 0 || rimosse.length > 0
    let righeBase: RigaLetta[] = righeL
    const cambiDerivati: CambioRiga[] = []
    let movLetto: MovimentoPerLegame | null = null
    if (confermatoStabile && riderivaQuantita.size > 0) {
      // `quantita: null` = torna alla quantita' del movimento: si ricava dal movimento vigente
      // con `quantitaPerRiga`, senza ricalcolare il resto. Se non e' ricavabile la riga resta
      // senza quantita' (SENZA_QUANTITA) e il legame scende a DA_COLLEGARE: e' la regola piu'
      // coerente, un legame confermato non puo' avere una riga senza quantita'.
      movLetto = await leggiMovimentoPerLegame(tx, tenantId, l.movimentoVigenteId)
      if (!movLetto) throw new Error('Legame: movimento vigente non trovato')
      const m = movLetto
      righeBase = righeL.map(r => {
        if (!riderivaQuantita.has(r.rigaAddebitoId)) return r
        const q = quantitaPerRiga(
          {
            tipoQuantita: r.tipoQuantita as TipoQuantita | null,
            unitaMisura: r.unitaMisura,
          },
          {
            quantity: new Prisma.Decimal(m.quantity).toFixed(),
            unit: m.unit,
          }
        )
        if (q !== r.quantita || r.quantitaOrigine !== 'DA_MOVIMENTO') {
          cambiDerivati.push({
            rigaAddebitoId: r.rigaAddebitoId,
            quantita: { prima: r.quantita, dopo: q },
          })
        }
        return { ...r, quantita: q, quantitaOrigine: q === null ? null : 'DA_MOVIMENTO' }
      })
    }
    if (confermatoStabile && !righeCambiate) {
      const { righe, cambi } = applicaModificheRighe(righeBase, mods, l.stato)
      return this.esito(l, conferma, {
        clienteId: l.clienteId,
        fonteCliente: l.fonteCliente,
        contrattoId: l.contrattoId,
        elencoId: l.elencoId,
        righe,
        motivi: ordinaMotivi(motiviRighe(righe)),
        avvisi: l.avvisi,
        dettaglioCliente: null,
        cambi: [...cambiDerivati, ...cambi],
        sostituisciRighe: false,
        righeAggiunte: [],
        righeRimosse: [],
        strutturaCambiata: false,
      })
    }

    const mov = movLetto ?? (await leggiMovimentoPerLegame(tx, tenantId, l.movimentoVigenteId))
    if (!mov) throw new Error('Legame: movimento vigente non trovato')

    // --- Scelte: quelle dell'utente, altrimenti quelle gia' nel legame.
    const clienteScelto = mods.clienteId ?? l.clienteId
    const contrattoScelto = clienteCambia ? mods.contrattoId : (mods.contrattoId ?? l.contrattoId)
    const elencoScelto =
      clienteCambia || contrattoCambia ? mods.elencoId : (mods.elencoId ?? l.elencoId)
    const selezione = capoCambiato
      ? nominate.filter(x => !mods.righe.get(x)!.rimuovi)
      : [...new Set([...righeBase.map(r => r.rigaAddebitoId), ...aggiunte])].filter(
          x => !rimosse.includes(x)
        )
    if (rimosse.length > 0 && selezione.length === 0) {
      throw new BadRequestException({
        error: 'RIGHE_VUOTE',
        message: 'Un legame deve avere almeno una riga.',
      })
    }

    // --- Dati gia' scelti e non piu' utilizzabili (cliente disattivato, contratto eliminato o
    // annullato, elenco chiuso): non si sceglie in silenzio qualcos'altro, si dice cosa non va.
    const deriva = confermatoStabile
      ? null
      : await this.controllaScelteCorrenti(tx, tenantId, l, mov.giorno, {
          clienteCambia,
          contrattoCambia: contrattoCambia || clienteCambia,
          elencoCambia: elencoCambia || contrattoCambia || clienteCambia,
          contrattoScelto: contrattoScelto ?? undefined,
          elencoScelto: elencoScelto ?? undefined,
        })
    if (deriva) {
      if (strutturaCambiata) throw incompleto(deriva.motivi, deriva.dettaglioCliente)
      const { righe, cambi } = applicaModificheRighe(righeL, mods, l.stato)
      return this.esito(l, conferma, {
        clienteId: l.clienteId,
        fonteCliente: l.fonteCliente,
        contrattoId: l.contrattoId,
        elencoId: l.elencoId,
        righe,
        motivi: ordinaMotivi([...deriva.motivi, ...motiviRighe(righe)]),
        avvisi: l.avvisi,
        dettaglioCliente: deriva.dettaglioCliente,
        cambi,
        sostituisciRighe: false,
        righeAggiunte: [],
        righeRimosse: [],
        strutturaCambiata: false,
      })
    }

    // --- Ricalcolo sul movimento vigente, con i lock sul listino.
    const scelte: ScelteProposta = {
      ...(clienteScelto ? { clienteId: clienteScelto } : {}),
      ...(contrattoScelto ? { contrattoId: contrattoScelto } : {}),
      ...(elencoScelto ? { elencoId: elencoScelto } : {}),
      ...(selezione.length > 0 ? { righeIds: selezione } : {}),
    }
    let p: PropostaVista
    try {
      p = await this.proposta.calcolaEBloccaInTx(tx, tenantId, inputDaMovimento(mov), scelte, {
        fatturazioneDa: FATTURAZIONE_SEMPRE,
      })
    } catch (err) {
      // Il contratto GIA' nel legame e' stato annullato o eliminato fra la lettura e il lock:
      // stesso 409 `LEGAME_INCOMPLETO` degli altri casi, non il messaggio del listino.
      if (!contrattoCambia && !clienteCambia && err instanceof HttpException) {
        const r = err.getResponse() as { error?: string }
        if (r.error === 'LISTINO_NON_MODIFICABILE') throw incompleto(['CONTRATTO_NON_ATTIVO'], null)
        if (r.error === 'CONTRATTO_CLIENTE_NON_TROVATO') throw incompleto(['SENZA_CONTRATTO'], null)
      }
      throw err
    }
    if (!p.fatturabile) throw causaleNonFatturabile()

    const elencoNuovo = p.elenco?.id ?? null
    const stessoElenco = elencoNuovo === l.elencoId
    let fuse = fondiRighe(righeBase, p.righe, { stessoElenco, riderivaQuantita })
    if (confermatoStabile) {
      // Riga aggiunta o tolta su un CONFERMATO (decisione 20): le altre righe non cambiano; la
      // riga nuova prende il prezzo del listino e si congela subito (`congela`, stato CONFERMATO).
      let ordine = Math.max(0, ...righeBase.map(r => r.ordine))
      fuse = [
        ...righeBase.filter(r => !rimosse.includes(r.rigaAddebitoId)),
        ...fuse.filter(r => !presenti.has(r.rigaAddebitoId)).map(r => ({ ...r, ordine: ++ordine })),
      ]
    }
    const { righe, cambi: cambiMods } = applicaModificheRighe(fuse, mods, l.stato)
    const cambi = [...cambiDerivati, ...cambiMods]
    if (confermatoStabile) {
      const motiviRiga = ordinaMotivi(motiviRighe(righe))
      if (motiviRiga.length > 0) throw incompleto(motiviRiga, null)
      return this.esito(l, conferma, {
        clienteId: l.clienteId,
        fonteCliente: l.fonteCliente,
        contrattoId: l.contrattoId,
        elencoId: l.elencoId,
        righe,
        motivi: [],
        avvisi: l.avvisi,
        dettaglioCliente: null,
        cambi,
        sostituisciRighe: false,
        righeAggiunte: aggiunte,
        righeRimosse: rimosse,
        strutturaCambiata: false,
      })
    }
    // Quantita' derivata ritrovata e prezzi manuali che il ricalcolo butta via: vanno nell'audit.
    for (const x of riderivaQuantita) {
      const prima = righeL.find(r => r.rigaAddebitoId === x)
      const dopo = righe.find(r => r.rigaAddebitoId === x)
      if (prima && dopo && prima.quantita !== dopo.quantita) {
        cambi.push({ rigaAddebitoId: x, quantita: { prima: prima.quantita, dopo: dopo.quantita } })
      }
    }
    const prezziManualiPersi = righeL
      .filter(r => r.prezzoManuale)
      .filter(r => !righe.some(x => x.rigaAddebitoId === r.rigaAddebitoId && x.prezzoManuale))
      .map(r => ({ rigaAddebitoId: r.rigaAddebitoId, prezzo: r.prezzo, sconto: r.sconto }))
    const avvisi = [...l.avvisi.filter(a => !AVVISI_DEL_RICALCOLO.includes(a)), ...p.avvisi].filter(
      (a, i, tutti) => tutti.indexOf(a) === i
    )
    const clienteId = p.cliente?.id ?? null
    const fonteCliente: 'FIR' | 'UTENTE' | null =
      clienteId === null
        ? null
        : clienteCambia
          ? 'UTENTE'
          : clienteId === l.clienteId
            ? l.fonteCliente
            : (p.cliente?.fonte ?? null)
    return this.esito(l, conferma, {
      clienteId,
      fonteCliente,
      contrattoId: p.contratto?.id ?? null,
      elencoId: elencoNuovo,
      righe,
      motivi: ordinaMotivi([
        ...p.motivi.filter(x => !MOTIVI_DELLE_RIGHE.includes(x)),
        ...motiviRighe(righe),
      ]),
      avvisi,
      dettaglioCliente: p.dettaglioCliente,
      cambi,
      sostituisciRighe: !stessoElenco,
      righeAggiunte: aggiunte,
      righeRimosse: rimosse,
      strutturaCambiata,
      prezziManualiPersi,
    })
  }

  /** Cliente disattivato, contratto eliminato o annullato, elenco chiuso fra la proposta e la conferma. */
  private async controllaScelteCorrenti(
    tx: Prisma.TransactionClient,
    tenantId: string,
    l: Testata,
    giorno: string,
    c: {
      clienteCambia: boolean
      contrattoCambia: boolean
      elencoCambia: boolean
      contrattoScelto: string | undefined
      elencoScelto: string | undefined
    }
  ): Promise<{ motivi: MotivoLegame[]; dettaglioCliente: string | null } | null> {
    if (l.clienteId && !c.clienteCambia) {
      const cliente = await leggiCliente(tx, tenantId, l.clienteId)
      if (cliente && !cliente.attivo) {
        return { motivi: ['SENZA_CLIENTE'], dettaglioCliente: 'cliente disattivato' }
      }
    }
    if (c.contrattoScelto) {
      const k = await leggiStatoContratto(tx, tenantId, c.contrattoScelto)
      if (k && !c.contrattoCambia) {
        if (k.eliminato) return { motivi: ['SENZA_CONTRATTO'], dettaglioCliente: null }
        if (k.stato === 'ANNULLATO') {
          return { motivi: ['CONTRATTO_NON_ATTIVO'], dettaglioCliente: null }
        }
      }
      // Un contratto annullato SCELTO ora non si puo' bloccare (listino non modificabile): e'
      // un contratto non attivo, non una proposta.
      if (k && c.contrattoCambia && k.stato === 'ANNULLATO' && !k.eliminato) {
        throw incompleto(['CONTRATTO_NON_ATTIVO'], null)
      }
    }
    if (c.elencoScelto && !c.elencoCambia) {
      const v = await leggiValiditaElenco(tx, tenantId, c.elencoScelto)
      if (
        v &&
        ((v.validoDal !== null && v.validoDal > giorno) ||
          (v.validoAl !== null && v.validoAl < giorno))
      ) {
        // Non ancora iniziato: l'elenco non c'e' ancora (insieme dei motivi chiuso).
        const nonIniziato = v.validoDal !== null && v.validoDal > giorno
        return {
          motivi: [nonIniziato ? 'SENZA_ELENCO' : 'ELENCO_SCADUTO'],
          dettaglioCliente: null,
        }
      }
    }
    return null
  }

  /** Stato, avvisi e conferma finali dai dati ricalcolati. */
  private esito(l: Testata, conferma: boolean, d: DatiEsito): Esito {
    const completo = !!d.clienteId && !!d.contrattoId && !!d.elencoId && d.righe.length > 0
    let stato: StatoLegame
    if (conferma) {
      if (d.motivi.length > 0 || !completo) throw incompleto(d.motivi, d.dettaglioCliente)
      stato = 'CONFERMATO'
    } else {
      // Un CONFERMATO di cui cambia la struttura va riconfermato; un valore soltanto no.
      const provvisorio: StatoLegame =
        l.stato === 'CONFERMATO' && d.strutturaCambiata ? 'PROPOSTO' : l.stato
      stato = statoDopoRicalcolo(provvisorio, { motivi: d.motivi, completo }) as StatoLegame
    }
    let avvisi = d.avvisi.filter(a => !(stato === 'CONFERMATO' && a === 'CAMBIO_CER_DA_CONFERMARE'))
    if (!d.righe.some(r => r.quantitaOrigine === 'MANUALE')) {
      avvisi = avvisi.filter(a => a !== 'QUANTITA_MANUALE_NON_DERIVATA')
    }
    return {
      stato,
      clienteId: d.clienteId,
      fonteCliente: d.fonteCliente,
      contrattoId: d.contrattoId,
      elencoId: d.elencoId,
      motivi: d.motivi,
      avvisi: avvisiDaRighe(avvisi, d.righe),
      motivoEsclusione: null,
      conferma: stato === 'CONFERMATO' ? (l.stato === 'CONFERMATO' ? 'mantieni' : 'ora') : 'azzera',
      righe: d.righe,
      sostituisciRighe: d.sostituisciRighe,
      congela: stato === 'CONFERMATO',
      dettaglioCliente: d.dettaglioCliente,
      cambi: d.cambi,
      righeAggiunte: d.righeAggiunte,
      righeRimosse: d.righeRimosse,
      prezziManualiPersi: d.prezziManualiPersi,
    }
  }

  // -----------------------------------------------------------------------------------------
  // Scrittura
  // -----------------------------------------------------------------------------------------

  private async scrivi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string | null,
    l: Testata,
    e: Esito,
    righePrima: readonly RigaMem[],
    o: { azione: string; descrizione: string; bloccato: boolean }
  ): Promise<LegameVista> {
    // Testata e righe FOR UPDATE (ultimo passo dell'ordine), poi la versione una seconda volta.
    // `escludi` e `riammetti` lo hanno gia' fatto prima di ricalcolare.
    if (!o.bloccato) {
      await bloccaRigheLegame(tx, tenantId, [l.id])
      await controllaVersione(tx, tenantId, l)
    }
    const sostituisci = e.sostituisciRighe || l.elencoId !== e.elencoId
    if (sostituisci) {
      // Le righe hanno FK verso la testata ON UPDATE NO ACTION: con righe presenti non si cambia
      // `elenco_id`. Prima si tolgono, poi si cambia la testata, poi si riscrivono.
      await tx.$executeRaw`
        DELETE FROM righe_legame_movimento
        WHERE tenant_id = ${tenantId}::uuid AND legame_id = ${l.id}::uuid`
    }
    const modoConferma = e.conferma
    const aggiornate = await tx.$executeRaw`
      UPDATE legami_movimento SET
        stato = ${e.stato}::stato_legame_movimento,
        cliente_id = ${e.clienteId}::uuid,
        fonte_cliente = ${e.fonteCliente}::fonte_cliente_legame,
        contratto_id = ${e.contrattoId}::uuid,
        elenco_id = ${e.elencoId}::uuid,
        motivi = ${e.motivi}::text[],
        avvisi = ${e.avvisi}::text[],
        motivo_esclusione = ${e.motivoEsclusione},
        movimento_vigente_id = COALESCE(${e.vigenteId ?? null}::uuid, movimento_vigente_id),
        data_movimento = COALESCE(${e.dataMovimento ?? null}::date, data_movimento),
        scostamento_dopo_fattura = scostamento_dopo_fattura OR ${e.scostamento === true}::boolean,
        scostamento_il = CASE WHEN ${e.scostamento === true}::boolean THEN now() ELSE scostamento_il END,
        confermato_il = CASE ${modoConferma}::text WHEN 'ora' THEN now()
                        WHEN 'azzera' THEN NULL ELSE confermato_il END,
        confermato_da = CASE ${modoConferma}::text WHEN 'ora' THEN ${utenteId}::uuid
                        WHEN 'azzera' THEN NULL ELSE confermato_da END,
        versione = versione + 1,
        updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND id = ${l.id}::uuid AND versione = ${l.versione}`
    if (aggiornate !== 1) throw versioneSuperata()

    if (e.righe.length > 0) await scriviRighe(tx, tenantId, l.id, e, sostituisci)

    const vista = await costruisciVista(tx, tenantId, l.id, e.dettaglioCliente)
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action: o.azione,
        description: o.descrizione,
        metadata: metadatiAudit(l, e, vista, righePrima) as Prisma.InputJsonValue,
      },
    })
    return vista
  }
}

// ---------------------------------------------------------------------------------------------
// Scrittura delle righe
// ---------------------------------------------------------------------------------------------

async function scriviRighe(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legameId: string,
  e: Esito,
  sostituite: boolean
): Promise<void> {
  const esistenti = sostituite ? [] : e.righe.filter(r => r.id !== null)
  const nuove = sostituite ? e.righe : e.righe.filter(r => r.id === null)
  if (!sostituite) {
    // Righe tolte: quelle del legame che non sono piu' nell'insieme finale. `= ANY` va bene: la
    // lista e' quella delle righe di UN legame (poche), non una lista grande come nei vincoli globali.
    const finali = e.righe.map(r => r.rigaAddebitoId)
    await tx.$executeRaw`
      DELETE FROM righe_legame_movimento
      WHERE tenant_id = ${tenantId}::uuid AND legame_id = ${legameId}::uuid
        AND NOT (riga_addebito_id = ANY(${finali}::uuid[]))`
  }
  if (esistenti.length > 0) {
    // Un solo UPDATE per tutte le righe del legame (poche, ma mai un ciclo di UPDATE).
    const json = JSON.stringify(
      esistenti.map(r => ({
        id: r.id,
        ordine: r.ordine,
        origine: r.origine,
        tipo: r.tipo,
        descrizione: r.descrizione,
        tipo_quantita: r.tipoQuantita,
        unita_misura: r.unitaMisura,
        quantita: r.quantita,
        quantita_origine: r.quantitaOrigine,
        prezzo_speciale: r.prezzoSpeciale,
        prezzo: r.prezzo,
        sconto: r.sconto,
        prezzo_manuale: r.prezzoManuale,
        codice_iva_id: r.codiceIvaId,
        aliquota_iva: r.aliquotaIva,
        natura_iva: r.naturaIva,
        congela: e.congela,
      }))
    )
    await tx.$executeRaw`
      UPDATE righe_legame_movimento r SET
        ordine = x.ordine, origine = x.origine::origine_riga_legame, tipo = x.tipo,
        descrizione = x.descrizione, tipo_quantita = x.tipo_quantita::tipo_quantita_addebito,
        unita_misura = x.unita_misura, quantita = x.quantita,
        quantita_origine = x.quantita_origine::origine_quantita_legame,
        prezzo_speciale = x.prezzo_speciale, prezzo = x.prezzo, sconto = x.sconto,
        prezzo_manuale = x.prezzo_manuale, codice_iva_id = x.codice_iva_id,
        aliquota_iva = x.aliquota_iva, natura_iva = x.natura_iva,
        congelata_il = CASE WHEN x.congela THEN COALESCE(r.congelata_il, now()) ELSE r.congelata_il END,
        updated_at = now()
      FROM jsonb_to_recordset(${json}::jsonb) AS x(
        id uuid, ordine int, origine text, tipo text, descrizione text, tipo_quantita text,
        unita_misura text, quantita numeric, quantita_origine text, prezzo_speciale boolean,
        prezzo numeric, sconto text, prezzo_manuale boolean, codice_iva_id uuid,
        aliquota_iva numeric, natura_iva text, congela boolean)
      WHERE r.id = x.id AND r.legame_id = ${legameId}::uuid AND r.tenant_id = ${tenantId}::uuid`
  }
  if (nuove.length > 0) {
    if (!e.elencoId) throw new Error('Legame: righe senza elenco')
    const elencoId = e.elencoId
    const adesso = new Date()
    await tx.rigaLegameMovimento.createMany({
      data: nuove.map(r => ({
        tenantId,
        legameId,
        elencoId,
        rigaAddebitoId: r.rigaAddebitoId,
        ordine: r.ordine,
        origine: r.origine,
        tipo: r.tipo,
        descrizione: r.descrizione,
        tipoQuantita: r.tipoQuantita as Prisma.RigaLegameMovimentoCreateManyInput['tipoQuantita'],
        unitaMisura: r.unitaMisura,
        quantita: r.quantita,
        quantitaOrigine: r.quantitaOrigine,
        prezzoSpeciale: r.prezzoSpeciale,
        prezzo: r.prezzo,
        sconto: r.sconto,
        prezzoManuale: r.prezzoManuale,
        codiceIvaId: r.codiceIvaId,
        aliquotaIva: r.aliquotaIva,
        naturaIva: r.naturaIva,
        congelataIl: e.congela ? adesso : null,
      })),
    })
  }
}

// ---------------------------------------------------------------------------------------------
// Letture
// ---------------------------------------------------------------------------------------------

/** Dopo `bloccaRigheLegame`: se qualcuno ha scritto il legame senza il lock consultivo, la versione e' cambiata. */
async function controllaVersione(
  tx: Prisma.TransactionClient,
  tenantId: string,
  l: Testata
): Promise<void> {
  const r = await tx.$queryRaw<{ versione: number }[]>`
    SELECT versione FROM legami_movimento WHERE tenant_id = ${tenantId}::uuid AND id = ${l.id}::uuid`
  if (r.length === 0 || r[0].versione !== l.versione) throw versioneSuperata()
}

async function leggiTestata(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string
): Promise<Testata | null> {
  const r = await tx.$queryRaw<
    (Omit<Testata, 'motivi' | 'avvisi'> & { motivi: string[]; avvisi: string[] })[]
  >`
    SELECT l.id::text AS id, l.movimento_originale_id::text AS "movimentoOriginaleId",
           l.movimento_vigente_id::text AS "movimentoVigenteId", l.stato::text AS stato,
           to_char(l.data_movimento, 'YYYY-MM-DD') AS "dataMovimento",
           l.cliente_id::text AS "clienteId", l.fonte_cliente::text AS "fonteCliente",
           l.contratto_id::text AS "contrattoId", l.elenco_id::text AS "elencoId",
           l.motivi AS motivi, l.avvisi AS avvisi, l.motivo_esclusione AS "motivoEsclusione",
           l.confermato_il AS "confermatoIl", l.confermato_da::text AS "confermatoDa",
           l.fatturato_il AS "fatturatoIl", l.riferimento_fattura AS "riferimentoFattura",
           l.scostamento_dopo_fattura AS "scostamentoDopoFattura",
           l.scostamento_il AS "scostamentoIl", l.versione AS versione
    FROM legami_movimento l
    WHERE l.tenant_id = ${tenantId}::uuid AND l.id = ${id}::uuid`
  if (r.length === 0) return null
  const t = r[0]
  if (!sonoMotiviValidi(t.motivi) || !sonoAvvisiValidi(t.avvisi)) {
    throw new Error('Legame: motivi o avvisi fuori dall’insieme ammesso')
  }
  return { ...t, motivi: t.motivi, avvisi: t.avvisi }
}

async function leggiRighe(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legameId: string
): Promise<RigaLetta[]> {
  const r = await tx.$queryRaw<(Omit<RigaMem, 'congelata'> & { congelataIl: Date | null })[]>`
    SELECT r.id::text AS id, r.riga_addebito_id::text AS "rigaAddebitoId", r.ordine AS ordine,
           r.origine::text AS origine, r.tipo AS tipo, r.descrizione AS descrizione,
           r.tipo_quantita::text AS "tipoQuantita", r.unita_misura AS "unitaMisura",
           r.quantita::text AS quantita, r.quantita_origine::text AS "quantitaOrigine",
           r.prezzo_speciale AS "prezzoSpeciale", r.prezzo::text AS prezzo, r.sconto AS sconto,
           r.prezzo_manuale AS "prezzoManuale", r.codice_iva_id::text AS "codiceIvaId",
           r.aliquota_iva::text AS "aliquotaIva", r.natura_iva AS "naturaIva",
           r.congelata_il AS "congelataIl"
    FROM righe_legame_movimento r
    WHERE r.tenant_id = ${tenantId}::uuid AND r.legame_id = ${legameId}::uuid
    ORDER BY r.ordine, r.id`
  return r.map(x => ({
    ...x,
    quantita: normalizzaDec(x.quantita),
    prezzo: normalizzaDec(x.prezzo),
    aliquotaIva: normalizzaDec(x.aliquotaIva) as string,
    congelata: x.congelataIl !== null,
  }))
}

/** Vista del legame come la scrive il database ora (dopo la scrittura, nella stessa transazione). */
async function costruisciVista(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
  dettaglioCliente: string | null
): Promise<LegameVista> {
  const l = await leggiTestata(tx, tenantId, id)
  if (!l) throw nonTrovato()
  const righe = await leggiRighe(tx, tenantId, id)
  const cliente = l.clienteId ? await leggiCliente(tx, tenantId, l.clienteId) : null
  const etichette = l.clienteId ? await leggiEtichetteListino(tx, tenantId, l.clienteId) : null
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  return {
    id: l.id,
    movimentoOriginaleId: l.movimentoOriginaleId,
    movimentoVigenteId: l.movimentoVigenteId,
    stato: l.stato,
    dataMovimento: l.dataMovimento,
    cliente: cliente
      ? { id: cliente.id, etichetta: cliente.etichetta, fonte: l.fonteCliente }
      : null,
    dettaglioCliente:
      dettaglioCliente ?? (cliente && !cliente.attivo ? 'cliente disattivato' : null),
    contratto:
      l.contrattoId && etichette
        ? { id: l.contrattoId, etichetta: etichette.contratti.get(l.contrattoId) ?? l.contrattoId }
        : null,
    elenco:
      l.elencoId && etichette
        ? { id: l.elencoId, etichetta: etichette.elenchi.get(l.elencoId) ?? l.elencoId }
        : null,
    righe: righe.map(r => ({
      id: r.id as string,
      rigaAddebitoId: r.rigaAddebitoId,
      ordine: r.ordine,
      origine: r.origine,
      tipo: r.tipo,
      descrizione: r.descrizione,
      tipoQuantita: r.tipoQuantita,
      unitaMisura: r.unitaMisura,
      quantita: r.quantita,
      quantitaOrigine: r.quantitaOrigine,
      prezzoSpeciale: r.prezzoSpeciale,
      prezzo: r.prezzo,
      sconto: r.sconto,
      prezzoManuale: r.prezzoManuale,
      codiceIvaId: r.codiceIvaId,
      aliquotaIva: r.aliquotaIva,
      naturaIva: r.naturaIva,
      congelataIl: iso(r.congelataIl),
      importo: importoVista(r.quantita, r.prezzo, r.sconto),
    })),
    motivi: l.motivi,
    avvisi: l.avvisi,
    motivoEsclusione: l.motivoEsclusione,
    confermatoIl: iso(l.confermatoIl),
    fatturatoIl: iso(l.fatturatoIl),
    riferimentoFattura: l.riferimentoFattura,
    scostamentoDopoFattura: l.scostamentoDopoFattura,
    scostamentoIl: iso(l.scostamentoIl),
    versione: l.versione,
  }
}

/**
 * Audit di un'azione: solo id, stati, importi e valori precedente e nuovo di quantita', prezzo e
 * sconto. Nessun dato personale (niente nomi, ragioni sociali o indirizzi); il testo libero del
 * motivo di esclusione NON si registra (potrebbe contenerne).
 */
function metadatiAudit(
  l: Testata,
  e: Esito,
  dopo: LegameVista,
  prima: readonly RigaMem[]
): Record<string, unknown> {
  let totale = new Prisma.Decimal(0)
  for (const r of dopo.righe) if (r.importo !== null) totale = totale.plus(r.importo)
  const struttura: Record<string, { prima: string | null; dopo: string | null }> = {}
  const confronta = (nome: string, a: string | null, b: string | null) => {
    if (a !== b) struttura[nome] = { prima: a, dopo: b }
  }
  confronta('clienteId', l.clienteId, dopo.cliente?.id ?? null)
  confronta('contrattoId', l.contrattoId, dopo.contratto?.id ?? null)
  confronta('elencoId', l.elencoId, dopo.elenco?.id ?? null)
  return {
    legameId: l.id,
    statoPrima: l.stato,
    statoDopo: dopo.stato,
    versionePrima: l.versione,
    versioneDopo: dopo.versione,
    motivi: dopo.motivi,
    importoTotale: totale.toFixed(),
    righePrima: prima.length,
    righeDopo: dopo.righe.length,
    righe: e.cambi,
    righeAggiunte: e.righeAggiunte,
    righeRimosse: e.righeRimosse,
    ...(e.prezziManualiPersi && e.prezziManualiPersi.length > 0
      ? { prezziManualiPersi: e.prezziManualiPersi }
      : {}),
    ...(Object.keys(struttura).length > 0 ? { struttura } : {}),
  }
}
