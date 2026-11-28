const test = require('node:test')
const assert = require('node:assert/strict')
const { scenarioDaXml, notificheDelloScenario } = require('../src/scenari')

const fattura = id =>
  Buffer.from(
    `<p:FatturaElettronica><FatturaElettronicaBody/><CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${id}</IdCodice></IdFiscaleIVA></DatiAnagrafici></CessionarioCommittente></p:FatturaElettronica>`
  )

test('l ultima cifra del cessionario guida lo scenario', () => {
  const atteso = {
    1: 'NS',
    2: 'MC',
    3: 'INCERTO_ARRIVATO',
    4: 'TRANSITORIO',
    5: 'RIFIUTATO',
    6: 'INCERTO_PERSO',
    7: 'RC_EC01',
    8: 'RC_EC02',
    0: 'RC',
    9: 'RC',
  }
  for (const [cifra, scenario] of Object.entries(atteso)) {
    assert.equal(scenarioDaXml(fattura(`1234567890${cifra}`)), scenario, cifra)
  }
})

test('senza cessionario identificabile non c e scenario', () => {
  assert.equal(scenarioDaXml(Buffer.from('<x/>')), null)
})

test('usa il codice fiscale se manca la P.IVA', () => {
  const xml = Buffer.from(
    '<CessionarioCommittente><DatiAnagrafici><CodiceFiscale>RSSMRA80A01H501X</CodiceFiscale></DatiAnagrafici></CessionarioCommittente>'
  )
  assert.equal(scenarioDaXml(xml), 'RC')
})

test('notifiche per scenario', () => {
  const t = (s, id = 'p-1') =>
    notificheDelloScenario(s, id, new Date('2026-11-28T10:00:00Z')).map(n => [
      n.tipo,
      n.esitoCommittente,
      n.codiciErrore,
    ])
  assert.deepEqual(t('RC'), [['RC', null, []]])
  assert.deepEqual(t('NS'), [['NS', null, ['00305']]])
  assert.deepEqual(t('MC'), [['MC', null, []]])
  assert.deepEqual(t('RC_EC01'), [
    ['RC', null, []],
    ['NE', 'EC01', []],
  ])
  assert.deepEqual(t('RC_EC02'), [
    ['RC', null, []],
    ['NE', 'EC02', []],
  ])
  assert.equal(notificheDelloScenario('RC', 'p-1', new Date())[0].idNotifica, 'p-1-RC')
  assert.equal(notificheDelloScenario('RC_EC01', 'p-1', new Date())[1].idNotifica, 'p-1-NE-EC01')
})
