import { HttpResponse } from '@angular/common/http'

/** Nome file da `Content-Disposition: attachment; filename="x.pdf"`, altrimenti il ripiego. */
export function nomeFileDaRisposta(risposta: HttpResponse<unknown>, ripiego: string): string {
  const m = /filename="?([^";]+)"?/i.exec(risposta.headers.get('Content-Disposition') ?? '')
  return m ? m[1] : ripiego
}

/** Avvia il download del PDF; `false` se la risposta non ha corpo. */
export function scaricaPdf(risposta: HttpResponse<Blob>, ripiego: string): boolean {
  if (!risposta.body) return false
  const url = URL.createObjectURL(risposta.body)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeFileDaRisposta(risposta, ripiego)
  a.rel = 'noopener'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}
