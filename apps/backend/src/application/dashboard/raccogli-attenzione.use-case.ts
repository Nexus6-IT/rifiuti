import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
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
 * coperte QUI restano certificato RENTRI e autorizzazioni impianto.
 *
 * Aggiungere una voce nuova è aggiungere un metodo privato che restituisce
 * `VoceAttenzione[]` e includerlo nell'array `raccoglitori` di `raccogli()`
 * — non richiede toccare le voci esistenti.
 */
@Injectable()
export class RaccogliAttenzioneUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async raccogli(tenantId: string): Promise<AttenzioneResult> {
    const raccoglitori: Array<() => Promise<VoceAttenzione[]>> = [
      () => this.voceCertificatoRentri(tenantId),
      () => this.vociAutorizzazioniImpianto(tenantId),
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
    const credenziale = await this.prisma.rentriCredential.findUnique({
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
          azione: { etichetta: 'Verifica credenziali', rotta: '/rentri/credenziali' },
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
          azione: { etichetta: 'Rinnova certificato', rotta: '/rentri/credenziali' },
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
          azione: { etichetta: 'Rinnova certificato', rotta: '/rentri/credenziali' },
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
   */
  private async vociAutorizzazioniImpianto(tenantId: string): Promise<VoceAttenzione[]> {
    const oggi = new Date()
    const limite = new Date(oggi)
    limite.setDate(limite.getDate() + SOGLIA_AVVISO_GIORNI)

    const autorizzazioni = await this.prisma.autorizzazioneImpianto.findMany({
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
        azione: {
          etichetta: 'Vedi autorizzazione',
          rotta: `/impianti/autorizzazioni/${autorizzazione.id}`,
        },
      }
    })
  }
}
