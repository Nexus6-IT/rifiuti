import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { calcolaGiorniAllaScadenzaCertificato } from '../../infrastructure/rentri/rentri-certificato-scadenza.util'
import { calcolaScadenza } from '../notifications/scadenza-controparte.util'

/**
 * Una singola cosa che richiede attenzione oggi, già scritta in italiano
 * pronto da mostrare e con l'azione che porta dove si risolve. Una
 * segnalazione senza via d'uscita è solo ansia: `azione` è opzionale solo
 * per i casi in cui non esiste ancora una pagina dedicata.
 */
export interface VoceAttenzione {
  /** 'certificato-rentri', 'autorizzazione', 'scorta-vidimata', ... */
  chiave: string
  gravita: 'critico' | 'avviso' | 'informativo'
  /** Testo italiano già pronto. */
  titolo: string
  /** «scade fra 12 giorni», «nessun blocco attivo». */
  dettaglio: string
  azione?: { etichetta: string; rotta: string }
}

export interface AttenzioneResult {
  voci: VoceAttenzione[]
}

/**
 * Soglia (in giorni) sotto la quale una scadenza smette di essere solo
 * "futura" e diventa una voce da segnalare in cruscotto. Condivisa fra
 * certificato RENTRI e autorizzazioni impianto: non c'è motivo per cui un
 * tenant debba imparare due soglie diverse per due scadenze concettualmente
 * identiche ("questo documento sta per scadere").
 */
const SOGLIA_AVVISO_GIORNI = 30

const ORDINE_GRAVITA: Record<VoceAttenzione['gravita'], number> = {
  critico: 0,
  avviso: 1,
  informativo: 2,
}

/**
 * Ordina voci di attenzione per gravità (i critici per primi). Esportata
 * perché il controller la riusa per fondere le voci di
 * `RaccogliAttenzioneUseCase` con quelle di `RaccogliIndicatoriAzioneUseCase`
 * (Task 3 del piano cruscotto) in un'unica lista ordinata, senza duplicare
 * la regola di ordinamento in due punti.
 */
export function ordinaVociPerGravita(voci: VoceAttenzione[]): VoceAttenzione[] {
  return [...voci].sort((a, b) => ORDINE_GRAVITA[a.gravita] - ORDINE_GRAVITA[b.gravita])
}

/**
 * Raccoglie in un'unica chiamata le cose che richiedono attenzione oggi per
 * un tenant, già ordinate per gravità (i critici per primi).
 *
 * NOTA SULLA PORTATA: le voci "formulari da trasmettere" e "numeri vidimati
 * pronti" (Task 3 del piano cruscotto, che dipendono da `RentriScortaRepository`
 * — committato in `96a87ca`) vivono in `RaccogliIndicatoriAzioneUseCase`, un
 * file separato: questo file supera già le 150 righe che il piano indica come
 * soglia oltre la quale separare, e `AttenzioneController` fonde le voci dei
 * due use case in un'unica lista ordinata (v. `ordinaVociPerGravita`). Le voci
 * coperte QUI sono le quattro scadenze dello scadenzario: certificato RENTRI,
 * autorizzazioni impianto, iscrizione Albo Gestori del trasportatore e
 * autorizzazione del destinatario.
 *
 * Aggiornamento (rilievo revisione finale, 2026-09-11): coperte QUI anche le
 * altre due scadenze dello scadenzario che mancavano — iscrizione Albo
 * Gestori del trasportatore e autorizzazione del destinatario — perché
 * quando questo file è stato scritto i campi `Trasportatore.scadenzaIscrizione`
 * e `Destinatario.scadenzaAutorizzazione` non esistevano ancora (introdotti in
 * parallelo su `application/notifications`). Riusano `calcolaScadenza`, la
 * stessa funzione condivisa già in uso per le autorizzazioni impianto qui
 * sotto — non una riscrittura locale della formula.
 *
 * Aggiungere una voce nuova è aggiungere un metodo privato che restituisce
 * `VoceAttenzione[]` e includerlo nell'array `raccoglitori` di `raccogli()`
 * — non richiede toccare le voci esistenti.
 *
 * DIFESA IN PROFONDITÀ (rilievo revisione finale, 2026-09-11): tutte le query
 * qui sotto passano da `this.prisma.db.<model>`, il client ESTESO con
 * `rlsExtension` (v. `prisma.service.ts`), non dal client nudo. I filtri
 * espliciti per `tenantId` restano tutti al loro posto — non sono ridondanti,
 * sono la prima linea — ma se uno di essi venisse dimenticato in futuro
 * l'estensione lo inietterebbe comunque, per i `findMany` su
 * `AutorizzazioneImpianto`, `Trasportatore` e `Destinatario`.
 *
 * UNICA ECCEZIONE, e non e' una svista: la `findUnique` su `RentriCredential`
 * resta fuori. `applyTenantScope` lascia apposta `findUnique` invariata
 * (`prisma-rls.extension.ts`), perche' iniettare il `tenantId` romperebbe il
 * vincolo di unicita'. Li' l'isolamento non manca: su quel model il
 * `tenantId` E' la chiave unica, quindi la query e' isolata per costruzione.
 */
@Injectable()
export class RaccogliAttenzioneUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async raccogli(tenantId: string): Promise<AttenzioneResult> {
    const raccoglitori: Array<() => Promise<VoceAttenzione[]>> = [
      () => this.voceCertificatoRentri(tenantId),
      () => this.vociAutorizzazioniImpianto(tenantId),
      () => this.vociTrasportatoriInScadenza(tenantId),
      () => this.vociDestinatariInScadenza(tenantId),
    ]

    const risultati = await Promise.all(raccoglitori.map(raccoglitore => raccoglitore()))
    const voci = ordinaVociPerGravita(risultati.flat())

    return { voci }
  }

  /**
   * Riusa `calcolaGiorniAllaScadenzaCertificato` (Task 1-2 dello
   * scadenzario, stesso calcolo del gauge Prometheus e del job giornaliero
   * di notifica) — non ne riscrive la logica di parsing.
   */
  private async voceCertificatoRentri(tenantId: string): Promise<VoceAttenzione[]> {
    const credenziale = await this.prisma.db.rentriCredential.findUnique({
      where: { tenantId },
      select: { certificatePem: true },
    })

    if (!credenziale) {
      return []
    }

    const giorni = calcolaGiorniAllaScadenzaCertificato(credenziale.certificatePem)

    if (giorni === null) {
      return [
        {
          chiave: 'certificato-rentri',
          gravita: 'critico',
          titolo: 'Certificato RENTRI non leggibile',
          dettaglio:
            "il certificato configurato non è analizzabile: le trasmissioni verso l'ente potrebbero non funzionare",
          azione: { etichetta: 'Verifica credenziali', rotta: '/rentri/certificato' },
        },
      ]
    }

    if (giorni < 0) {
      return [
        {
          chiave: 'certificato-rentri',
          gravita: 'critico',
          titolo: 'Certificato RENTRI scaduto',
          dettaglio: `scaduto da ${Math.abs(giorni)} giorni`,
          azione: { etichetta: 'Rinnova certificato', rotta: '/rentri/certificato' },
        },
      ]
    }

    if (giorni <= SOGLIA_AVVISO_GIORNI) {
      return [
        {
          chiave: 'certificato-rentri',
          gravita: 'avviso',
          titolo: 'Certificato RENTRI in scadenza',
          dettaglio: `scade fra ${giorni} giorni`,
          azione: { etichetta: 'Rinnova certificato', rotta: '/rentri/certificato' },
        },
      ]
    }

    return []
  }

  /**
   * Stesso filtro di `DeadlineCheckerService.checkAuthorizationExpirations`
   * (già scaduta o entro la soglia), ma qui filtrato per `tenantId`: quel
   * job scansiona tutti i tenant (invia email), questo endpoint risponde a
   * UNO alla volta — l'isolamento è obbligatorio.
   *
   * Il calcolo dei giorni alla scadenza riusa `calcolaScadenza` (Task 4
   * dello scadenzario, `scadenza-controparte.util.ts`), non lo riscrive:
   * la stessa formula alimenta anche l'avviso nel form FIR, e due
   * implementazioni indipendenti potrebbero divergere silenziosamente su
   * un dato dichiarato a un ente pubblico.
   *
   * NESSUNA `azione` (rilievo revisione finale, 2026-09-11): non esiste in
   * `app.routes.ts` una pagina di dettaglio per una singola autorizzazione
   * impianto (`/impianti/...` non esiste affatto, il catch-all reindirizza
   * alla dashboard). Un collegamento che ricarica la pagina su se stessa è
   * peggio di nessun collegamento — promette una via d'uscita e la nega.
   * `azione` è opzionale esattamente per questo caso.
   */
  private async vociAutorizzazioniImpianto(tenantId: string): Promise<VoceAttenzione[]> {
    const oggi = new Date()
    const limite = new Date(oggi)
    limite.setDate(limite.getDate() + SOGLIA_AVVISO_GIORNI)

    const autorizzazioni = await this.prisma.db.autorizzazioneImpianto.findMany({
      where: {
        tenantId,
        dataScadenza: { not: null, lte: limite },
      },
    })

    return autorizzazioni.map(autorizzazione => {
      const { giorniAllaScadenza, scaduta } = calcolaScadenza(autorizzazione.dataScadenza, oggi)
      // `dataScadenza` è garantita non nulla dal filtro Prisma sopra, quindi
      // `giorniAllaScadenza` non è mai `null` qui (lo sarebbe solo per
      // un'anagrafica senza scadenza valorizzata).
      const giorni = giorniAllaScadenza as number

      return {
        chiave: 'autorizzazione',
        gravita: scaduta ? 'critico' : 'avviso',
        titolo: scaduta
          ? `Autorizzazione ${autorizzazione.estremi} scaduta`
          : `Autorizzazione ${autorizzazione.estremi} in scadenza`,
        dettaglio: scaduta ? `scaduta da ${Math.abs(giorni)} giorni` : `scade fra ${giorni} giorni`,
      }
    })
  }

  /**
   * Iscrizione all'Albo Gestori Ambientali del trasportatore
   * (`Trasportatore.scadenzaIscrizione`, Task 3 dello scadenzario). Stesso
   * schema delle autorizzazioni impianto sopra — stessa soglia, stessa
   * `calcolaScadenza` — ma qui l'azione ESISTE: `/trasportatori` è una rotta
   * reale dell'app (elenco, non dettaglio: non esiste una pagina per singolo
   * trasportatore, quindi il collegamento porta all'elenco dove l'operatore
   * può cercarlo).
   */
  private async vociTrasportatoriInScadenza(tenantId: string): Promise<VoceAttenzione[]> {
    const oggi = new Date()
    const limite = new Date(oggi)
    limite.setDate(limite.getDate() + SOGLIA_AVVISO_GIORNI)

    const trasportatori = await this.prisma.db.trasportatore.findMany({
      where: {
        tenantId,
        scadenzaIscrizione: { not: null, lte: limite },
      },
      // Il nome è quello della ditta (D10)
      include: { ditta: { select: { ragioneSociale: true } } },
    })

    return trasportatori.map(trasportatore => {
      const { giorniAllaScadenza, scaduta } = calcolaScadenza(
        trasportatore.scadenzaIscrizione,
        oggi
      )
      // Garantito non nullo dal filtro Prisma sopra.
      const giorni = giorniAllaScadenza as number

      return {
        chiave: 'trasportatore-iscrizione',
        gravita: scaduta ? 'critico' : 'avviso',
        titolo: scaduta
          ? `Iscrizione Albo scaduta — ${trasportatore.ditta.ragioneSociale}`
          : `Iscrizione Albo in scadenza — ${trasportatore.ditta.ragioneSociale}`,
        dettaglio: scaduta ? `scaduta da ${Math.abs(giorni)} giorni` : `scade fra ${giorni} giorni`,
        azione: { etichetta: 'Vedi trasportatori', rotta: '/trasportatori' },
      }
    })
  }

  /**
   * Autorizzazione allo smaltimento/recupero del destinatario
   * (`Destinatario.scadenzaAutorizzazione`, Task 3 dello scadenzario). Stesso
   * schema del collettore gemello sopra: `/destinatari` è una rotta reale
   * (elenco, non dettaglio — stesso motivo).
   */
  private async vociDestinatariInScadenza(tenantId: string): Promise<VoceAttenzione[]> {
    const oggi = new Date()
    const limite = new Date(oggi)
    limite.setDate(limite.getDate() + SOGLIA_AVVISO_GIORNI)

    const destinatari = await this.prisma.db.destinatario.findMany({
      where: {
        tenantId,
        scadenzaAutorizzazione: { not: null, lte: limite },
      },
      include: { ditta: { select: { ragioneSociale: true } } },
    })

    return destinatari.map(destinatario => {
      const { giorniAllaScadenza, scaduta } = calcolaScadenza(
        destinatario.scadenzaAutorizzazione,
        oggi
      )
      // Garantito non nullo dal filtro Prisma sopra.
      const giorni = giorniAllaScadenza as number

      return {
        chiave: 'destinatario-autorizzazione',
        gravita: scaduta ? 'critico' : 'avviso',
        titolo: scaduta
          ? `Autorizzazione scaduta — ${destinatario.ditta.ragioneSociale}`
          : `Autorizzazione in scadenza — ${destinatario.ditta.ragioneSociale}`,
        dettaglio: scaduta ? `scaduta da ${Math.abs(giorni)} giorni` : `scade fra ${giorni} giorni`,
        azione: { etichetta: 'Vedi destinatari', rotta: '/destinatari' },
      }
    })
  }
}
