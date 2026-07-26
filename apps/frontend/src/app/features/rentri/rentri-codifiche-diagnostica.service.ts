import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Un codice CER che RENTRI ha smesso di confermare nell'ultimo giro di allineamento. */
export interface CodiceCerNonPresente {
  code: string
  description: string
  rimossoDaRentriAl: string | null
}

/** Diagnostica di sola lettura sull'ultimo allineamento delle codifiche RENTRI (R4 Task 7). */
export interface DiagnosticaCodifiche {
  ultimoAllineamento: string | null
  codiciAggiornati: number
  codiciNonPresenti: CodiceCerNonPresente[]
}

/**
 * Client per la sezione «Codifiche» dell'area RENTRI (R4 Task 7 Step 2):
 * diagnostica di sola lettura (`GET /rentri/codifiche/diagnostica`) più
 * l'azione «Allinea ora» (`POST /rentri/codifiche/allinea`, riservata a
 * SUPER_ADMIN/ADMIN — v. `RentriCodificheController`).
 */
@Injectable({ providedIn: 'root' })
export class RentriCodificheDiagnosticaService {
  private readonly API_URL = `${environment.apiUrl}/rentri/codifiche`

  constructor(private http: HttpClient) {}

  diagnostica(): Observable<DiagnosticaCodifiche> {
    return this.http.get<DiagnosticaCodifiche>(`${this.API_URL}/diagnostica`)
  }

  allinea(): Observable<{ eseguito: true }> {
    return this.http.post<{ eseguito: true }>(`${this.API_URL}/allinea`, {})
  }
}
