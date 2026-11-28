'use strict'
/**
 * Esiti guidati dall'ultima cifra della P.IVA (o del codice fiscale) del cessionario, come il
 * provider `fake` in-process del backend (tabella nel piano SDI §4.1):
 * 1 NS (00305), 2 MC, 3 INCERTO con invio arrivato, 4 TRANSITORIO (503), 5 RIFIUTATO,
 * 6 INCERTO con invio perso, 7 RC + NE EC01, 8 RC + NE EC02, le altre RC.
 */
const SCENARI = {
  1: 'NS',
  2: 'MC',
  3: 'INCERTO_ARRIVATO',
  4: 'TRANSITORIO',
  5: 'RIFIUTATO',
  6: 'INCERTO_PERSO',
  7: 'RC_EC01',
  8: 'RC_EC02',
}

function identificativoCessionario(xml) {
  const testo = xml.toString('utf8')
  const blocco = /<CessionarioCommittente>([\s\S]*?)<\/CessionarioCommittente>/.exec(testo)?.[1]
  if (!blocco) return null
  const id =
    /<IdCodice>([^<]+)<\/IdCodice>/.exec(blocco)?.[1] ??
    /<CodiceFiscale>([^<]+)<\/CodiceFiscale>/.exec(blocco)?.[1]
  return id?.trim() || null
}

/** @returns {string|null} null se il cessionario non e' identificabile. */
function scenarioDaXml(xml) {
  const id = identificativoCessionario(xml)
  if (!id) return null
  return SCENARI[id.slice(-1)] ?? 'RC'
}

function notificheDelloScenario(scenario, idProvider, quando) {
  const n = (tipo, esito = null, codici = []) => ({
    tipo,
    esitoCommittente: esito,
    codiciErrore: codici,
    dataRicezioneSdi: quando.toISOString(),
    idNotifica: `${idProvider}-${tipo}${esito ? `-${esito}` : ''}`,
  })
  switch (scenario) {
    case 'NS':
      return [n('NS', null, ['00305'])]
    case 'MC':
      return [n('MC')]
    case 'RC_EC01':
      return [n('RC'), n('NE', 'EC01')]
    case 'RC_EC02':
      return [n('RC'), n('NE', 'EC02')]
    default:
      return [n('RC')]
  }
}

module.exports = { scenarioDaXml, notificheDelloScenario }
