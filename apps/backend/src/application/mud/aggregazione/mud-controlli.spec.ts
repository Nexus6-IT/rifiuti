import {
  avvisiNonConfermati,
  avvisiCambianoQuantita,
  codiciAvvisoDaConfermare,
  controlliMud,
  haBloccanti,
  riepilogaAvvisi,
  type RifMovimento,
} from './mud-controlli'

const m: RifMovimento = {
  progressiveNumber: 4,
  progressiveYear: 2025,
  cerCode: '17 04 05',
  causale: 'PRODUZIONE_INTERNA',
  quantity: 30,
  unit: 'litri',
}

describe('controlliMud', () => {
  it('unitaNonDiMassa è un bloccante per CER e unità, che dice dove inserire il peso specifico', () => {
    expect(controlliMud.unitaNonDiMassa(2025, '170405', 'LITRI', [m])).toEqual({
      codice: 'UNITA_NON_DI_MASSA',
      gravita: 'BLOCCANTE',
      messaggio:
        'Il rifiuto CER 170405 ha 1 movimenti in "LITRI" per 30 LITRI (n. 4/2025): il MUD accetta solo kg o tonnellate, e senza conversione questo rifiuto mancherebbe dal file. Inserire il peso specifico (kg per LITRI) in MUD > Integrazioni 2025, riga "CER 170405 – LITRI".',
      movimenti: [
        {
          numero: 4,
          anno: 2025,
          cerCode: '17 04 05',
          quantita: 30,
          unita: 'litri',
          kg: null,
          incluso: false,
        },
      ],
      integrazione: {
        tipo: 'PESO_SPECIFICO',
        chiave: '170405|LITRI',
        cerCode: '170405',
        unita: 'LITRI',
      },
    })
  })

  it('destinatarioSenzaCf è un bloccante che porta la chiave delle integrazioni', () => {
    const c = controlliMud.destinatarioSenzaCf('Ecologia Srl', 'dal registro', 2025)
    expect(c.gravita).toBe('BLOCCANTE')
    expect(c.messaggio).toBe(
      'Destinatario "Ecologia Srl" (dal registro): manca il codice fiscale o la partita IVA, obbligatori nel modulo DR. Inserirlo in MUD > Integrazioni 2025, riga "Ecologia Srl".'
    )
    expect(c.integrazione).toEqual({
      tipo: 'CF_DESTINATARIO',
      chiave: 'ECOLOGIA SRL',
      ragioneSociale: 'Ecologia Srl',
    })
  })

  const scaricoKg: RifMovimento = { ...m, causale: 'AVVIO_SMALTIMENTO', quantity: 300, unit: 'KG' }

  it('destinatarioNonIndicato è un bloccante che porta la riga del movimento nelle integrazioni', () => {
    expect(controlliMud.destinatarioNonIndicato(scaricoKg, 2025)).toEqual({
      codice: 'DESTINATARIO_NON_INDICATO',
      gravita: 'BLOCCANTE',
      messaggio:
        'Movimento n. 4/2025 (scarico CER 17 04 05, 300 KG): né FIR né destinatario nel registro, e il modulo DR è obbligatorio. Inserire destinatario e codice fiscale in MUD > Integrazioni 2025, riga "Movimento n. 4/2025".',
      movimenti: [
        {
          numero: 4,
          anno: 2025,
          cerCode: '17 04 05',
          quantita: 300,
          unita: 'KG',
          kg: 300,
          incluso: true,
        },
      ],
      integrazione: { tipo: 'DESTINATARIO_MOVIMENTO', chiave: '2025/4', numero: 4, anno: 2025 },
    })
  })

  it('trasportatoreSenzaCf è un bloccante che porta la chiave delle integrazioni', () => {
    expect(controlliMud.trasportatoreSenzaCf('Trasporti Srl', 'FIR-2025-000123', 2025)).toEqual({
      codice: 'TRASPORTATORE_SENZA_CF',
      gravita: 'BLOCCANTE',
      messaggio:
        'Trasportatore "Trasporti Srl" (FIR FIR-2025-000123): manca il codice fiscale o la partita IVA, obbligatori nel modulo TE. Inserirlo in MUD > Integrazioni 2025, riga "Trasporti Srl".',
      integrazione: {
        tipo: 'CF_TRASPORTATORE',
        chiave: 'TRASPORTI SRL',
        ragioneSociale: 'Trasporti Srl',
      },
    })
  })

  it('trasportatoreNonIndicato è un avviso sul movimento, che resta nel MUD', () => {
    expect(controlliMud.trasportatoreNonIndicato(scaricoKg, 'FIR-2025-000123')).toEqual({
      codice: 'TRASPORTATORE_NON_INDICATO',
      gravita: 'AVVISO',
      messaggio:
        'Movimento n. 4/2025 (CER 17 04 05): il FIR FIR-2025-000123 non indica il trasportatore, quindi per questo conferimento manca il modulo TE.',
      movimenti: [
        {
          numero: 4,
          anno: 2025,
          cerCode: '17 04 05',
          quantita: 300,
          unita: 'KG',
          kg: 300,
          incluso: true,
        },
      ],
    })
  })

  it('scaricoSenzaFir dice che mancano anche il FIR e il modulo TE del trasportatore', () => {
    const r = controlliMud.scaricoSenzaFir(scaricoKg)
    expect(r.gravita).toBe('AVVISO')
    expect(r.messaggio).toBe(
      'Movimento n. 4/2025 (scarico CER 17 04 05, 300 KG): nessun FIR collegato; per il modulo DR si usa il destinatario scritto nel registro, e manca il modulo TE del trasportatore.'
    )
    expect(r.movimenti!.map(x => x.incluso)).toEqual([true])
  })

  it('le quantità nei messaggi sono in formato italiano', () => {
    expect(
      controlliMud.scaricoSenzaFir({ ...m, quantity: 1234.5, unit: 'KG' }).messaggio
    ).toContain('1.234,5 KG')
  })

  it("l'unità vuota si legge kg nei messaggi e nel movimento segnalato", () => {
    const r = controlliMud.scaricoSenzaFir({ ...m, unit: '' })
    expect(r.messaggio).toContain('30 kg')
    expect(r.movimenti![0]).toMatchObject({ unita: 'kg', kg: 30 })
  })

  it('firScaricatoPiuVolte elenca i movimenti e li dichiara inclusi', () => {
    const r = controlliMud.firScaricatoPiuVolte('FIR-2025-000123', [
      { ...m, progressiveNumber: 7 },
      { ...m, progressiveNumber: 9 },
    ])
    expect(r.gravita).toBe('AVVISO')
    expect(r.messaggio).toBe(
      'Il FIR FIR-2025-000123 risulta scaricato in 2 movimenti con dati diversi (n. 7/2025, 9/2025): le quantità sono tutte nel MUD. Verificare che non sia lo stesso conferimento registrato due volte.'
    )
    expect(r.movimenti!.map(x => x.incluso)).toEqual([true, true])
  })

  it('firDoppioIdentico conta il primo, scarta gli altri e cita le date', () => {
    const r = controlliMud.firDoppioIdentico('FIR-1', [
      { ...m, progressiveNumber: 7, movementDate: new Date('2025-06-10T00:00:00Z') },
      { ...m, progressiveNumber: 9, movementDate: new Date('2025-06-12T00:00:00Z') },
    ])
    expect(r.movimenti!.map(x => x.incluso)).toEqual([true, false])
    expect(r.messaggio).toBe(
      'Il FIR FIR-1 risulta scaricato in 2 movimenti con gli stessi dati (n. 7/2025 del 10/06/2025, 9/2025 del 12/06/2025): nel MUD la quantità è contata una volta sola.'
    )
  })

  it('firDoppioIdentico senza date elenca solo i numeri', () => {
    const r = controlliMud.firDoppioIdentico('FIR-1', [m, { ...m, progressiveNumber: 5 }])
    expect(r.messaggio).toContain('(n. 4/2025, 5/2025)')
  })

  const precedente: RifMovimento = {
    ...m,
    progressiveNumber: 812,
    quantity: 100,
    unit: 'kg',
    movementDate: new Date('2025-12-30T08:00:00Z'),
  }
  const corrente: RifMovimento = {
    ...m,
    progressiveNumber: 4,
    progressiveYear: 2026,
    quantity: 100,
    unit: 'kg',
    movementDate: new Date('2026-01-03T08:00:00Z'),
  }

  it("firDoppioAnnoPrecedente esclude il movimento dell'anno e cita le date", () => {
    expect(controlliMud.firDoppioAnnoPrecedente('FIR-1', precedente, corrente)).toEqual({
      codice: 'FIR_DOPPIO_ANNO_PRECEDENTE',
      gravita: 'AVVISO',
      messaggio:
        'Il FIR FIR-1 risulta già scaricato con gli stessi dati nel movimento n. 812/2025 del 30/12/2025: il movimento n. 4/2026 del 03/01/2026 è un doppio ed è escluso da questo MUD.',
      movimenti: [
        {
          numero: 4,
          anno: 2026,
          cerCode: '17 04 05',
          quantita: 100,
          unita: 'kg',
          kg: 100,
          incluso: false,
        },
      ],
    })
  })

  it('firDoppioAnnoPrecedente senza date cita solo i numeri', () => {
    const r = controlliMud.firDoppioAnnoPrecedente(
      'FIR-1',
      { ...precedente, movementDate: undefined },
      { ...corrente, movementDate: undefined }
    )
    expect(r.messaggio).toBe(
      'Il FIR FIR-1 risulta già scaricato con gli stessi dati nel movimento n. 812/2025: il movimento n. 4/2026 è un doppio ed è escluso da questo MUD.'
    )
  })

  it("firScaricatoAncheAnnoPrecedente lascia nel MUD il solo movimento dell'anno", () => {
    expect(
      controlliMud.firScaricatoAncheAnnoPrecedente(
        'FIR-1',
        [precedente, { ...precedente, progressiveNumber: 3, progressiveYear: 2024 }],
        corrente
      )
    ).toEqual({
      codice: 'FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE',
      gravita: 'AVVISO',
      messaggio:
        'Il FIR FIR-1 risulta scaricato anche in anni precedenti (n. 812/2025, 3/2024): il movimento n. 4/2026 è nel MUD. Verificare che non sia lo stesso conferimento dichiarato due volte.',
      movimenti: [
        {
          numero: 4,
          anno: 2026,
          cerCode: '17 04 05',
          quantita: 100,
          unita: 'kg',
          kg: 100,
          incluso: true,
        },
      ],
    })
  })

  it('nel riepilogo solo il doppio di un anno precedente cambia le quantità', () => {
    const r = riepilogaAvvisi([
      controlliMud.firDoppioAnnoPrecedente('FIR-1', precedente, corrente),
      controlliMud.firScaricatoAncheAnnoPrecedente('FIR-2', [precedente], {
        ...corrente,
        progressiveNumber: 5,
      }),
    ])
    expect(r.kgInMeno).toBe(100)
    expect(r.kgInPiu).toBe(0)
    expect(r.voci).toEqual([
      {
        codice: 'FIR_DOPPIO_ANNO_PRECEDENTE',
        casi: 1,
        movimenti: 1,
        kgEsclusi: 100,
        kgAggiunti: 0,
      },
      {
        codice: 'FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE',
        casi: 1,
        movimenti: 1,
        kgEsclusi: 0,
        kgAggiunti: 0,
      },
    ])
  })

  it('profilo non supportato e più unità locali sono avvisi', () => {
    expect(controlliMud.profiloNonSupportato(2025, [m]).gravita).toBe('AVVISO')
    const r = controlliMud.piuUnitaLocali([
      { denominazione: 'Sede', numIscrSito: 'OP1', principale: true },
      { denominazione: 'Cantiere Nord', numIscrSito: 'OP2', principale: false },
    ])
    expect(r.gravita).toBe('AVVISO')
    expect(r.messaggio).toContain('(Sede (OP1), Cantiere Nord (OP2))')
    expect(r.messaggio).toContain(
      "il file attribuisce all'unità locale Sede (OP1) i movimenti di tutte"
    )
    expect(r.messaggio).toContain('risulterebbero dichiarate due volte')
    expect(r.messaggio).not.toContain('mancano le dichiarazioni separate')
  })

  it('piuUnitaLocali attribuisce alla sede principale, anche se non è la prima', () => {
    const r = controlliMud.piuUnitaLocali([
      { denominazione: 'Cantiere Nord', numIscrSito: 'OP2', principale: false },
      { denominazione: 'Sede', numIscrSito: 'OP1', principale: true },
    ])
    expect(r.messaggio).toContain("all'unità locale Sede (OP1) i movimenti")
  })

  it('convertitoConPesoSpecifico include i movimenti con i kg convertiti e segnala il fuori intervallo', () => {
    const r = controlliMud.convertitoConPesoSpecifico('170405', 'LITRI', 1.2, [m], true)
    expect(r.messaggio).toBe(
      "Il rifiuto CER 170405: 30 LITRI convertiti in 36 kg con il peso specifico delle integrazioni (1,2 kg per LITRI). È una stima: verificarla. Il peso specifico è fuori dall'intervallo consueto per questa unità ed è stato confermato a mano."
    )
    expect(r.movimenti).toEqual([
      {
        numero: 4,
        anno: 2025,
        cerCode: '17 04 05',
        quantita: 30,
        unita: 'litri',
        kg: 36,
        incluso: true,
      },
    ])
    expect(
      controlliMud.convertitoConPesoSpecifico('170405', 'LITRI', 1.2, [m], false).messaggio
    ).toMatch(/verificarla\.$/)
  })

  it('statoFisicoNonUnivoco è un avviso senza movimenti, con gli stati in ordine fisso', () => {
    const r = controlliMud.statoFisicoNonUnivoco('200304', ['SOLIDO_NON_POLVERULENTO', 'LIQUIDO'])
    expect(r).toEqual({
      codice: 'STATO_FISICO_NON_UNIVOCO',
      gravita: 'AVVISO',
      messaggio:
        'Il rifiuto CER 200304 è registrato con stati fisici diversi (liquido, solido non polverulento): il file indica "solido non polverulento". La divisione in più schede RIF non è ancora supportata.',
    })
    expect(
      controlliMud.statoFisicoNonUnivoco('200304', ['LIQUIDO', 'SOLIDO_NON_POLVERULENTO']).messaggio
    ).toBe(r.messaggio)
  })

  it('statoFisicoNonUnivoco con un valore non riconosciuto lo dice, anche da solo', () => {
    expect(
      controlliMud.statoFisicoNonUnivoco('200304', ['LIQUIDO', 'NON_RICONOSCIUTO']).messaggio
    ).toBe(
      'Il rifiuto CER 200304 è registrato con stati fisici diversi (liquido, non riconosciuto): il file indica "solido non polverulento". La divisione in più schede RIF non è ancora supportata.'
    )
    expect(controlliMud.statoFisicoNonUnivoco('200304', ['NON_RICONOSCIUTO']).messaggio).toBe(
      'Il rifiuto CER 200304 è registrato con uno stato fisico non riconosciuto: il file indica "solido non polverulento". Correggere lo stato fisico nel registro.'
    )
  })

  it('riepilogaAvvisi mette prima i codici che riducono il dichiarato', () => {
    const kg = (n: number, q: number) => ({ ...m, progressiveNumber: n, quantity: q, unit: 'KG' })
    const controlli = [
      ...Array.from({ length: 40 }, (_, i) => controlliMud.scaricoSenzaFir(kg(100 + i, 10))),
      controlliMud.firAnnullato(kg(1, 300), 'FIR-1'),
      controlliMud.causaleEsclusa(kg(2, 50)),
      controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '170405', kg: 20 }]),
    ]
    const r = riepilogaAvvisi(controlli)
    expect(r).toMatchObject({ kgInMeno: 370, kgInPiu: 0, movimentiNonQuantificati: 0 })
    expect(r.testo).toBe(
      'Il file dichiara 370 kg in meno del registro per i motivi elencati sotto.'
    )
    expect(r.voci.map(v => v.codice)).toEqual([
      'FIR_ANNULLATO',
      'CAUSALE_ESCLUSA',
      'GIACENZE_NON_CALCOLATE',
      'SCARICO_SENZA_FIR',
    ])
    expect(r.voci.find(v => v.codice === 'SCARICO_SENZA_FIR')).toEqual({
      codice: 'SCARICO_SENZA_FIR',
      casi: 40,
      movimenti: 40,
      kgEsclusi: 0,
      kgAggiunti: 0,
    })
  })

  it('riepilogaAvvisi conta una volta sola un movimento escluso da più avvisi', () => {
    const k = { ...m, quantity: 100, unit: 'KG' }
    const r = riepilogaAvvisi([controlliMud.firAnnullato(k, 'F'), controlliMud.causaleEsclusa(k)])
    expect(r.kgInMeno).toBe(100)
    expect(r.voci.map(v => v.kgEsclusi)).toEqual([100, 100])
  })

  it('riepilogaAvvisi conta i kg aggiunti dalle conversioni e i movimenti non quantificati', () => {
    const litri = { ...m, progressiveNumber: 4, quantity: 30, unit: 'litri' }
    const r = riepilogaAvvisi([
      controlliMud.convertitoConPesoSpecifico('170405', 'LITRI', 1.2, [litri], false),
      controlliMud.causaleEsclusa({ ...m, progressiveNumber: 5, quantity: 2, unit: 'M3' }),
    ])
    expect(r).toMatchObject({ kgInMeno: 0, kgInPiu: 36, movimentiNonQuantificati: 1 })
    expect(r.testo).toBe(
      'Il file dichiara 36 kg in più del registro (conversioni con il peso specifico) per i motivi elencati sotto. Altri 1 movimenti esclusi non sono in kg e non sono quantificati.'
    )
  })

  it('riepilogaAvvisi con kg in meno e in più li dice entrambi', () => {
    const r = riepilogaAvvisi([
      controlliMud.convertitoConPesoSpecifico('170405', 'LITRI', 1.2, [m], false),
      controlliMud.causaleEsclusa({ ...m, progressiveNumber: 5, quantity: 2, unit: 'T' }),
    ])
    expect(r.testo).toBe(
      'Il file dichiara 2.000 kg in meno e 36 kg in più del registro (conversioni con il peso specifico) per i motivi elencati sotto.'
    )
    expect(r.voci.map(v => v.codice)).toEqual(['CAUSALE_ESCLUSA', 'CONVERTITO_CON_PESO_SPECIFICO'])
  })

  it('riepilogaAvvisi senza quantità in gioco lo dice', () => {
    expect(riepilogaAvvisi([controlliMud.scaricoSenzaFir(m)]).testo).toBe(
      'Il file dichiara le stesse quantità del registro: gli avvisi sono informativi.'
    )
  })

  it('le giacenze quantificate contano come kg in meno', () => {
    const c = controlliMud.giacenzeNonCalcolate(2025, [
      { cerCode6: '170405', kg: 120 },
      { cerCode6: '150110', kg: 30.5 },
    ])
    expect(c.kgNonDichiarati).toBe(150.5)
    expect(
      controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '17 05 03*', kg: 1 }]).messaggio
    ).toContain('(CER 17 05 03*: 1 kg)')
    expect(c.messaggio).toBe(
      'Secondo il registro, al 31/12/2025 risultano in deposito 150,5 kg (CER 17 04 05: 120 kg; CER 15 01 10: 30,5 kg) che il file non dichiara: le giacenze di fine anno nel file risultano zero.'
    )
    const r = riepilogaAvvisi([
      controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '170405', kg: 120 }]),
    ])
    expect(r).toMatchObject({ kgInMeno: 120, kgInPiu: 0, cambianoQuantita: false })
    expect(r.voci[0]).toMatchObject({ codice: 'GIACENZE_NON_CALCOLATE', kgEsclusi: 120 })
    expect(r.testo).toBe(
      'Il file dichiara 120 kg in meno del registro per i motivi elencati sotto.'
    )
  })

  it('le giacenze da sole non cambiano le quantità dichiarate (Decisione 19)', () => {
    const g = [controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '170405', kg: 120 }])]
    expect(avvisiCambianoQuantita(g)).toBe(false)
    expect(riepilogaAvvisi(g).kgInMeno).toBe(120)
    expect(avvisiCambianoQuantita([...g, controlliMud.firAnnullato(m, 'F')])).toBe(true)
  })

  it('gli avvisi R/D cambiano le quantità', () => {
    const r = riepilogaAvvisi([controlliMud.operazioneNonIndicata(m)])
    expect(r.cambianoQuantita).toBe(true)
    expect(r.testo).toBe(
      'Il file dichiara le stesse quantità del registro, ma per alcuni scarichi il recupero o lo smaltimento non è indicato nel registro: verificare la ripartizione elencata sotto.'
    )
    expect(avvisiCambianoQuantita([controlliMud.operazioneDedottaDalFir(m, 'F', 'R')])).toBe(true)
  })

  it('solo informativi: cambianoQuantita falso', () => {
    const r = riepilogaAvvisi([controlliMud.scaricoSenzaFir(m)])
    expect(r.cambianoQuantita).toBe(false)
    expect(avvisiCambianoQuantita([controlliMud.scaricoSenzaFir(m)])).toBe(false)
  })

  it('cambianoQuantita vale anche per movimenti esclusi e conversioni', () => {
    expect(avvisiCambianoQuantita([controlliMud.firAnnullato({ ...m, unit: 'L' }, 'F')])).toBe(true)
    expect(
      avvisiCambianoQuantita([
        controlliMud.convertitoConPesoSpecifico('170405', 'LITRI', 1.2, [m], false),
      ])
    ).toBe(true)
  })

  it('riepilogaAvvisi ignora i bloccanti', () => {
    const r = riepilogaAvvisi([controlliMud.unitaNonDiMassa(2025, '170405', 'LITRI', [m])])
    expect(r.voci).toEqual([])
    expect(r.movimentiNonQuantificati).toBe(0)
  })

  it('operazioneDedottaDalFir scrive recupero o smaltimento per esteso', () => {
    expect(controlliMud.operazioneDedottaDalFir(m, 'FIR-1', 'D').messaggio).toContain(
      '(smaltimento)'
    )
    expect(controlliMud.operazioneDedottaDalFir(m, 'FIR-1', 'R').messaggio).toContain('(recupero)')
  })

  it('dichiaranteSenzaComuneIstat usa il trattino per i dati mancanti e dice dove correggere', () => {
    expect(controlliMud.dichiaranteSenzaComuneIstat(null, null).messaggio).toBe(
      "Comune della sede dell'azienda non trovato nelle tabelle ISTAT (- -): correggerlo nell'anagrafica dell'azienda (Amministrazione > Aziende; se la voce non è visibile, chiederlo all'amministratore della piattaforma)."
    )
  })

  it('dichiaranteSenzaAteco dice dove correggere', () => {
    expect(controlliMud.dichiaranteSenzaAteco().messaggio).toBe(
      "Codice ATECO dell'azienda mancante: è obbligatorio nella scheda anagrafica del MUD. Inserirlo nell'anagrafica dell'azienda (Amministrazione > Aziende; se la voce non è visibile, chiederlo all'amministratore della piattaforma)."
    )
  })

  it('dichiaranteAtecoNonValido dice cosa serve e dove correggere', () => {
    const c = controlliMud.dichiaranteAtecoNonValido('38.11')
    expect(c.codice).toBe('DICHIARANTE_ATECO_NON_VALIDO')
    expect(c.gravita).toBe('BLOCCANTE')
    expect(c.messaggio).toBe(
      "Codice ATECO dell'azienda non valido (\"38.11\"): nel MUD servono 6 cifre, senza punti (per esempio 381100). Correggerlo nell'anagrafica dell'azienda (Amministrazione > Aziende; se la voce non è visibile, chiederlo all'amministratore della piattaforma)."
    )
  })

  it('registroVuotoConFir e firNonRegistrato portano i FIR', () => {
    const v = controlliMud.registroVuotoConFir(2025, ['A', 'B'])
    expect(v.fir).toEqual(['A', 'B'])
    expect(v.messaggio).toBe(
      'Il registro di carico e scarico del 2025 non ha movimenti, ma risultano 2 FIR emessi con trasporto nel 2025: il MUD si compila dal registro. Registrare i movimenti prima di generare il file.'
    )
    const n = controlliMud.firNonRegistrato(2025, ['A', 'B'])
    expect(n.messaggio).toBe(
      '2 FIR emessi con trasporto nel 2025 non risultano scaricati nel registro (A, B): se il conferimento è avvenuto, il MUD dichiara meno del reale. Registrare gli scarichi mancanti.'
    )
  })

  it('nessun messaggio promette correzioni che l applicazione non permette', () => {
    const tutti = [
      controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '170405', kg: 120 }]),
      controlliMud.operazioneNonIndicata(m),
      controlliMud.profiloNonSupportato(2025, [m]),
      controlliMud.firAnnullato(m, 'F'),
      controlliMud.firInBozza(m, 'F'),
      controlliMud.destinatarioNonIndicato(m, 2025),
      controlliMud.trasportatoreNonIndicato(m, 'F'),
      controlliMud.trasportatoreSenzaCf('X', 'F', 2025),
      controlliMud.esitoFirRespinto(m, 'F'),
      controlliMud.destinatarioSenzaIstat('X'),
    ]
    for (const c of tutti) {
      expect(c.messaggio).not.toMatch(/mudtelematico|prima dell'invio|va corretto|va completato/)
    }
  })

  it('haBloccanti distingue avvisi e bloccanti', () => {
    expect(
      haBloccanti([
        controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '170405', kg: 120 }]),
        controlliMud.profiloNonSupportato(2025, [m]),
      ])
    ).toBe(false)
    expect(haBloccanti([controlliMud.nessunMovimento(2025)])).toBe(true)
  })

  it('codici degli avvisi da confermare: distinti, ordinati, senza bloccanti', () => {
    const c = [
      controlliMud.scaricoSenzaFir(m),
      controlliMud.scaricoSenzaFir(m),
      controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '170405', kg: 120 }]),
      controlliMud.nessunMovimento(2025),
    ]
    expect(codiciAvvisoDaConfermare(c)).toEqual(['GIACENZE_NON_CALCOLATE', 'SCARICO_SENZA_FIR'])
    expect(avvisiNonConfermati(c, ['SCARICO_SENZA_FIR'])).toEqual(['GIACENZE_NON_CALCOLATE'])
    expect(
      avvisiNonConfermati(c, ['GIACENZE_NON_CALCOLATE', 'SCARICO_SENZA_FIR', 'ALTRO'])
    ).toEqual([])
  })
})
