/**
 * Intestazione `Content-Disposition` per i download di allegati: nome ASCII di ripiego tra
 * virgolette + `filename*` UTF-8 percent-encoded (RFC 5987 / 6266), cosi' i nomi con accenti,
 * spazi o virgolette arrivano corretti al browser senza poter spezzare l'intestazione.
 */
export type TipoContentDisposition = 'attachment' | 'inline'

/** Nome da mostrare: senza percorso né caratteri di controllo, mai vuoto, senza surrogati spaiati. */
function nomeSicuro(nome: string): string {
  const base = (nome ?? '').split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const senzaControlli = base.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'allegato'
  // `encodeURIComponent` lancia su un surrogato spaiato: lo si sostituisce con U+FFFD.
  return senzaControlli.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD'
  )
}

export function contentDisposition(tipo: TipoContentDisposition, nome: string): string {
  const pulito = nomeSicuro(nome)
  const ascii = pulito.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;%]/g, '_')
  const codificato = encodeURIComponent(pulito).replace(
    /['()*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${codificato}`
}
