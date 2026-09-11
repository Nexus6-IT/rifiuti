import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { calcolaGiorniAllaScadenzaCertificato } from '../../infrastructure/rentri/rentri-certificato-scadenza.util'

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
 * Raccoglie in un'unica chiamata le cose che richiedono attenzione oggi per
 * un tenant, già ordinate per gravità (i critici per primi).
 *
 * NOTA SULLA PORTATA (decisione del PO, non svista): il piano originale
 * prevedeva anche le voci "scorta di numeri vidimati esaurita o sotto
 * soglia" e "nessun blocco attivo", che dipendono da `RentriScortaRepository`.
 * Quel repository esiste nell'albero di lavoro ma non è tracciato da git in
 * questo momento (altro lavoro in corso in parallelo): importarlo qui
 * produrrebbe un commit rotto per chiunque clonasse il ramo senza quei file
 * non tracciati. Le voci coperte in questo task sono solo quelle che
 * poggiano su codice già committato: certificato RENTRI e autorizzazioni
 * impianto.
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
    const voci = risultati
      .flat()
      .sort((a, b) => ORDINE_GRAVITA[a.gravita] - ORDINE_GRAVITA[b.gravita])

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
      const dataScadenza = autorizzazione.dataScadenza as Date
      const giorni = Math.ceil((dataScadenza.getTime() - oggi.getTime()) / (1000 * 60 * 60 * 24))
      const scaduta = giorni < 0

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
