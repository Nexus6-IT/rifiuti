import { FileScaricato } from './fatturazione.service'

/**
 * Gli errori dei download (`responseType: 'blob'`) arrivano con il corpo JSON dentro un Blob
 * (seguito m6 della 4.4b2): lo legge come testo e lo rimette in `error`, così il vocabolario può
 * riconoscere il codice. Se il corpo non è JSON, `error` diventa `null` (messaggio di ripiego).
 */
export async function erroreDaBlob(err: unknown): Promise<unknown> {
  const e = err as { error?: unknown } | null
  if (!(e?.error instanceof Blob)) return err
  try {
    return { ...(err as object), error: JSON.parse(await e.error.text()) as unknown }
  } catch {
    return { ...(err as object), error: null }
  }
}

/** Fa scaricare al browser il file ricevuto (nome dall'header, altrimenti `nomePredefinito`). */
export function salvaFile(file: FileScaricato, nomePredefinito: string): void {
  const url = URL.createObjectURL(file.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.nomeFile ?? nomePredefinito
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
