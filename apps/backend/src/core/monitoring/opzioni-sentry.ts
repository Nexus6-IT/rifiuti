import * as Sentry from '@sentry/node'

/** Toglie la query string da un URL (assoluto o relativo). */
function senzaQuery(url: unknown): unknown {
  return typeof url === 'string' ? url.split('?')[0] : url
}

/** URL senza query string e con il percorso mascherato (può contenere un CF). */
function urlRipulito(url: unknown): unknown {
  const ridotto = senzaQuery(url)
  return typeof ridotto === 'string' ? mascheraDatiPersonali(ridotto) : ridotto
}

// `Key (colonne)=(valori)` di Postgres: si tengono le colonne, si tolgono i valori. Prima
// si cerca la chiusura seguita da una coda nota di Postgres (i valori possono contenere
// parentesi), altrimenti si arriva all'ultima `)` della riga: meglio togliere troppo.
const CHIAVE_POSTGRES =
  /Key \(([^\n]*?)\)=\((?:[^\n]*?\)(?=\s+(?:already exists|is not present|conflicts with))|[^\n]*\))/g
const RIGA_POSTGRES = /Failing row contains \([^\n]*\)/g
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi
// Codice fiscale di persona fisica, anche omocodico. I confini sono "niente lettera o cifra
// accanto" invece di `\b`, così il valore viene preso anche accanto a `_` (nomi di file),
// ma non dentro un hash o un identificativo più lungo.
const CODICE_FISCALE =
  /(?<![A-Z0-9])[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z](?![A-Z0-9])/gi
// 11 cifre: partita IVA (o CF numerico), anche col prefisso `IT`/`it`
const PARTITA_IVA = /(?<![A-Z0-9])(?:IT)?\d{11}(?![A-Z0-9])/gi

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

// Oltre questa profondità il contenuto di `extra` non viene inviato: non si può mandare
// in chiaro quello che non si è guardato.
const PROFONDITA_MASSIMA = 10
const TROPPO_PROFONDO = '[omesso: troppo profondo]'

/**
 * Copia di `valore` con ogni stringa mascherata, a qualunque profondità. I cicli tornano
 * sulla copia già fatta; oltre {@link PROFONDITA_MASSIMA} il contenuto è omesso.
 */
function mascheraInProfondita(
  valore: unknown,
  profondita = 0,
  copie: WeakMap<object, unknown> = new WeakMap()
): unknown {
  if (typeof valore === 'string') return mascheraDatiPersonali(valore)
  if (valore === null || typeof valore !== 'object') return valore
  const giaFatta = copie.get(valore)
  if (giaFatta !== undefined) return giaFatta
  if (profondita >= PROFONDITA_MASSIMA) return TROPPO_PROFONDO
  if (Array.isArray(valore)) {
    const copia: unknown[] = []
    copie.set(valore, copia)
    for (const elemento of valore) copia.push(mascheraInProfondita(elemento, profondita + 1, copie))
    return copia
  }
  const copia: Record<string, unknown> = {}
  copie.set(valore, copia)
  for (const [chiave, interno] of Object.entries(valore)) {
    copia[chiave] = mascheraInProfondita(interno, profondita + 1, copie)
  }
  return copia
}

type ErroreQualsiasi = Record<string, unknown>

/** L'errore e le sue `cause`, al massimo 10 livelli, senza cadere sui cicli. */
function catenaDiCause(errore: unknown): ErroreQualsiasi[] {
  const catena: ErroreQualsiasi[] = []
  let corrente = errore
  while (
    corrente &&
    typeof corrente === 'object' &&
    !catena.includes(corrente as ErroreQualsiasi) &&
    catena.length < 10
  ) {
    catena.push(corrente as ErroreQualsiasi)
    corrente = (corrente as ErroreQualsiasi).cause
  }
  return catena
}

/** Nome con cui l'SDK riporta l'errore in `exception.values[].type`. */
function nomeErrore(errore: ErroreQualsiasi): unknown {
  return typeof errore.name === 'string' ? errore.name : errore.constructor?.name
}

/**
 * Descrizione di un errore Prisma senza dati: classe, codice `Pnnnn` e, per P2010 (raw
 * query fallita), SQLSTATE e nome del vincolo di Postgres. Il testo libero non passa mai:
 * ogni pezzo deve avere la forma attesa, altrimenti viene lasciato fuori.
 */
function descriviErrorePrisma(tipo: string, errore: ErroreQualsiasi | undefined): string {
  const parti = [tipo]
  const code = errore?.code
  if (typeof code === 'string' && /^P\d{4}$/.test(code)) {
    parti.push(code)
    const meta = errore?.meta as ErroreQualsiasi | undefined
    if (code === 'P2010' && meta) {
      const dettagli: string[] = []
      if (typeof meta.code === 'string' && /^[0-9A-Z]{5}$/.test(meta.code)) {
        dettagli.push(`SQLSTATE ${meta.code}`)
      }
      const vincolo =
        typeof meta.message === 'string'
          ? /constraint "([A-Za-z0-9_.$]+)"/.exec(meta.message)?.[1]
          : undefined
      if (vincolo) dettagli.push(`vincolo ${vincolo}`)
      if (dettagli.length) parti.push(dettagli.join(', '))
    }
  }
  return mascheraDatiPersonali(parti.join(' '))
}

/**
 * Toglie il testo delle eccezioni che non si è riusciti a mascherare; se nemmeno questo
 * riesce, toglie le eccezioni (resta l'evento, con il resto già ripulito).
 */
function togliTestoEccezioni(evento: Sentry.ErrorEvent): void {
  try {
    for (const eccezione of evento.exception?.values ?? []) {
      if (eccezione) delete (eccezione as { value?: unknown }).value
    }
  } catch {
    delete evento.exception
  }
}

/**
 * Ripulisce un evento prima dell'invio a Bugsink: niente corpo, cookie, header né query
 * string della richiesta, URL tagliati al primo `?` e con il percorso mascherato (anche nei
 * breadcrumb e in `transaction`), utente ridotto al solo `id`, testo delle eccezioni,
 * `message`/`logentry`, messaggi dei breadcrumb ed `extra` (a ogni profondità) senza dati
 * personali; le eccezioni Prisma ridotte a classe e codice. Non lancia mai: su un evento
 * di forma inattesa la parte che non si riesce a ripulire si toglie (fail closed), non parte
 * così com'è.
 */
export function ripulisciEventoSentry(
  evento: Sentry.ErrorEvent,
  hint?: Sentry.EventHint
): Sentry.ErrorEvent {
  try {
    const eccezioni = evento.exception?.values
    if (Array.isArray(eccezioni)) {
      const catena = catenaDiCause(hint?.originalException)
      for (const eccezione of eccezioni) {
        if (!eccezione) continue
        if (typeof eccezione.type === 'string' && eccezione.type.startsWith('PrismaClient')) {
          // il messaggio di Prisma riporta il testo di Postgres, con i valori della riga;
          // il codice si prende dall'errore della catena che ha proprio questo tipo
          const errore = catena.find(e => nomeErrore(e) === eccezione.type)
          eccezione.value = descriviErrorePrisma(eccezione.type, errore)
        } else if (typeof eccezione.value === 'string') {
          eccezione.value = mascheraDatiPersonali(eccezione.value)
        }
      }
    }
  } catch {
    // forma inattesa: senza il testo, che non si è potuto mascherare (fail closed)
    togliTestoEccezioni(evento)
  }
  try {
    // l'SDK riempie `message` quando viene lanciato un valore che non è un Error
    const conMessaggio = evento as { message?: unknown; logentry?: unknown }
    if (conMessaggio.message !== undefined) {
      conMessaggio.message = mascheraInProfondita(conMessaggio.message)
    }
    if (conMessaggio.logentry !== undefined) {
      conMessaggio.logentry = mascheraInProfondita(conMessaggio.logentry)
    }
  } catch {
    // forma inattesa: si tolgono invece di mandarli in chiaro (fail closed)
    const conMessaggio = evento as { message?: unknown; logentry?: unknown }
    delete conMessaggio.message
    delete conMessaggio.logentry
  }
  try {
    if (typeof evento.transaction === 'string') {
      // senza tracing il nome è "METODO /percorso" della richiesta vera
      evento.transaction = urlRipulito(evento.transaction) as string
    }
  } catch {
    // forma inattesa: si toglie invece di mandarla in chiaro (fail closed)
    delete evento.transaction
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
    // forma inattesa: si tolgono invece di mandarli in chiaro (fail closed)
    delete evento.breadcrumbs
  }
  try {
    // compreso `extra.__serialized__`, che l'SDK aggiunge per un oggetto lanciato
    if (evento.extra)
      evento.extra = mascheraInProfondita(evento.extra) as Sentry.ErrorEvent['extra']
  } catch {
    // forma inattesa: si toglie invece di mandarlo in chiaro (fail closed)
    delete evento.extra
  }
  try {
    const richiesta = evento.request as Record<string, unknown> | undefined
    if (richiesta) {
      delete richiesta.data
      delete richiesta.cookies
      delete richiesta.query_string
      delete richiesta.headers
      if ('url' in richiesta) richiesta.url = urlRipulito(richiesta.url)
    }
  } catch {
    // forma inattesa: si toglie invece di mandarla in chiaro (fail closed)
    delete evento.request
  }
  try {
    if (Array.isArray(evento.breadcrumbs)) {
      for (const breadcrumb of evento.breadcrumbs) {
        const dati = breadcrumb?.data as Record<string, unknown> | undefined
        if (dati && 'url' in dati) dati.url = urlRipulito(dati.url)
        // l'SDK sposta query e fragment in chiavi a parte: vanno tolti anche quelli
        if (dati) {
          delete dati['http.query']
          delete dati['http.fragment']
        }
      }
    }
  } catch {
    // forma inattesa: si tolgono invece di mandarli in chiaro (fail closed)
    delete evento.breadcrumbs
  }
  try {
    if (evento.user) {
      const id = evento.user.id
      if (id === undefined || id === null) delete evento.user
      else evento.user = { id }
    }
  } catch {
    // forma inattesa: si toglie invece di mandarlo in chiaro (fail closed)
    delete evento.user
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
