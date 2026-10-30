import { Injectable } from '@nestjs/common'
import { WHERE_VIGENTE } from '../../domain/waste-movement/vigenza'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { leggiApertureRegistro } from '../registro/aperture-registro'
import { LoggerService } from '../../core/logger/logger.service'
import { normalizzaUnitaRegistro } from '../../domain/waste-movement/unita-misura-registro'
import { cerCanonico, chiaveConfrontoCer } from '../../domain/waste-movement/cer-registro'
import { calcolaFifo, type LottoResiduo } from '../../domain/waste-movement/fifo-deposito'
import {
  scadenzaTemporale,
  unAnnoDopo,
  giorniTra,
  valutaDeposito,
  type AvvisoDeposito,
} from '../../domain/waste-movement/deposito-temporaneo'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { RegistroNonTrovatoError } from '../registro/registri.service'
import { SoglieDepositoService, type SoglieApplicate } from './soglie-deposito.service'
import { leggiEventiDeposito } from './eventi-deposito'
import {
  firAnnullato,
  etichettaFir,
  STATO_FIR_ANNULLATO,
  STATO_RENTRI_ANNULLATO,
} from '../../domain/fir/stati-fir'

/** Giacenza in un'unità che non è di massa (litri, m³, ...): non si somma ai kg. */
export interface GiacenzaAltraUnita {
  unita: string
  carico: number
  scarico: number
  giacenza: number
  /** Parte di `carico` che viene dalle giacenze iniziali (aperture del registro). */
  iniziale: number
}

/** Scarico collegato a un FIR poi annullato: la giacenza lo conta ancora, il MUD no. */
export interface ScaricoSuFirAnnullato {
  /** `progressiveYear/progressiveNumber` */
  numero: string
  quantita: number
  unita: string
  fir: string
}

export interface GiacenzaCer {
  cerCode: string
  /** Solo la famiglia di massa, con le tonnellate convertite in kg. */
  caricoKg: number
  /** Parte di `caricoKg` che viene dalle giacenze iniziali (aperture del registro), non da movimenti. */
  inizialeKg: number
  scaricoKg: number
  /** Giacenza attuale in deposito = carico - scarico (>= 0). */
  giacenzaKg: number
  /**
   * Giorno (a mezzanotte UTC) del lotto residuo più vecchio, cioè del carico o dell'apertura
   * non ancora coperto dagli scarichi secondo il FIFO del registro (F2-6, D9); `null` se non
   * c'è residuo. Senza `registroId` è il minimo fra i registri, ciascuno calcolato a sé.
   */
  oldestCaricoDate: Date | null
  altreUnita: GiacenzaAltraUnita[]
  scarichiSuFirAnnullati: ScaricoSuFirAnnullato[]
}

/** Massimo di lotti residui restituiti per famiglia di unità; oltre, `lottiOmessi`. */
const MAX_LOTTI_PER_FAMIGLIA = 50

export interface DepositoFamiglia {
  /** 'KG' (kg e tonnellate insieme) oppure l'unità normalizzata (es. 'M3'). */
  unita: string
  residuo: number
  /** Scarichi non coperti dai carichi: > 0 solo con uno storico incoerente. */
  scoperto: number
  lotti: LottoResiduo[]
  lottiOmessi: number
}

export interface DepositoCer {
  cerCode: string
  pericoloso: boolean
  /** Residuo della sola famiglia di massa, in kg. */
  residuoKg: number
  /** Giorno (YYYY-MM-DD) del lotto residuo più vecchio di qualunque famiglia. */
  giornoPiuVecchio: string | null
  etaGiorni: number | null
  scadenza: string | null
  /**
   * Scarichi in un'unità non di massa (litri, m³) mentre i carichi sono in kg: il FIFO non li
   * abbina e il lotto in kg resta aperto (F1). Nessuna conversione col peso specifico (M10).
   */
  unitaMiste: boolean
  famiglie: DepositoFamiglia[]
}

export interface DepositoRegistro {
  registroId: string
  registroDescrizione: string
  attivo: boolean
  soglie: SoglieApplicate
  cer: DepositoCer[]
  totaleKg: number
  totalePericolosiKg: number
  /** Un CER ha residuo in una famiglia non di massa (m³, litri): non entra nei kg. */
  quantitaParziale: boolean
  scopertoPresente: boolean
  avvisi: AvvisoDeposito[]
}

export interface DepositoTemporaneoVista {
  oggi: string
  registri: DepositoRegistro[]
}

export interface AvvisoDepositoRegistro extends AvvisoDeposito {
  registroId: string
  registroDescrizione: string
}

const arrotonda3 = (v: number): number => Math.round(v * 1000) / 1000

/**
 * Giacenze e monitoraggio del deposito temporaneo, calcolati dal registro
 * cronologico di carico/scarico (WasteMovement). Tutte le query sono
 * tenant-scoped.
 */
@Injectable()
export class GiacenzeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    private readonly soglie: SoglieDepositoService
  ) {
    this.logger.setContext(GiacenzeService.name)
  }

  /**
   * Giacenza corrente per CER (carico - scarico) con data del carico più vecchio.
   * Con `registroId` conta solo quel registro; senza, somma tutti i registri dell'azienda
   * (la giacenza fisica in deposito; lo scarico è comunque bloccato per registro).
   */
  async getGiacenze(tenantId: string, registroId?: string): Promise<GiacenzaCer[]> {
    const perRegistro = registroId ? { registroId } : {}
    const byType = await this.prisma.wasteMovement.groupBy({
      by: ['cerCode', 'type', 'unit'],
      where: { tenantId, ...perRegistro, ...WHERE_VIGENTE },
      _sum: { quantity: true },
    })

    // Giorno del lotto residuo più vecchio per CER: FIFO per registro e per famiglia di unità,
    // poi il minimo fra registri e famiglie (le somme restano quelle del groupBy).
    const aperture = await leggiApertureRegistro(this.prisma, tenantId, { registroId })
    const eventi = await leggiEventiDeposito(this.prisma, tenantId, {
      registroId,
      aperture,
      logger: this.logger,
    })
    const oldestByCer = new Map<string, string>()
    for (const perCerRegistro of eventi.values()) {
      for (const [chiave, gruppo] of perCerRegistro) {
        for (const lista of gruppo.famiglie.values()) {
          const giorno = calcolaFifo(lista).giornoPiuVecchio
          const attuale = oldestByCer.get(chiave)
          if (giorno && (!attuale || giorno < attuale)) oldestByCer.set(chiave, giorno)
        }
      }
    }

    interface Parziale {
      cerCode: string
      caricoKg: number
      inizialeKg: number
      scaricoKg: number
      altre: Map<string, GiacenzaAltraUnita>
    }
    const perCer = new Map<string, Parziale>()
    /** Voce del CER (chiave sulle sole cifre); l'asterisco vince: se una riga lo porta, il CER si mostra pericoloso. */
    const voceDi = (cerCode: string): { chiave: string; entry: Parziale } => {
      const chiave = chiaveConfrontoCer(cerCode)
      const entry = perCer.get(chiave) ?? {
        cerCode: cerCanonico(cerCode),
        caricoKg: 0,
        inizialeKg: 0,
        scaricoKg: 0,
        altre: new Map<string, GiacenzaAltraUnita>(),
      }
      if (cerCode.includes('*') && !entry.cerCode.endsWith('*')) entry.cerCode += '*'
      return { chiave, entry }
    }
    for (const row of byType) {
      const { chiave, entry } = voceDi(row.cerCode)
      const qty = row._sum.quantity ? Number(row._sum.quantity) : 0
      const carico = row.type === 'CARICO'
      const u = normalizzaUnitaRegistro(row.unit)
      if (u.massa) {
        const kg = qty * (u.fattoreKg as number)
        if (carico) entry.caricoKg += kg
        else if (row.type === 'SCARICO') entry.scaricoKg += kg
      } else {
        const altra = entry.altre.get(u.unita) ?? {
          unita: u.unita,
          carico: 0,
          scarico: 0,
          giacenza: 0,
          iniziale: 0,
        }
        if (carico) altra.carico += qty
        else if (row.type === 'SCARICO') altra.scarico += qty
        altra.giacenza = altra.carico - altra.scarico
        entry.altre.set(u.unita, altra)
      }
      perCer.set(chiave, entry)
    }

    // Le aperture del registro contano come carichi (e restano distinte in `inizialeKg`/`iniziale`);
    // un CER con la sola apertura compare comunque.
    for (const ap of aperture) {
      const { chiave, entry } = voceDi(ap.cerCode)
      const u = normalizzaUnitaRegistro(ap.unita)
      if (u.massa) {
        const kg = ap.quantita * (u.fattoreKg as number)
        entry.caricoKg += kg
        entry.inizialeKg += kg
      } else {
        const altra = entry.altre.get(u.unita) ?? {
          unita: u.unita,
          carico: 0,
          scarico: 0,
          giacenza: 0,
          iniziale: 0,
        }
        altra.carico += ap.quantita
        altra.iniziale += ap.quantita
        altra.giacenza = altra.carico - altra.scarico
        entry.altre.set(u.unita, altra)
      }
      perCer.set(chiave, entry)
    }

    const suFirAnnullati = await this.scarichiSuFirAnnullati(tenantId, registroId)

    const result: GiacenzaCer[] = []
    for (const [chiave, entry] of perCer) {
      const caricoKg = arrotonda3(entry.caricoKg)
      const scaricoKg = arrotonda3(entry.scaricoKg)
      result.push({
        cerCode: entry.cerCode,
        caricoKg,
        inizialeKg: arrotonda3(entry.inizialeKg),
        scaricoKg,
        // Non negativa: scarichi > carichi indicano dati incoerenti (gestiti
        // a parte dall'anomaly detection), qui clampiamo a 0.
        giacenzaKg: Math.max(0, arrotonda3(caricoKg - scaricoKg)),
        oldestCaricoDate: oldestByCer.has(chiave)
          ? new Date(`${oldestByCer.get(chiave)}T00:00:00Z`)
          : null,
        altreUnita: [...entry.altre.values()],
        scarichiSuFirAnnullati: suFirAnnullati.get(chiave) ?? [],
      })
    }

    result.sort((a, b) => b.giacenzaKg - a.giacenzaKg)
    return result
  }

  /** Scarichi collegati a un FIR annullato (in locale o all'ente), per CER (solo cifre). */
  private async scarichiSuFirAnnullati(
    tenantId: string,
    registroId?: string
  ): Promise<Map<string, ScaricoSuFirAnnullato[]>> {
    const perCer = new Map<string, ScaricoSuFirAnnullato[]>()
    const firs = await this.prisma.fIR.findMany({
      where: {
        tenantId,
        OR: [{ status: STATO_FIR_ANNULLATO }, { rentriStatoFormulario: STATO_RENTRI_ANNULLATO }],
      },
      select: {
        id: true,
        status: true,
        firNumber: true,
        rentriNumeroFir: true,
        rentriStatoFormulario: true,
      },
    })
    const etichette = new Map(firs.filter(f => firAnnullato(f)).map(f => [f.id, etichettaFir(f)]))
    if (etichette.size === 0) return perCer

    const scarichi = await this.prisma.wasteMovement.findMany({
      where: {
        tenantId,
        type: 'SCARICO',
        firId: { in: [...etichette.keys()] },
        ...(registroId ? { registroId } : {}),
        ...WHERE_VIGENTE,
      },
      select: {
        cerCode: true,
        progressiveNumber: true,
        progressiveYear: true,
        quantity: true,
        unit: true,
        firId: true,
      },
      orderBy: [{ progressiveYear: 'asc' }, { progressiveNumber: 'asc' }],
    })
    for (const s of scarichi) {
      const chiave = chiaveConfrontoCer(s.cerCode)
      const elenco = perCer.get(chiave) ?? []
      elenco.push({
        numero: `${s.progressiveYear}/${s.progressiveNumber}`,
        quantita: Number(s.quantity),
        unita: s.unit,
        fir: etichette.get(s.firId as string) ?? '',
      })
      perCer.set(chiave, elenco)
    }
    return perCer
  }

  /**
   * Deposito temporaneo per registro (art. 185-bis): residuo FIFO per CER e famiglia di unità,
   * età del lotto più vecchio, soglie applicate e avvisi. Numero di query fisso (registri,
   * movimenti, aperture, pericolosità, soglie) qualunque siano registri e CER.
   */
  async getDepositoTemporaneo(
    tenantId: string,
    opzioni: { registroId?: string; oggi?: string } = {}
  ): Promise<DepositoTemporaneoVista> {
    const { registroId } = opzioni
    const oggi = opzioni.oggi ?? giornoItaliano(new Date())
    const registri = await this.prisma.registroRifiuti.findMany({
      where: { tenantId },
      select: { id: true, descrizione: true, attivo: true },
      orderBy: [{ attivo: 'desc' }, { createdAt: 'asc' }],
    })
    if (registroId && !registri.some(r => r.id === registroId)) {
      throw new RegistroNonTrovatoError()
    }
    const eventi = await leggiEventiDeposito(this.prisma, tenantId, {
      registroId,
      logger: this.logger,
    })
    // Con registroId esplicito il registro compare sempre (anche disattivato e senza eventi,
    // con la voce vuota); altrimenti solo gli attivi e i disattivati che hanno eventi.
    const scelti = registroId
      ? registri.filter(r => r.id === registroId)
      : registri.filter(r => r.attivo || eventi.has(r.id))
    // Senza registri visibili (es. contesto di un'altra azienda) non c'è nulla da leggere.
    const soglie =
      scelti.length > 0
        ? await this.soglie.soglieApplicate(
            tenantId,
            scelti.map(r => r.id)
          )
        : new Map<string, SoglieApplicate>()

    const risultato: DepositoRegistro[] = []
    for (const r of scelti) {
      const soglieR = soglie.get(r.id) as SoglieApplicate
      const cer: DepositoCer[] = []
      let quantitaParziale = false
      let scopertoPresente = false
      for (const gruppo of (eventi.get(r.id) ?? new Map()).values()) {
        const famiglie: DepositoFamiglia[] = []
        let residuoKg = 0
        let giorno: string | null = null
        let haResiduo = false
        let scopertoAltraUnita = false
        const ordinate = [...gruppo.famiglie].sort(([x], [y]) =>
          x === 'KG' ? -1 : y === 'KG' ? 1 : x < y ? -1 : x > y ? 1 : 0
        )
        for (const [unita, lista] of ordinate) {
          const esito = calcolaFifo(lista)
          if (esito.scoperto > 0) {
            scopertoPresente = true
            if (unita !== 'KG') scopertoAltraUnita = true
          }
          if (esito.lotti.length > 0) {
            haResiduo = true
            if (unita === 'KG') residuoKg += esito.residuoTotale
            else quantitaParziale = true
          }
          if (esito.giornoPiuVecchio && (!giorno || esito.giornoPiuVecchio < giorno)) {
            giorno = esito.giornoPiuVecchio
          }
          if (esito.lotti.length === 0 && esito.scoperto <= 0) continue
          famiglie.push({
            unita,
            residuo: esito.residuoTotale,
            scoperto: esito.scoperto,
            lotti: esito.lotti.slice(0, MAX_LOTTI_PER_FAMIGLIA),
            lottiOmessi: Math.max(0, esito.lotti.length - MAX_LOTTI_PER_FAMIGLIA),
          })
        }
        if (!haResiduo && famiglie.length === 0) continue
        cer.push({
          cerCode: gruppo.cerCode,
          pericoloso: gruppo.pericoloso,
          residuoKg: arrotonda3(residuoKg),
          giornoPiuVecchio: giorno,
          etaGiorni: giorno ? giorniTra(giorno, oggi) : null,
          scadenza: null,
          unitaMiste: scopertoAltraUnita && residuoKg > 0,
          famiglie,
        })
      }
      cer.sort((x, y) => (x.cerCode < y.cerCode ? -1 : x.cerCode > y.cerCode ? 1 : 0))

      const avvisi = valutaDeposito(
        {
          cer: cer.map(c => ({
            cerCode: c.cerCode,
            pericoloso: c.pericoloso,
            residuoKg: c.residuoKg,
            giornoPiuVecchio: c.giornoPiuVecchio,
            unitaMiste: c.unitaMiste,
          })),
        },
        soglieR,
        oggi
      )
      for (const c of cer) {
        if (!c.giornoPiuVecchio) continue
        const daAvviso = avvisi.find(
          a => a.cerCode === c.cerCode && (a.tipo === 'DURATA' || a.tipo === 'DURATA_ANNUALE')
        )
        c.scadenza =
          daAvviso?.scadenza ??
          (soglieR.criterio === 'QUANTITATIVO'
            ? unAnnoDopo(c.giornoPiuVecchio)
            : scadenzaTemporale(c.giornoPiuVecchio, soglieR.giorniMax))
      }
      risultato.push({
        registroId: r.id,
        registroDescrizione: r.descrizione,
        attivo: r.attivo,
        soglie: soglieR,
        cer,
        totaleKg: arrotonda3(cer.reduce((tot, c) => tot + c.residuoKg, 0)),
        totalePericolosiKg: arrotonda3(
          cer.reduce((tot, c) => tot + (c.pericoloso ? c.residuoKg : 0), 0)
        ),
        quantitaParziale,
        scopertoPresente,
        avvisi,
      })
    }

    const superati = risultato.reduce(
      (n, r) => n + r.avvisi.filter(a => a.livello === 'SUPERATO').length,
      0
    )
    if (superati > 0) {
      this.logger.warn(
        `Deposito temporaneo: ${superati} avvisi di superamento per tenant ${tenantId}`
      )
    }
    return { oggi, registri: risultato }
  }

  /** Elenco piatto degli avvisi di tutti i registri (o di uno), con il registro di provenienza. */
  async getDepositoTemporaneoAlerts(
    tenantId: string,
    registroId?: string,
    oggi?: string
  ): Promise<AvvisoDepositoRegistro[]> {
    const vista = await this.getDepositoTemporaneo(tenantId, { registroId, oggi })
    return vista.registri.flatMap(r =>
      r.avvisi.map(a => ({
        ...a,
        registroId: r.registroId,
        registroDescrizione: r.registroDescrizione,
      }))
    )
  }
}
