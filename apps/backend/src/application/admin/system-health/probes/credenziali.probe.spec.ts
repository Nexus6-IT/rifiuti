import { CredenzialiProbe } from './credenziali.probe'
import { RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI } from '../../../rentri/get-rentri-diagnostica.use-case'

describe('CredenzialiProbe', () => {
  const probe = new CredenzialiProbe()

  function valuta(giorni: number | null, presente = true) {
    const [voce] = probe.raccogli([
      {
        key: 'rentri',
        label: 'Certificato RENTRI',
        giorniAllaScadenza: giorni,
        scadenzaAl: giorni === null ? null : new Date(Date.now() + giorni * 86_400_000),
        presente,
      },
    ])
    return voce
  }

  it('dichiara off — non error — quando la credenziale non e stata caricata', () => {
    const voce = valuta(null, false)

    expect(voce.state).toBe('off')
    expect(voce.detail).toContain('Nessuna credenziale caricata')
  })

  it('dichiara unknown il certificato presente ma non analizzabile', () => {
    expect(valuta(null).state).toBe('unknown')
  })

  it('e ok ben prima della soglia di avviso', () => {
    const voce = valuta(RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_30 + 10)

    expect(voce.state).toBe('ok')
    expect(voce.detail).toContain('valido per altri 40 giorni')
  })

  it('passa a warn entro i 30 giorni', () => {
    expect(valuta(RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_30).state).toBe('warn')
    expect(valuta(RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_15).state).toBe('warn')
  })

  it('passa a error entro i 7 giorni: la soglia di azione richiesta', () => {
    const voce = valuta(RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_7)

    expect(voce.state).toBe('error')
    expect(voce.detail).toContain('azione richiesta')
  })

  it('dichiara scaduto contando i giorni trascorsi', () => {
    const voce = valuta(-3)

    expect(voce.state).toBe('error')
    expect(voce.detail).toContain('SCADUTO da 3 giorni')
  })

  describe('riepilogo di piattaforma', () => {
    function credenziale(giorni: number, presente = true) {
      return {
        key: 'rentri',
        label: 'Certificato RENTRI',
        giorniAllaScadenza: giorni,
        scadenzaAl: new Date(Date.now() + giorni * 86_400_000),
        presente,
      }
    }

    it('dichiara off quando nessuna azienda ha caricato una credenziale', () => {
      const voce = probe.riepilogo([])

      expect(voce.state).toBe('off')
      expect(voce.detail).toContain('Nessuna azienda attiva')
    })

    it('mostra lo stato PEGGIORE, non la media: un solo scaduto si vede subito', () => {
      const voce = probe.riepilogo([credenziale(200), credenziale(180), credenziale(-1)])

      expect(voce.state).toBe('error')
    })

    it('conta le credenziali per stato invece di elencare i dati di ogni azienda', () => {
      const voce = probe.riepilogo([credenziale(200), credenziale(20), credenziale(-1)])

      expect(voce.detail).toContain('3 credenziali')
      expect(voce.detail).toContain('1 valide')
      expect(voce.detail).toContain('1 in scadenza entro 30 giorni')
      expect(voce.detail).toContain('1 scadute o entro 7 giorni')
    })
  })
})
