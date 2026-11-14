import { Inject, Injectable } from '@nestjs/common'
import { ATTIVITA_ORR, type AttivitaOrr } from '../../domain/comunicazioni/orr/costanti'
import { ComunicazioneConBloccantiError } from './comunicazioni-orso.port'
import {
  type AnteprimaFileOrr,
  type AnteprimaOrr,
  type ComunicazioneOrrVista,
  type ComunicazioniOrrPort,
  type RichiestaOrr,
} from './comunicazioni-orr.port'
import {
  COMUNICAZIONI_TRACCIATO_SERVICE,
  type AvvisoTracciato,
  type ComunicazioneTracciatoVista,
  type ComunicazioniTracciatoPort,
} from './comunicazioni-tracciato.port'

/** Codici che descrivono un file vuoto, non un problema dei dati: non sono avvisi «generali». */
const CODICI_FILE_VUOTO = new Set(['DATI_NON_VALIDI', 'NESSUN_DATO'])
const PREFISSO = 'xrec718-'

export const attivitaDelTracciato = (tracciato: string): AttivitaOrr =>
  tracciato.slice(PREFISSO.length) as AttivitaOrr

@Injectable()
export class ComunicazioniOrrService implements ComunicazioniOrrPort {
  constructor(
    @Inject(COMUNICAZIONI_TRACCIATO_SERVICE) private readonly tracciato: ComunicazioniTracciatoPort
  ) {}

  private attivita(r: RichiestaOrr): readonly AttivitaOrr[] {
    return r.attivita ? [r.attivita] : ATTIVITA_ORR
  }

  async anteprima(tenantId: string, r: RichiestaOrr): Promise<AnteprimaOrr> {
    const file: AnteprimaFileOrr[] = []
    const generali = new Map<string, AvvisoTracciato>()
    // Una attivita' alla volta: ognuna rilegge i movimenti e i dettagli della sede.
    for (const attivita of this.attivita(r)) {
      const a = await this.tracciato.anteprima(tenantId, {
        consorzio: 'ORR',
        unitaLocaleId: r.unitaLocaleId,
        da: r.da,
        a: r.a,
        parametri: { attivita },
      })
      if (a.numeroRecord > 0) {
        file.push({ ...a, attivita })
      } else {
        for (const v of a.avvisi) {
          if (v.bloccante && !CODICI_FILE_VUOTO.has(v.codice)) {
            generali.set(`${v.codice}\u0000${v.messaggio}`, v)
          }
        }
      }
    }
    const avvisiGenerali = [...generali.values()]
    const bloccanti = avvisiGenerali.length > 0 || file.some(f => f.bloccanti)
    return {
      unitaLocaleId: r.unitaLocaleId,
      periodo: { da: r.da, a: r.a },
      file,
      avvisiGenerali,
      bloccanti,
      nessunDato: file.length === 0 && avvisiGenerali.length === 0,
    }
  }

  async genera(
    tenantId: string,
    utenteId: string,
    r: RichiestaOrr
  ): Promise<ComunicazioneOrrVista[]> {
    const anteprima = await this.anteprima(tenantId, r)
    if (anteprima.nessunDato) {
      throw new ComunicazioneConBloccantiError([
        {
          codice: 'NESSUN_DATO',
          messaggio: 'Non ci sono dati da comunicare.',
          movimentoIds: [],
        },
      ])
    }
    // Nessun file se c'e' anche un solo errore bloccante (D14).
    if (anteprima.bloccanti) {
      const bloccanti: AvvisoTracciato[] = [
        ...anteprima.avvisiGenerali,
        ...anteprima.file.flatMap(f => f.avvisi.filter(a => a.bloccante)),
      ]
      throw new ComunicazioneConBloccantiError(bloccanti)
    }
    const viste: ComunicazioneOrrVista[] = []
    for (const f of anteprima.file) {
      const v = await this.tracciato.genera(tenantId, utenteId, {
        consorzio: 'ORR',
        unitaLocaleId: r.unitaLocaleId,
        da: r.da,
        a: r.a,
        parametri: { attivita: f.attivita },
      })
      viste.push({ ...v, attivita: f.attivita })
    }
    return viste
  }

  async elenca(
    tenantId: string,
    f: { unitaLocaleId?: string; da?: string; a?: string }
  ): Promise<ComunicazioneOrrVista[]> {
    const righe = await this.tracciato.elenca(tenantId, { consorzio: 'ORR', ...f })
    // Il servizio generico calcola «modificata dopo l'invio» solo con sede e periodo esatti nel
    // filtro: per le comunicazioni inviate lo si rilegge periodo per periodo, cosi' lo storico di
    // una sede mostra anche i file cambiati dopo l'invio.
    const sostituti = new Map<string, ComunicazioneTracciatoVista>()
    if (f.unitaLocaleId && (!f.da || !f.a)) {
      const periodi = new Map<string, { da: string; a: string }>()
      for (const r of righe) {
        if (r.stato === 'INVIATA')
          periodi.set(`${r.periodoDa}|${r.periodoA}`, { da: r.periodoDa, a: r.periodoA })
      }
      for (const p of periodi.values()) {
        const esatte = await this.tracciato.elenca(tenantId, {
          consorzio: 'ORR',
          unitaLocaleId: f.unitaLocaleId,
          da: p.da,
          a: p.a,
        })
        for (const v of esatte) sostituti.set(v.id, v)
      }
    }
    return righe.map(v => ({
      ...(sostituti.get(v.id) ?? v),
      attivita: attivitaDelTracciato(v.tracciato),
    }))
  }
}
