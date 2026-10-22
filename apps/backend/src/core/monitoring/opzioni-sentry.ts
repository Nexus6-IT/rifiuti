import * as Sentry from '@sentry/node'

/** Toglie la query string da un URL (assoluto o relativo). */
function senzaQuery(url: unknown): unknown {
  return typeof url === 'string' ? url.split('?')[0] : url
}

// `Key (colonne)=(valori)` di Postgres: si tengono le colonne, si tolgono i valori. Prima
// si cerca la chiusura seguita da una coda nota di Postgres (i valori possono contenere
// parentesi), altrimenti si arriva all'ultima `)` della riga: meglio togliere troppo.
const CHIAVE_POSTGRES =
  /Key \(([^\n]*?)\)=\((?:[^\n]*?\)(?=\s+(?:already exists|is not present|conflicts with))|[^\n]*\))/g
const RIGA_POSTGRES = /Failing row contains \([^\n]*\)/g
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi
// codice fiscale di persona fisica, anche omocodico
const CODICE_FISCALE =
  /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi
// 11 cifre: partita IVA (o CF numerico), anche col prefisso `IT`
const PARTITA_IVA = /\b(?:IT)?\d{11}\b/g

/**
 * Maschera nel testo i dati personali che PostgreSQL, RENTRI o SMTP possono riportare in un
 * messaggio d'errore: valori di `Key (…)=(…)` e `Failing row contains (…)`, email, codici
 * fiscali e partite IVA. Codici d'errore, nomi di colonna, UUID e hash restano leggibili.
 */
export function mascheraDatiPersonali(testo: string): string {
  return testo
    .replace(CHIAVE_POSTGRES, 'Key ($1)=(***)')
    .replace(RIGA_POSTGRES, 'Failing row contains (***)')
    .replace(EMAIL, '***@***')
    .replace(CODICE_FISCALE, '***CF***')
    .replace(PARTITA_IVA, '***PIVA***')
}

/**
 * Ripulisce un evento prima dell'invio a Bugsink: niente corpo, cookie, header né query
 * string della richiesta, URL tagliati al primo `?` (anche nei breadcrumb), utente ridotto
 * al solo `id`, testo delle eccezioni, messaggi dei breadcrumb ed `extra` senza dati
 * personali; le eccezioni Prisma ridotte a classe e codice. Non lancia mai: su un evento
 * di forma inattesa toglie quello che riesce.
 */
export function ripulisciEventoSentry(
  evento: Sentry.ErrorEvent,
  hint?: Sentry.EventHint
): Sentry.ErrorEvent {
  try {
    const eccezioni = evento.exception?.values
    if (Array.isArray(eccezioni)) {
      const code = (hint?.originalException as { code?: string } | undefined)?.code
      for (const eccezione of eccezioni) {
        if (!eccezione) continue
        if (typeof eccezione.type === 'string' && eccezione.type.startsWith('PrismaClient')) {
          // il messaggio di Prisma riporta il testo di Postgres, con i valori della riga
          eccezione.value = `${eccezione.type}${code ? ' ' + code : ''}`
        } else if (typeof eccezione.value === 'string') {
          eccezione.value = mascheraDatiPersonali(eccezione.value)
        }
      }
    }
  } catch {
    // forma inattesa: si prosegue con il resto
  }
  try {
    if (Array.isArray(evento.breadcrumbs)) {
      for (const breadcrumb of evento.breadcrumbs) {
        if (breadcrumb && typeof breadcrumb.message === 'string') {
          breadcrumb.message = mascheraDatiPersonali(breadcrumb.message)
        }
      }
    }
  } catch {
    // forma inattesa: si prosegue con il resto
  }
  try {
    const extra = evento.extra as Record<string, unknown> | undefined
    if (extra) {
      for (const [chiave, valore] of Object.entries(extra)) {
        if (typeof valore === 'string') extra[chiave] = mascheraDatiPersonali(valore)
      }
    }
  } catch {
    // forma inattesa: si prosegue con il resto
  }
  try {
    const richiesta = evento.request as Record<string, unknown> | undefined
    if (richiesta) {
      delete richiesta.data
      delete richiesta.cookies
      delete richiesta.query_string
      delete richiesta.headers
      if ('url' in richiesta) richiesta.url = senzaQuery(richiesta.url)
    }
  } catch {
    // forma inattesa: si prosegue con il resto
  }
  try {
    if (Array.isArray(evento.breadcrumbs)) {
      for (const breadcrumb of evento.breadcrumbs) {
        const dati = breadcrumb?.data as Record<string, unknown> | undefined
        if (dati && 'url' in dati) dati.url = senzaQuery(dati.url)
        // l'SDK sposta query e fragment in chiavi a parte: vanno tolti anche quelli
        if (dati) {
          delete dati['http.query']
          delete dati['http.fragment']
        }
      }
    }
  } catch {
    // forma inattesa: si prosegue con il resto
  }
  try {
    if (evento.user) {
      const id = evento.user.id
      if (id === undefined || id === null) delete evento.user
      else evento.user = { id }
    }
  } catch {
    // forma inattesa
  }
  return evento
}

/**
 * Opzioni di Sentry.init per Bugsink. Niente tracing e niente dati personali
 * (Decisione 5 della Fase 0): corpo, header, cookie, IP e query string restano fuori.
 */
export function opzioniSentry(env: NodeJS.ProcessEnv): Sentry.NodeOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV ?? 'development',
    release: env.APP_VERSION,
    sendDefaultPii: false,
    integrations: [
      Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }),
      Sentry.requestDataIntegration({
        include: {
          cookies: false,
          data: false,
          headers: false,
          ip: false,
          query_string: false,
          url: true,
        },
      }),
    ],
    beforeSend: ripulisciEventoSentry,
  }
}
