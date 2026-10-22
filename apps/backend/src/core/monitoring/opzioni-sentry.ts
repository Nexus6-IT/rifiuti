import * as Sentry from '@sentry/node'

/** Toglie la query string da un URL (assoluto o relativo). */
function senzaQuery(url: unknown): unknown {
  return typeof url === 'string' ? url.split('?')[0] : url
}

/**
 * Ripulisce un evento prima dell'invio a Bugsink: niente corpo, cookie, header né query
 * string della richiesta, URL tagliati al primo `?` (anche nei breadcrumb), utente ridotto
 * al solo `id`. Non lancia mai: su un evento di forma inattesa toglie quello che riesce.
 */
export function ripulisciEventoSentry(evento: Sentry.ErrorEvent): Sentry.ErrorEvent {
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
