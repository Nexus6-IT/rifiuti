import { bootstrapApplication } from '@angular/platform-browser'
import * as Sentry from '@sentry/angular'
import { AppComponent } from './app/app.component'
import { appConfig } from './app/app.config'
import { environment } from './environments/environment'

// Error tracking Bugsink/Sentry — no-op se sentryDsn è vuoto.
if (environment.sentryDsn) {
  Sentry.init({
    dsn: environment.sentryDsn,
    environment: environment.production ? 'production' : 'development',
    // Campionamento 100% (Bugsink self-hosted: nessun costo di evento)
    tracesSampleRate: 1.0,
  })
}

bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err))
