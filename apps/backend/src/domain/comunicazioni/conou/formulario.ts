/**
 * Serie, numero e anno del formulario CONOU (campi 13-15) dal numero del FIR. Porta di
 * `ComuCou:calcolaformu` (WinWaste): la serie sono le lettere maiuscole iniziali, il numero il
 * resto fino alla `/`, l'anno quello dopo la `/`.
 */
export interface FormularioScomposto {
  serie: string
  numero: string
  anno: string
}

export function scomponiNumeroFir(numeroFir: string | null | undefined): FormularioScomposto {
  const formu = (numeroFir ?? '').trim()
  if (formu === '') return { serie: '', numero: '', anno: '' }

  let n = 0
  while (n < formu.length && formu[n] >= 'A' && formu[n] <= 'Z') n++
  let serie = formu.slice(0, n)
  const dopo = formu.slice(n)
  const barra = dopo.indexOf('/')
  let numero = (barra === -1 ? dopo : dopo.slice(0, barra)).trim()
  let anno =
    barra === -1
      ? ''
      : dopo
          .slice(barra + 1)
          .split('/')[0]
          .trim()

  if (anno.length === 2) anno = `20${anno}`
  if (anno !== '' && !(/^\d{4}$/.test(anno) && +anno >= 2020 && +anno <= 2099)) {
    // Anno non riconoscibile: vuoto, e il numero e' tutto il resto (come WinWaste).
    anno = ''
    numero = dopo
  }
  if (numero.length > 10 || serie.length > 6) {
    serie = formu.slice(0, 6)
    numero = formu.slice(6)
  }
  return { serie, numero, anno }
}
