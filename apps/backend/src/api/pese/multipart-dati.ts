import { BadRequestException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate, ValidationError } from 'class-validator'

export const DIMENSIONE_MASSIMA_DATI = 16 * 1024

function messaggi(errori: ValidationError[], prefisso = ''): string[] {
  const out: string[] = []
  for (const e of errori) {
    if (e.constraints) {
      for (const [chiave, testo] of Object.entries(e.constraints)) {
        out.push(chiave === 'whitelistValidation' ? `Campo non previsto: ${e.property}.` : testo)
      }
    }
    if (e.children?.length) out.push(...messaggi(e.children, `${prefisso}${e.property}.`))
  }
  return out
}

/**
 * Legge il campo di testo `dati` di una richiesta multipart (JSON) e lo valida come un body
 * normale: `whitelist` + `forbidNonWhitelisted`, 400 con i messaggi. Oltre 16 kB: 400.
 */
export async function leggiDatiMultipart<T extends object>(
  classe: new () => T,
  testo: unknown
): Promise<T> {
  if (typeof testo !== 'string' || testo.trim() === '') {
    throw new BadRequestException('Mancano i dati della richiesta.')
  }
  if (Buffer.byteLength(testo, 'utf8') > DIMENSIONE_MASSIMA_DATI) {
    throw new BadRequestException('I dati della richiesta sono troppo lunghi.')
  }
  let grezzo: unknown
  try {
    grezzo = JSON.parse(testo)
  } catch {
    throw new BadRequestException('I dati della richiesta non sono un JSON valido.')
  }
  if (grezzo === null || typeof grezzo !== 'object' || Array.isArray(grezzo)) {
    throw new BadRequestException('I dati della richiesta non sono un JSON valido.')
  }
  const istanza = plainToInstance(classe, grezzo)
  const errori = await validate(istanza, { whitelist: true, forbidNonWhitelisted: true })
  if (errori.length) {
    const lista = messaggi(errori)
    throw new BadRequestException(lista.length ? lista : ['Dati non validi.'])
  }
  return istanza
}
