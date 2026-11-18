import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { environment } from '../../../environments/environment'
import { AutistiService, nomeAutista } from './autisti.service'

describe('AutistiService', () => {
  let service: AutistiService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/autisti`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(AutistiService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('elenca tutti, oppure i soli attivi con ?attivi=true', () => {
    service.elenca().subscribe()
    const tutti = http.expectOne(base)
    expect(tutti.request.params.keys()).toEqual([])
    tutti.flush({ righe: [], puoOperare: true })
    service.elenca(true).subscribe()
    const attivi = http.expectOne(r => r.url === base)
    expect(attivi.request.params.get('attivi')).toBe('true')
    attivi.flush({ righe: [], puoOperare: false })
  })

  it('crea con POST e aggiorna con PUT sull id, col corpo ricevuto', () => {
    service.crea({ nome: 'Luca', cognome: 'Bianchi' }).subscribe()
    const post = http.expectOne(base)
    expect(post.request.method).toBe('POST')
    expect(post.request.body).toEqual({ nome: 'Luca', cognome: 'Bianchi' })
    post.flush({})
    service.aggiorna('a1', { nome: 'Luca', cognome: 'Bianchi', attivo: false }).subscribe()
    const put = http.expectOne(`${base}/a1`)
    expect(put.request.method).toBe('PUT')
    expect(put.request.body.attivo).toBe(false)
    put.flush({})
  })

  it('nomeAutista scrive cognome e nome', () => {
    expect(nomeAutista({ nome: 'Luca', cognome: 'Bianchi' })).toBe('Bianchi Luca')
  })
})
