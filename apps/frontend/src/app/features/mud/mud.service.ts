import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface MudVersion {
  year: number;
  version: string;
}

/** Client per il MUD: report annuale + export telematico versionato per anno. */
@Injectable({ providedIn: 'root' })
export class MudService {
  private readonly API_URL = `${environment.apiUrl}/mud`;

  constructor(private http: HttpClient) {}

  /** Versioni/anni di tracciato supportati. */
  getVersions(): Observable<{ versions: MudVersion[] }> {
    return this.http.get<{ versions: MudVersion[] }>(`${this.API_URL}/export/versions`);
  }

  /** Report MUD (dati aggregati) per l'anno. */
  getReport(year: number): Observable<any> {
    return this.http.get(`${this.API_URL}/generate`, { params: { year: String(year) } });
  }

  /** Scarica il file MUD telematico (text/plain) per l'anno, come blob + filename. */
  downloadExport(year: number): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.API_URL}/export`, {
      params: { year: String(year) },
      responseType: 'blob',
      observe: 'response',
    });
  }
}
