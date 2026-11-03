import { ApplicationConfig, ErrorHandler, LOCALE_ID } from '@angular/core'
import { registerLocaleData } from '@angular/common'
import localeIt from '@angular/common/locales/it'
import { provideRouter } from '@angular/router'
import { provideHttpClient, withInterceptors } from '@angular/common/http'
import { provideAnimations } from '@angular/platform-browser/animations'
import { MessageService } from 'primeng/api'
import { routes } from './app.routes'
import { authInterceptor } from './core/interceptors/auth.interceptor'
import { tenantInterceptor } from './core/interceptors/tenant.interceptor'
import { loadingInterceptor } from './core/interceptors/loading.interceptor'
import { GlobalErrorHandler } from './core/services/error-handler.service'

// Locale italiana per DecimalPipe/DatePipe/CurrencyPipe: solo VISUALIZZAZIONE (1.250,5; 03/11/2026).
// I campi modificabili non la usano: hanno la direttiva appNumeroIt e il parser condiviso.
registerLocaleData(localeIt, 'it-IT')

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([loadingInterceptor, authInterceptor, tenantInterceptor])),
    provideAnimations(),
    MessageService,
    { provide: LOCALE_ID, useValue: 'it-IT' },
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
}
