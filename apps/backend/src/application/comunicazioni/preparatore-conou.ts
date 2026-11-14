import { Injectable } from '@nestjs/common'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { validaDatiTracciato, type DatiConou } from '../../domain/comunicazioni/dati-tracciato'
import type { ConfigurazioneConou } from '../../domain/comunicazioni/configurazione-sede'
import {
  NOME_FILE_CONOU,
  PERCENTUALE_OLIO_MASSIMA,
  VERSIONE_CONOU,
} from '../../domain/comunicazioni/conou/costanti'
import {
  atecoConou,
  causaleConou,
  percentualeConou,
  percentualeOlioEffettiva,
  prodottoConou,
  quantitaConou,
} from '../../domain/comunicazioni/conou/derivazioni'
import { scomponiNumeroFir } from '../../domain/comunicazioni/conou/formulario'
import type { DatiFileConou, RigaConou } from '../../domain/comunicazioni/conou/riga-conou'
import { validaRigaConou } from '../../domain/comunicazioni/conou/serializza-conou'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type {
  ContestoPreparazione,
  PreparatoreTracciato,
  PreparazioneTracciato,
  RichiestaComunicazione,
} from './comunicazioni-tracciato.port'
import type { MovimentoOrso } from './lettore-movimenti-orso'
import {
  CatalogoIstat,
  aggregaSegnalazioni,
  ordinaMovimenti,
  progressivoDaNumero,
  sedeLegaleDi,
  soloCifre,
  targaCompatta,
  type SegnalazioneMovimento,
} from './tracciato-comune'

const PERCENTUALE_OLIO_MANCANTE_MAX = PERCENTUALE_OLIO_MASSIMA / 100

const DIFFERENZE = [
  'OLIOtiporif (tabella CER -> prodotti) in WinWaste e` definita e mai usata: qui valida il prodotto e propone il predefinito.',
  'ISTAT del comune di lunghezza 3: WinWaste lo esporta lo stesso su conferma, qui e` un errore bloccante (nessun file con errori noti).',
  'La sostituzione «bonifica» (detentore -> comune di raccolta) non e` dedotta dal movimento: solo con causale B e comune di raccolta indicati esplicitamente.',
  'Valori vuoti: campo di spazi (WinWaste scrive uno spazio e poi riempie, stesso risultato).',
]

const INFERENZE = [
  'CODIFICA_CONOU = windows-1252, terminatore CRLF, nessun BOM (PrintLine VB6 = ANSI di sistema).',
  'NOME_FILE_CONOU = Movi.txt.',
  'PERCENTUALE_OLIO_MASSIMA = 9999 (percentuale x 100 su 4 cifre).',
  'ATECO_PRIVATO_CONOU = 0000 per un privato (persona fisica senza partita IVA).',
  'Protocollo del registro = numero progressivo del movimento nel registro (in WinWaste PROT1).',
  'Serie, numero e anno del formulario ricavati dal numero del FIR come calcolaformu di WinWaste.',
  'Causale: carico = E, scarico = U; B, M, L, D solo per forzatura sul movimento.',
  'Prodotti ammessi per CER (OLIOtiporif): lettere di WinWaste, non verificate sul manuale CONOU.',
  'ISTAT a 9 cifre = 0 + regione (2) + comune (6); regione dalla provincia dell’ISTAT.',
]

/**
 * Preparatore CONOU (4.9c, B5). Compone una riga per movimento marcato CONOU dai dati del
 * lettore (FIR, sede della controparte, anagrafica per le comunicazioni), dalla configurazione della
 * sede e dai dati del movimento; ogni errore del tracciato diventa un avviso BLOCCANTE per movimento
 * con il punto di correzione (D14). Nessun file con un bloccante (Q6).
 */
@Injectable()
export class PreparatoreConou implements PreparatoreTracciato<DatiFileConou, ConfigurazioneConou> {
  readonly consorzio = 'CONOU'
  readonly versione = VERSIONE_CONOU
  readonly selezione = { tipo: 'MARCATI', consorzio: 'CONOU' } as const
  readonly configurazione = 'CONOU' as const
  readonly datiTracciato = 'CONOU' as const
  readonly differenzeDaWinWaste = DIFFERENZE
  readonly inferenze = INFERENZE

  constructor(private readonly prisma: PrismaService) {}

  nomeTracciato(): string {
    return 'Movi2023'
  }

  /** Come in WinWaste il periodo sta nello stesso anno. */
  validaRichiesta(r: RichiestaComunicazione): string[] {
    return r.da.slice(0, 4) === r.a.slice(0, 4)
      ? []
      : ['Il periodo CONOU deve stare nello stesso anno solare.']
  }

  nomeFile(): string {
    return NOME_FILE_CONOU
  }

  contaRecord(dati: DatiFileConou): number {
    return dati.righe.length
  }

  async prepara(
    ctx: ContestoPreparazione<ConfigurazioneConou>
  ): Promise<PreparazioneTracciato<DatiFileConou>> {
    const segn: SegnalazioneMovimento[] = []
    const movimenti = ordinaMovimenti(ctx.movimenti)
    const config = ctx.configurazione

    // Una sola query per i comuni e le province di tutte le sedi coinvolte (nessun N+1).
    const sedi = [...ctx.dettagli.sedi.values()]
    const comuniRaccolta: string[] = []
    const datiPerMovimento = new Map<string, DatiConou>()
    for (const m of movimenti) {
      const grezzo = ctx.dettagli.datiTracciato.get(m.radiceId)
      if (grezzo === undefined || grezzo === null) continue
      const esito = validaDatiTracciato('CONOU', grezzo)
      if (esito.ok) {
        datiPerMovimento.set(m.radiceId, esito.valore)
        if (esito.valore.comuneRaccolta) comuniRaccolta.push(esito.valore.comuneRaccolta.istat)
      } else {
        segn.push({
          codice: 'DATI_TRACCIATO_NON_VALIDI',
          messaggio: `I dati CONOU del movimento non sono validi: ${esito.errori.join('; ')}.`,
          bloccante: true,
          movimento: m,
          correzione: { tipo: 'MOVIMENTO' },
        })
      }
    }
    const istat = await CatalogoIstat.carica(
      this.prisma,
      sedi.map(s => ({
        comune: s.comune,
        provincia: s.provincia,
        codiceIstatForzato: s.anagrafica?.codiceIstatComune ?? null,
      })),
      comuniRaccolta
    )

    const righe: RigaConou[] = []
    const inFile: MovimentoOrso[] = []
    for (const m of movimenti) {
      const nuove: SegnalazioneMovimento[] = []
      const bloc = (
        codice: string,
        messaggio: string,
        correzione: SegnalazioneMovimento['correzione'] = { tipo: 'MOVIMENTO' }
      ) => nuove.push({ codice, messaggio, bloccante: true, movimento: m, correzione })
      const info = (codice: string, messaggio: string) =>
        nuove.push({ codice, messaggio, bloccante: false, movimento: m })

      const d = datiPerMovimento.get(m.radiceId) ?? {}
      const fir = m.firId ? ctx.dettagli.fir.get(m.firId) : undefined
      const scaricoInterno = d.scaricoInterno === true

      // Controparte: il detentore (produttore del FIR) nei carichi, il destinatario negli scarichi.
      const sedeId = m.tipo === 'CARICO' ? fir?.producerSedeId : fir?.receiverSedeId
      const sede = sedeId ? ctx.dettagli.sedi.get(sedeId) : undefined
      if (!sede) {
        bloc(
          'SOGGETTO_NON_IDENTIFICATO',
          m.tipo === 'CARICO'
            ? 'Detentore non identificato: serve un FIR con la sede del produttore.'
            : 'Destinatario non identificato: serve un FIR con la sede del destinatario.'
        )
      }
      const legale = sede ? sedeLegaleDi(sede, ctx.dettagli.sedeLegalePerDitta) : undefined
      const correzioneSede: SegnalazioneMovimento['correzione'] = sede
        ? { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: sede.id }
        : { tipo: 'MOVIMENTO' }

      const cfFir = m.tipo === 'CARICO' ? fir?.producerCodiceFiscale : fir?.receiverCodiceFiscale
      const pivaFir = m.tipo === 'CARICO' ? fir?.producerPartitaIva : fir?.receiverPartitaIva
      const cf = (cfFir?.trim() || sede?.ditta.codiceFiscale || sede?.ditta.partitaIva || '').trim()
      const piva = (sede?.ditta.partitaIva ?? pivaFir ?? '').trim()
      // Persona fisica senza partita IVA = privato (`tipaz = 'P'`): ATECO `0000`.
      const privato = piva === '' && cf.length === 16
      const ateco = atecoConou(
        sede?.anagrafica?.codiceAteco ?? legale?.anagrafica?.codiceAteco,
        privato
      )

      const sedeIstat = sede
        ? istat.risolvi({
            comune: sede.comune,
            provincia: sede.provincia,
            codiceIstatForzato: sede.anagrafica?.codiceIstatComune ?? null,
          })
        : null

      // Bonifica (B): il detentore diventa il comune di raccolta indicato sul movimento.
      const raccolta = d.causale === 'B' ? d.comuneRaccolta : undefined
      const comuneRaccolta = raccolta ? istat.comune(raccolta.istat) : null
      if (raccolta && !comuneRaccolta) {
        bloc(
          'COMUNE_RACCOLTA_SCONOSCIUTO',
          'Il comune di raccolta indicato non e` nel catalogo ISTAT.'
        )
      }
      const istatRiga = comuneRaccolta
        ? istat.risolvi({
            comune: comuneRaccolta.name,
            provincia: comuneRaccolta.provinciaSigla,
            codiceIstatForzato: comuneRaccolta.code,
          })
        : sedeIstat
      if (sede && !istatRiga) {
        bloc(
          'ISTAT_NON_TROVATO',
          'Codice ISTAT del comune o regione non trovati per la sede della controparte.',
          correzioneSede
        )
      }
      if (sede && ateco === null) {
        bloc(
          'ATECO_MANCANTE',
          'Manca il codice ATECO (NN.NN.NN) della sede della controparte.',
          correzioneSede
        )
      }

      const prodotto = prodottoConou(m.cer, d, config)
      if (prodotto.prodotto === null) {
        bloc(
          'PRODOTTO_MANCANTE',
          'Prodotto CONOU non indicato (A, B, C, E, G): indicarlo sul movimento o come predefinito per CER nella configurazione.'
        )
      } else if (prodotto.fuoriTabella) {
        info(
          'PRODOTTO_FUORI_TABELLA',
          'Il prodotto scelto non e` fra quelli ammessi per il CER nella tabella ricavata da WinWaste.'
        )
      }
      const x100 = percentualeConou(percentualeOlioEffettiva(m.cer, d, config))
      if (x100 === null) {
        bloc(
          'PERCENTUALE_OLIO_MANCANTE',
          `Percentuale di olio mancante o fuori da 0,01-${PERCENTUALE_OLIO_MANCANTE_MAX}: indicarla sul movimento o come predefinita per CER nella configurazione.`
        )
      }
      const quantita = quantitaConou(m.kg, scaricoInterno)
      if (quantita === null) {
        bloc(
          'QUANTITA_NON_VALIDA',
          'Quantita in kg non disponibile o nulla (unita non convertibile in kg).'
        )
      }

      const formu = d.formulario ?? scomponiNumeroFir(fir?.firNumero ?? m.firNumero)
      const protocollo = progressivoDaNumero(m.numero).n

      const riga: RigaConou = {
        riferimento: m.numero,
        movimentoId: m.id,
        cfDetentore: cf,
        cap: raccolta && comuneRaccolta?.cap ? comuneRaccolta.cap : (sede?.cap ?? ''),
        partitaIva: piva,
        ragioneSociale: comuneRaccolta
          ? `COMUNE DI ${comuneRaccolta.name}`.toUpperCase()
          : (sede?.ditta.ragioneSociale ?? ''),
        indirizzo: raccolta?.indirizzo ?? sede?.via ?? '',
        civico: raccolta ? (raccolta.civico ?? '-') : (sede?.civico ?? ''),
        provincia: comuneRaccolta?.provinciaSigla ?? sede?.provincia ?? '',
        comune: comuneRaccolta?.name ?? sede?.comune ?? '',
        ateco: ateco ?? '',
        istat: istatRiga ? `0${istatRiga.regioneCodice}${istatRiga.istat6}` : '',
        codiceDeposito: config.codiceDeposito ?? '',
        dataRegistrazione: giornoItaliano(m.movementDate),
        serie: formu.serie,
        numero: formu.numero,
        anno: formu.anno,
        dataFormulario: fir ? giornoItaliano(fir.transportDate) : '',
        cfTrasportatore: (
          fir?.carrierCodiceFiscale?.trim() ||
          fir?.trasportatore1?.codiceFiscale?.trim() ||
          fir?.carrierPartitaIva?.trim() ||
          ''
        ).toUpperCase(),
        targa: targaCompatta(fir?.carrierVehiclePlate ?? fir?.trasportatore1?.mezzo),
        cer: soloCifre(m.cer),
        percentualeX100: x100 ?? 0,
        protocollo,
        quantitaKg: quantita ?? 0,
        prodotto: prodotto.prodotto ?? '',
        causale: causaleConou(m.tipo, d.causale),
      }

      // Errori del tracciato per riga, con il movimento (gia' segnalati: non duplicati).
      const gia = new Set(nuove.filter(n => n.bloccante).map(n => n.codice))
      if (gia.size === 0) {
        for (const errore of validaRigaConou(riga)) {
          // Il codice deposito mancante e` gia` un avviso di sede.
          if (!config.codiceDeposito && /deposito/i.test(errore)) continue
          bloc('RIGA_NON_VALIDA', errore, correzioneRiga(errore, correzioneSede))
        }
      }
      segn.push(...nuove)
      righe.push(riga)
      inFile.push(m)
    }

    const avvisi = aggregaSegnalazioni(segn)
    if (!config.codiceDeposito) {
      // Avviso di sede, non di movimento: nessun movimento coinvolto.
      avvisi.unshift({
        codice: 'CODICE_DEPOSITO_MANCANTE',
        messaggio:
          'Manca il codice deposito CONOU della sede (da 3 a 10 caratteri): impostarlo nella configurazione.',
        movimentoIds: [],
        bloccante: true,
        correzione: { tipo: 'CONFIGURAZIONE_SEDE' },
      })
    }
    return { dati: { righe }, avvisi, movimentiInFile: inFile }
  }
}

/** Dove si corregge un errore di riga: i dati della sede se parla della controparte, altrimenti il movimento. */
function correzioneRiga(
  errore: string,
  sede: SegnalazioneMovimento['correzione']
): SegnalazioneMovimento['correzione'] {
  return /Detentore|ISTAT|ATECO|Ragione|Codice Fiscale Detentore/i.test(errore)
    ? sede
    : /deposito/i.test(errore)
      ? { tipo: 'CONFIGURAZIONE_SEDE' }
      : { tipo: 'MOVIMENTO' }
}
