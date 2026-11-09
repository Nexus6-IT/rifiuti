import { APP_INITIALIZER, ApplicationConfig, ErrorHandler, LOCALE_ID, inject } from '@angular/core'
import { registerLocaleData } from '@angular/common'
import localeIt from '@angular/common/locales/it'
import { provideRouter } from '@angular/router'
import { provideHttpClient, withInterceptors } from '@angular/common/http'
import { provideAnimations } from '@angular/platform-browser/animations'
import { MessageService, PrimeNGConfig } from 'primeng/api'
import { routes } from './app.routes'
import { authInterceptor } from './core/interceptors/auth.interceptor'
import { tenantInterceptor } from './core/interceptors/tenant.interceptor'
import { moduloNonAttivoInterceptor } from './core/interceptors/modulo-non-attivo.interceptor'
import { loadingInterceptor } from './core/interceptors/loading.interceptor'
import { applicaTraduzionePrimeng } from './core/config/primeng-it'
import { GlobalErrorHandler } from './core/services/error-handler.service'

// Locale italiana per DecimalPipe/DatePipe/CurrencyPipe: solo VISUALIZZAZIONE (1.250,5; 03/11/2026).
// I campi modificabili non la usano: hanno la direttiva appNumeroIt e il parser condiviso.
registerLocaleData(localeIt, 'it-IT')

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([
        loadingInterceptor,
        authInterceptor,
        tenantInterceptor,
        moduloNonAttivoInterceptor,
      ])
    ),
    provideAnimations(),
    MessageService,
    { provide: LOCALE_ID, useValue: 'it-IT' },
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        const config = inject(PrimeNGConfig)
        return () => applicaTraduzionePrimeng(config)
      },
    },
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
}
