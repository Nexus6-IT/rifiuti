/**
 * Vista, proposta, override e ricalcolo degli abbinamenti carico-scarico (4.6, Task 8).
 *
 * Le letture usano il lettore del Task 4 nel contesto del tenant; le scritture aprono una
 * transazione e chiamano le funzioni del Task 5 (che prendono da sole i lock). Il registro e'
 * risolto con `RegistriService.risolviInLettura`: di un'altra azienda e' RegistroNonTrovatoError.
 */
import { Injectable, NotFoundException } from '@nestjs/common'
import {
  RUOLI_PROGRESSIVO_INIZIALE,
  RUOLI_REGISTRAZIONE,
} from '../../api/registro/registro.controller'
import type { RuoloApplicativo } from '../../api/me/ruolo-effettivo.service'
import { TenantContext } from '../../core/context/tenant-context'
import { LoggerService } from '../../core/logger/logger.service'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaAbbinamenti,
  proponiAbbinamenti,
  residui,
  statoCarico,
  statoScarico,
  type CaricoAbbinabile,
  type ClasseStoccaggio,
  type OrigineRiga,
  type RigaAbbinamento,
  type ScaricoAbbinabile,
  type StatoCarico,
  type StatoScarico,
} from '../../domain/waste-movement/abbinamento-carichi'
import { giorniTra } from '../../domain/waste-movement/deposito-temporaneo'
import { confrontaEventiFifo, millesimiFifo } from '../../domain/waste-movement/fifo-deposito'
import { RegistriService } from '../registro/registri.service'
import {
  carichiDellaClasse,
  classeEffettiva,
  ricalcolaAbbinamenti,
  salvaAbbinamentoManuale,
} from './abbinamenti-scrittura'
import {
  leggiAmbitiAbbinamento,
  radiceScarico,
  type AmbitoAbbinamento,
} from './lettore-abbinamenti'

export interface RiferimentoCaricoVista {
  tipo: 'MOVIMENTO' | 'APERTURA'
  /** radice del carico (movimento) o id della giacenza iniziale */
  id: string
  numero: string | null
  giorno: string
}
export interface CaricoVista extends RiferimentoCaricoVista {
  classe: ClasseStoccaggio | null
  quantita: number
  abbinato: number
  residuo: number
  /** giorni dal carico a `oggi`, solo se ha ancora un residuo */
  etaGiorni: number | null
  stato: StatoCarico
}
export interface RigaVista {
  carico: RiferimentoCaricoVista
  quantita: number
  origine: OrigineRiga
}
export interface ScaricoVista {
  /** radice */
  id: string
  numero: string
  giorno: string
  quantita: number
  classeAttesa: ClasseStoccaggio | null
  abbinato: number
  stato: StatoScarico
  righe: RigaVista[]
}
export interface AmbitoVista {
  cerCode: string
  famiglia: string
  unita: string
  classi: ClasseStoccaggio[]
  carichi: CaricoVista[]
  scarichi: ScaricoVista[]
  differenzeFifo: number
  incoerenze: string[]
}
export interface VistaAbbinamenti {
  registroId: string
  oggi: string
  ambiti: AmbitoVista[]
  puoModificare: boolean
  puoRicalcolare: boolean
}
export interface PropostaScarico {
  scarico: ScaricoVista
  /** residuo escluso lo scarico stesso */
  candidati: CaricoVista[]
  proposta: Array<{ carico: RiferimentoCaricoVista; quantita: number }>
  scoperto: number
}
export interface DifferenzaVista {
  scarico: { id: string; numero: string }
  carico: RiferimentoCaricoVista
  persistita: number
  fifo: number
}
export interface EsitoSalvataggio {
  scarico: ScaricoVista
  avvisi: string[]
}
export interface RicalcoloRichiesto {
  registroId: string
  cerCode?: string
  modalita: 'NON_ABBINATI' | 'AUTOMATICI'
}

const MSG_SCOLLEGATO =
  'Lo scarico è senza abbinamento: il prossimo ricalcolo (anche "Abbina con FIFO i non abbinati") lo riabbinerà con il FIFO.'

export const puoModificare = (ruolo: RuoloApplicativo): boolean =>
  RUOLI_REGISTRAZIONE.includes(ruolo)
export const puoRicalcolare = (ruolo: RuoloApplicativo): boolean =>
  RUOLI_PROGRESSIVO_INIZIALE.includes(ruolo)

const mill = (n: number): number => millesimiFifo(n)
const daMill = (m: number): number => m / 1000

function riferimento(c: CaricoAbbinabile): RiferimentoCaricoVista {
  return {
    tipo: c.chiave.startsWith('M:') ? 'MOVIMENTO' : 'APERTURA',
    id: c.chiave.slice(2),
    numero: c.numero ?? null,
    giorno: c.evento.giorno,
  }
}

/** FIFO ricalcolato da zero sull'ambito, per partizione di classe (stessa logica del ricalcolo). */
export function fifoDaCapo(a: AmbitoAbbinamento): Array<Omit<RigaAbbinamento, 'origine'>> {
  const out: Array<Omit<RigaAbbinamento, 'origine'>> = []
  for (const classe of ['R13', 'D15'] as const) {
    const scarichi = a.scarichi.filter(s => classeEffettiva(a, s) === classe)
    if (scarichi.length === 0) continue
    out.push(
      ...proponiAbbinamenti({
        carichi: carichiDellaClasse(a, classe).map(c => ({
          chiave: c.chiave,
          evento: c.evento,
          residuo: c.evento.quantita,
        })),
        scarichi: scarichi.map(s => ({
          radiceId: s.radiceId,
          evento: s.evento,
          daCoprire: s.evento.quantita,
        })),
      }).righe
    )
  }
  return out
}

function costruisciScarico(
  a: AmbitoAbbinamento,
  s: ScaricoAbbinabile,
  perChiave: Map<string, CaricoAbbinabile>,
  incoerenti: Set<string>
): ScaricoVista {
  const righe = a.righeValide
    .filter(r => r.scaricoRadiceId === s.radiceId)
    .map(r => ({ r, c: perChiave.get(r.carico) as CaricoAbbinabile }))
    .sort((x, y) => confrontaEventiFifo(x.c.evento, y.c.evento))
  const abbinato = righe.reduce((t, { r }) => t + mill(r.quantita), 0)
  const stato = statoScarico(s.evento.quantita, daMill(abbinato))
  return {
    id: s.radiceId,
    numero: s.numero,
    giorno: s.evento.giorno,
    quantita: s.evento.quantita,
    classeAttesa: s.classeAttesa,
    abbinato: daMill(abbinato),
    stato: incoerenti.has(`S:${s.radiceId}`) ? 'INCOERENTE' : stato,
    righe: righe.map(({ r, c }) => ({
      carico: riferimento(c),
      quantita: r.quantita,
      origine: r.origine,
    })),
  }
}

function incoerentiPerStato(a: AmbitoAbbinamento, perChiave: Map<string, CaricoAbbinabile>) {
  const out = new Set<string>()
  for (const r of a.righeValide) {
    const c = perChiave.get(r.carico)
    const s = a.scarichi.find(x => x.radiceId === r.scaricoRadiceId)
    if (c && s && confrontaEventiFifo(c.evento, s.evento) > 0) {
      out.add(`S:${s.radiceId}`)
      out.add(`C:${c.chiave}`)
    }
  }
  return out
}

function costruisciCarico(
  c: CaricoAbbinabile,
  abbinatoMill: number,
  oggi: string,
  incoerente: boolean
): CaricoVista {
  const q = c.evento.quantita
  const residuo = Math.max(daMill(mill(q) - abbinatoMill), 0)
  return {
    ...riferimento(c),
    classe: c.classe,
    quantita: q,
    abbinato: daMill(abbinatoMill),
    residuo,
    etaGiorni: residuo > 0 ? giorniTra(c.evento.giorno, oggi) : null,
    stato: incoerente ? 'INCOERENTE' : statoCarico(q, daMill(abbinatoMill)),
  }
}

/** Ambito per la pagina: carichi in ordine FIFO, scarichi dal piu recente. */
export function costruisciAmbitoVista(a: AmbitoAbbinamento, oggi: string): AmbitoVista {
  const perChiave = new Map(a.carichi.map(c => [c.chiave, c]))
  const incoerenti = incoerentiPerStato(a, perChiave)
  const usato = new Map<string, number>()
  for (const r of a.righeValide) usato.set(r.carico, (usato.get(r.carico) ?? 0) + mill(r.quantita))
  const carichi = [...a.carichi]
    .sort((x, y) => confrontaEventiFifo(x.evento, y.evento))
    .map(c => costruisciCarico(c, usato.get(c.chiave) ?? 0, oggi, incoerenti.has(`C:${c.chiave}`)))
  const scarichi = [...a.scarichi]
    .sort((x, y) => confrontaEventiFifo(y.evento, x.evento))
    .map(s => costruisciScarico(a, s, perChiave, incoerenti))
  const differenze = confrontaAbbinamenti(a.righeValide, fifoDaCapo(a))
  const motivi = [...new Set(a.righeIncoerenti.map(r => r.motivo))]
  return {
    cerCode: a.cerCode,
    famiglia: a.famiglia,
    unita: a.unita,
    classi: a.classi,
    carichi,
    scarichi,
    differenzeFifo: new Set(differenze.map(d => d.scaricoRadiceId)).size,
    incoerenze: motivi,
  }
}

@Injectable()
export class AbbinamentiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registri: RegistriService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(AbbinamentiService.name)
  }

  private nelContesto<R>(tenantId: string, fn: () => Promise<R>): Promise<R> {
    const corrente = TenantContext.getStoreTenantId()
    if (corrente === null) return TenantContext.run({ tenantId }, fn)
    if (corrente !== tenantId) {
      return Promise.reject(
        new Error('AbbinamentiService: il tenant richiesto non coincide con quello del contesto.')
      )
    }
    return fn()
  }

  async vista(
    tenantId: string,
    registroId: string,
    oggi: string = giornoItaliano(new Date()),
    ruolo: RuoloApplicativo
  ): Promise<VistaAbbinamenti> {
    const registro = await this.registri.risolviInLettura(tenantId, registroId)
    const ambiti = await this.nelContesto(tenantId, () =>
      leggiAmbitiAbbinamento(
        this.prisma,
        tenantId,
        { registroId: registro.id },
        { logger: this.logger }
      )
    )
    return {
      registroId: registro.id,
      oggi,
      ambiti: ambiti.filter(a => a.diStoccaggio).map(a => costruisciAmbitoVista(a, oggi)),
      puoModificare: puoModificare(ruolo),
      puoRicalcolare: puoRicalcolare(ruolo),
    }
  }

  async proposta(
    tenantId: string,
    scaricoId: string,
    oggi: string = giornoItaliano(new Date())
  ): Promise<PropostaScarico> {
    return this.nelContesto(tenantId, async () => {
      const radice = await radiceScarico(this.prisma, tenantId, scaricoId)
      if (!radice) throw new NotFoundException('Scarico non trovato')
      const ambiti = await leggiAmbitiAbbinamento(this.prisma, tenantId, {
        registroId: radice.registroId,
        cer: radice.cerCode,
      })
      const a = ambiti.find(x => x.scarichi.some(s => s.radiceId === radice.radiceId))
      const s = a?.scarichi.find(x => x.radiceId === radice.radiceId)
      if (!a || !s) throw new NotFoundException('Scarico non trovato')

      const perChiave = new Map(a.carichi.map(c => [c.chiave, c]))
      const scaricoVista = costruisciScarico(a, s, perChiave, incoerentiPerStato(a, perChiave))
      const senzaLui = residui(
        a.carichi,
        a.righeValide.filter(r => r.scaricoRadiceId !== radice.radiceId)
      )
      const usatoDaAltri = (c: CaricoAbbinabile): number =>
        mill(c.evento.quantita) - mill(senzaLui.get(c.chiave) ?? 0)
      const candidati = [...a.carichi]
        .filter(
          c => confrontaEventiFifo(c.evento, s.evento) <= 0 && (senzaLui.get(c.chiave) ?? 0) > 0
        )
        .sort((x, y) => confrontaEventiFifo(x.evento, y.evento))
      const classe = classeEffettiva(a, s)
      const { righe, scoperti } = classe
        ? proponiAbbinamenti({
            carichi: carichiDellaClasse(a, classe).map(c => ({
              chiave: c.chiave,
              evento: c.evento,
              residuo: Math.max(senzaLui.get(c.chiave) ?? 0, 0),
            })),
            scarichi: [{ radiceId: s.radiceId, evento: s.evento, daCoprire: s.evento.quantita }],
          })
        : { righe: [], scoperti: new Map<string, number>() }
      return {
        scarico: scaricoVista,
        candidati: candidati.map(c => costruisciCarico(c, usatoDaAltri(c), oggi, false)),
        proposta: righe.map(r => ({
          carico: riferimento(perChiave.get(r.carico) as CaricoAbbinabile),
          quantita: r.quantita,
        })),
        scoperto: classe ? (scoperti.get(s.radiceId) ?? 0) : s.evento.quantita,
      }
    })
  }

  async salvaManuale(
    tenantId: string,
    userId: string,
    scaricoId: string,
    righe: Array<{ caricoId?: string; giacenzaInizialeId?: string; quantita: number }>
  ): Promise<EsitoSalvataggio> {
    return this.nelContesto(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const { avvisi } = await salvaAbbinamentoManuale(tx, {
          tenantId,
          scaricoRadiceId: scaricoId,
          userId,
          righe,
        })
        // la risposta e' letta nella stessa transazione, sotto lo stesso lock
        const radice = await radiceScarico(tx, tenantId, scaricoId)
        const ambiti = await leggiAmbitiAbbinamento(tx, tenantId, {
          registroId: radice?.registroId as string,
          cer: radice?.cerCode,
        })
        const a = ambiti.find(x => x.scarichi.some(s => s.radiceId === radice?.radiceId))
        const s = a?.scarichi.find(x => x.radiceId === radice?.radiceId)
        if (!a || !s) throw new NotFoundException('Scarico non trovato')
        const perChiave = new Map(a.carichi.map(c => [c.chiave, c]))
        const scarico = costruisciScarico(a, s, perChiave, incoerentiPerStato(a, perChiave))
        const tutti = righe.length === 0 ? [...avvisi, MSG_SCOLLEGATO] : avvisi
        return { scarico, avvisi: tutti }
      })
    )
  }

  async ricalcola(tenantId: string, userId: string, dto: RicalcoloRichiesto) {
    const registro = await this.registri.risolviInLettura(tenantId, dto.registroId)
    return this.nelContesto(tenantId, () =>
      this.prisma.$transaction(tx =>
        ricalcolaAbbinamenti(tx, {
          tenantId,
          registroId: registro.id,
          cer: dto.cerCode,
          modalita: dto.modalita,
          userId,
          logger: this.logger,
        })
      )
    )
  }

  async differenze(tenantId: string, registroId: string, cer?: string): Promise<DifferenzaVista[]> {
    const registro = await this.registri.risolviInLettura(tenantId, registroId)
    const ambiti = await this.nelContesto(tenantId, () =>
      leggiAmbitiAbbinamento(
        this.prisma,
        tenantId,
        { registroId: registro.id, cer },
        { logger: this.logger }
      )
    )
    const out: DifferenzaVista[] = []
    for (const a of ambiti.filter(x => x.diStoccaggio)) {
      const perChiave = new Map(a.carichi.map(c => [c.chiave, c]))
      for (const d of confrontaAbbinamenti(a.righeValide, fifoDaCapo(a))) {
        const s = a.scarichi.find(x => x.radiceId === d.scaricoRadiceId)
        const c = perChiave.get(d.carico)
        if (!s || !c) continue
        out.push({
          scarico: { id: s.radiceId, numero: s.numero },
          carico: riferimento(c),
          persistita: d.quantitaA,
          fifo: d.quantitaB,
        })
      }
    }
    return out
  }
}
