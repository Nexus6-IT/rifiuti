import { Injectable, ErrorHandler } from '@angular/core'
import { HttpErrorResponse } from '@angular/common/http'
import { MessageService } from 'primeng/api'

@Injectable({
  providedIn: 'root',
})
export class GlobalErrorHandler implements ErrorHandler {
  constructor(private messageService: MessageService) {}

  handleError(error: Error | HttpErrorResponse): void {
    console.error('Global error caught:', error)

    if (error instanceof HttpErrorResponse) {
      // HTTP Error
      this.handleHttpError(error)
    } else {
      // Client Error
      this.handleClientError(error)
    }
  }

  private handleHttpError(error: HttpErrorResponse): void {
    let errorMessage = 'Si è verificato un errore'

    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Errore: ${error.error.message}`
    } else {
      // Server-side error
      switch (error.status) {
        case 0:
          errorMessage = 'Impossibile raggiungere il server'
          break
        case 400:
          errorMessage = error.error?.message || 'Richiesta non valida'
          break
        case 401:
          errorMessage = 'Non autorizzato. Effettua il login'
          break
        case 403:
          errorMessage = 'Accesso negato'
          break
        case 404:
          errorMessage = 'Risorsa non trovata'
          break
        case 500:
          errorMessage = 'Errore del server'
          break
        default:
          errorMessage = `Errore ${error.status}: ${error.error?.message || error.statusText}`
      }
    }

    this.messageService.add({
      severity: 'error',
      summary: 'Errore',
      detail: errorMessage,
      life: 5000,
    })
  }

  private handleClientError(error: Error): void {
    const errorMessage = error.message || 'Si è verificato un errore imprevisto'

    this.messageService.add({
      severity: 'error',
      summary: 'Errore Applicazione',
      detail: errorMessage,
      life: 5000,
    })
  }
}
