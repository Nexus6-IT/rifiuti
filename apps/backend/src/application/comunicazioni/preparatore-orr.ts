import { Injectable } from '@nestjs/common'
import { eGiornoDiCalendario } from '../../core/time/anno-italiano'
import type { ConfigurazioneOrr } from '../../domain/comunicazioni/configurazione-sede'
import {
  ATTIVITA_ORR,
  type AttivitaOrr,
  VERSIONE_ORR,
} from '../../domain/comunicazioni/orr/costanti'
import { codiceUnitaLocaleOrr, nomeFileOrr } from '../../domain/comunicazioni/orr/nome-file'
import type { DatiFileOrr } from '../../domain/comunicazioni/orr/record-orr'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type {
  ContestoPreparazione,
  PreparatoreTracciato,
  PreparazioneTracciato,
  RichiestaComunicazione,
} from './comunicazioni-tracciato.port'
import { chiaveComune, costruisciFileOrr, type ExtraPreparazioneOrr } from './costruisci-file-orr'

/**
 * Preparatore O.R.R. Campania (4.9f D3): un file per (sede, attivita'), solo mesi interi dello
 * stesso anno. Tutti i movimenti vigenti della sede (D1): niente marcatura. La logica sta in
 * `costruisciFileOrr` (pura); qui si leggono i pochi dati che il contesto non porta.
 */

const PREFISSO_TRACCIATO = 'xrec718-'

/** Ultimo giorno del mese di un giorno `AAAA-MM-GG`. */
function ultimoGiornoDelMese(giorno: string): string {
  const anno = Number(giorno.slice(0, 4))
  const mese = Number(giorno.slice(5, 7))
  return new Date(Date.UTC(anno, mese, 0)).toISOString().slice(0, 10)
}

export function attivitaDaParametri(
  parametri: Readonly<Record<string, string>> | undefined
): AttivitaOrr | null {
  const a = parametri?.attivita
  return ATTIVITA_ORR.includes(a as AttivitaOrr) ? (a as AttivitaOrr) : null
}

/** Errori della richiesta O.R.R.: attivita' valida, mesi interi, stesso anno (D13). */
export function validaRichiestaOrr(r: RichiestaComunicazione): string[] {
  const errori: string[] = []
  if (attivitaDaParametri(r.parametri) === null) {
    errori.push(`attività non valida: una fra ${ATTIVITA_ORR.join(', ')}`)
  }
  if (!eGiornoDiCalendario(r.da) || !eGiornoDiCalendario(r.a)) return errori
  if (r.da.slice(0, 4) !== r.a.slice(0, 4)) {
    errori.push('il periodo deve stare in un solo anno')
  }
  if (r.da.slice(8, 10) !== '01') errori.push('il periodo deve iniziare il primo giorno di un mese')
  if (r.a !== ultimoGiornoDelMese(r.a)) {
    errori.push('il periodo deve finire l’ultimo giorno di un mese')
  }
  return errori
}

@Injectable()
export class PreparatoreOrr implements PreparatoreTracciato<DatiFileOrr, ConfigurazioneOrr> {
  readonly consorzio = 'ORR'
  readonly versione = VERSIONE_ORR
  readonly selezione = { tipo: 'TUTTI' } as const
  readonly configurazione = 'ORR' as const
  readonly datiTracciato = 'ORR' as const
  readonly differenzeDaWinWaste = [
    'Con anche un solo errore bloccante non si genera nessun file, come in WinWaste; in più un carattere fuori da Windows-1252 è bloccante (WinWaste non lo controlla).',
    'Campi vuoti: campo di soli spazi (WinWaste scrive uno spazio e poi riempie); i quirk di riempimento di c3 (4) e c10 (45) non si copiano.',
    'Autodemolitore (AUT): i dati di pedana (calcolapedan) non esistono in WasteFlow, il file AUT è bloccante.',
    'Detentore privato: non si deduce; un movimento senza il produttore sul FIR è bloccante.',
    'Lettera di trasmissione ai Settori Provinciali ed export Excel di controllo: fuori ambito (l’anteprima sostituisce l’Excel).',
    'Vecchie comunicazioni (dichiarazione periodica tipi 1 e 2, OLDelabcampania): fuori ambito.',
  ]
  readonly inferenze = [
    'CODIFICA_ORR = windows-1252 (ANSI di sistema di VB6, non verificato)',
    'FINE_RIGA_ORR = CRLF dentro i 718 caratteri del record (non verificato)',
    'MOLTIPLICATORE_QUANTITA_ORR = 1000: la quantità è kg x 1000 su 11 cifre, cioè grammi (unità non verificata)',
    'codiceUnitaLocaleOrr(): codice sede nel nome file = progressivo MUD a 4 cifre (in WinWaste la parte dopo il punto del codice unità locale)',
    'nomeFileOrr(): <iniziale provincia><sede><mese finale><aa><attività>.txt con mesi GE..DI; esempio ricostruito, non letto da un file reale',
    'tipoImpiantoDestinatario() (e13): per i trasportatori derivato dal codice operazione (D->SMA, R->REC, R13/D15->STO); per gli altri dichiaranti il tipo impianto della sede',
    'tipoDetentore() (c13): PRO per ogni produttore di terzi (WinWaste legge il tipo impianto della sua unità locale)',
    'Campi riservati scritti come 00000000 (c4, c8, d4, d8, e3, e7) anche quando il soggetto manca',
    'Il codice del produttore/trasportatore/destinatario è la partita IVA se presente, altrimenti il codice fiscale',
  ]

  constructor(private readonly prisma: PrismaService) {}

  nomeTracciato(parametri: Readonly<Record<string, string>>): string {
    const a = attivitaDaParametri(parametri)
    if (a === null) throw new RangeError('attività O.R.R. mancante')
    return `${PREFISSO_TRACCIATO}${a}`
  }

  parametriDaTracciato(tracciato: string): Record<string, string> {
    return tracciato.startsWith(PREFISSO_TRACCIATO)
      ? { attivita: tracciato.slice(PREFISSO_TRACCIATO.length) }
      : {}
  }

  validaRichiesta(r: RichiestaComunicazione): string[] {
    return validaRichiestaOrr(r)
  }

  contaRecord(dati: DatiFileOrr): number {
    return dati.record.length
  }

  nomeFile(
    ctx: {
      unita: { provincia: string | null; progressivoMud: number | null }
      periodo: { da: string; a: string }
      parametri: Readonly<Record<string, string>>
    },
    dati: DatiFileOrr
  ): string {
    const codice = codiceUnitaLocaleOrr(ctx.unita.progressivoMud)
    if (codice === null) throw new RangeError('progressivo MUD della sede mancante')
    return nomeFileOrr(
      ctx.unita.provincia ?? '',
      codice,
      Number(ctx.periodo.a.slice(5, 7)),
      Number(ctx.periodo.a.slice(0, 4)),
      dati.attivita
    )
  }

  async prepara(
    ctx: ContestoPreparazione<ConfigurazioneOrr>
  ): Promise<PreparazioneTracciato<DatiFileOrr>> {
    const extra = await this.leggiExtra(ctx)
    return costruisciFileOrr(ctx, extra)
  }

  /** Dati che il contesto non porta: indirizzo dell'azienda, autorizzazione dell'impianto, ISTAT dei comuni. */
  private async leggiExtra(
    ctx: ContestoPreparazione<ConfigurazioneOrr>
  ): Promise<ExtraPreparazioneOrr> {
    const { tenantId, configurazione: cfg } = ctx
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { address: true, civico: true, city: true, province: true, postalCode: true },
    })
    const sedeLegalePropria = {
      indirizzo: tenant.address,
      civico: tenant.civico,
      cap: tenant.postalCode,
      comune: tenant.city,
      provincia: tenant.province,
    }

    // Autorizzazione dell'impianto: quella scelta; altrimenti, solo se «usa predefinite» e unica.
    let autorizzazionePropria: ExtraPreparazioneOrr['autorizzazionePropria'] = null
    let autorizzazioneAmbigua = false
    const comeGiorno = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
    if (cfg.autorizzazioneImpiantoId) {
      const a = await this.prisma.autorizzazioneImpianto.findFirst({
        where: { id: cfg.autorizzazioneImpiantoId, tenantId },
        select: { estremi: true, dataRilascio: true },
      })
      if (a) autorizzazionePropria = { estremi: a.estremi, data: comeGiorno(a.dataRilascio) }
    } else if (cfg.usaAutorizzazioniPredefinite) {
      const tutte = await this.prisma.autorizzazioneImpianto.findMany({
        where: { tenantId },
        select: { estremi: true, dataRilascio: true },
        take: 2,
        orderBy: { id: 'asc' },
      })
      if (tutte.length === 1)
        autorizzazionePropria = {
          estremi: tutte[0].estremi,
          data: comeGiorno(tutte[0].dataRilascio),
        }
      else autorizzazioneAmbigua = tutte.length > 1
    }

    // ISTAT per nome e provincia: una sola query per tutti i comuni coinvolti (sedi di terzi senza
    // codice forzato, sede legale e sede dell'azienda).
    const comuni = new Map<string, { nome: string; sigla: string }>()
    const aggiungi = (nome: string | null | undefined, sigla: string | null | undefined) => {
      const n = nome?.trim()
      const s = sigla?.trim().toUpperCase()
      if (n && s) comuni.set(chiaveComune(n, s), { nome: n, sigla: s })
    }
    aggiungi(tenant.city, tenant.province)
    aggiungi(ctx.unita.comune, ctx.unita.provincia)
    for (const s of ctx.dettagli.sedi.values()) {
      if (!s.anagrafica?.codiceIstatComune) aggiungi(s.comune, s.provincia)
    }
    const istatPerComune = new Map<string, string>()
    if (comuni.size > 0) {
      const righe = await this.prisma.istatComune.findMany({
        where: {
          OR: [...comuni.values()].map(c => ({
            name: { equals: c.nome, mode: 'insensitive' as const },
            provinciaSigla: c.sigla,
          })),
        },
        select: { code: true, name: true, provinciaSigla: true },
      })
      const perChiave = new Map<string, Set<string>>()
      for (const r of righe) {
        const k = chiaveComune(r.name, r.provinciaSigla)
        const set = perChiave.get(k) ?? new Set<string>()
        set.add(r.code)
        perChiave.set(k, set)
      }
      // Un comune ambiguo non si risolve: l'utente indica il codice nell'anagrafica.
      for (const [k, codici] of perChiave)
        if (codici.size === 1) istatPerComune.set(k, [...codici][0])
    }
    return { sedeLegalePropria, autorizzazionePropria, autorizzazioneAmbigua, istatPerComune }
  }
}
