import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { Router } from '@angular/router'
import { AuthService, User, AuthResponse } from './auth.service'
import { environment } from '../../../environments/environment'

/**
 * Test di AuthService allineati all'API corrente (login dev, token in localStorage,
 * signal currentUser/isAuthenticated). Copre anche la resilienza al refresh:
 * un access token valido non deve MAI causare logout su errore transitorio.
 */
describe('AuthService', () => {
  let httpMock: HttpTestingController
  let routerSpy: jasmine.SpyObj<Router>
  const api = environment.apiUrl

  // Costruisce un access token JWT fittizio con il payload dato (header/sig fissi).
  const makeToken = (payload: Record<string, unknown>): string =>
    `hdr.${btoa(JSON.stringify(payload))}.sig`

  const validToken = (extra: Record<string, unknown> = {}): string =>
    makeToken({ id: 'user-1', email: 'admin@test.com', role: 'ADMIN', exp: futureExp(), ...extra })

  const futureExp = (): number => Math.floor(Date.now() / 1000) + 3600
  const pastExp = (): number => Math.floor(Date.now() / 1000) - 3600

  const mockUser: User = { id: 'user-1', email: 'admin@test.com', firstName: 'Admin', role: 'ADMIN' }

  beforeEach(() => {
    localStorage.clear()
    routerSpy = jasmine.createSpyObj('Router', ['navigate'])
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService, { provide: Router, useValue: routerSpy }],
    })
    httpMock = TestBed.inject(HttpTestingController)
  })

  afterEach(() => {
    httpMock.verify()
    localStorage.clear()
  })

  // Costruisce il service DOPO l'eventuale setup di localStorage (initializeAuth
  // legge il token in costruttore).
  const makeService = (): AuthService => TestBed.inject(AuthService)

  it('should be created', () => {
    expect(makeService()).toBeTruthy()
  })

  describe('login (dev)', () => {
    it('salva i token e imposta lo stato autenticato', () => {
      const service = makeService()
      const resp: AuthResponse = {
        accessToken: 'at-123',
        refreshToken: 'rt-123',
        user: mockUser,
      }

      let emitted: AuthResponse | undefined
      service.login('admin@test.com').subscribe(r => (emitted = r))

      const req = httpMock.expectOne(`${api}/auth/dev/login`)
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual({ email: 'admin@test.com' })
      req.flush(resp)

      expect(emitted).toEqual(resp)
      expect(localStorage.getItem('accessToken')).toBe('at-123')
      expect(localStorage.getItem('refreshToken')).toBe('rt-123')
      expect(service.isAuthenticated()).toBe(true)
      expect(service.currentUser()).toEqual(mockUser)
    })
  })

  describe('logout', () => {
    it('chiama /auth/logout, pulisce la sessione e reindirizza a /login', () => {
      const service = makeService()
      localStorage.setItem('accessToken', 'at')
      localStorage.setItem('refreshToken', 'rt')

      service.logout().subscribe()

      const req = httpMock.expectOne(`${api}/auth/logout`)
      expect(req.request.method).toBe('POST')
      req.flush(null)

      expect(localStorage.getItem('accessToken')).toBeNull()
      expect(localStorage.getItem('refreshToken')).toBeNull()
      expect(service.isAuthenticated()).toBe(false)
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'])
    })
  })

  describe('isTokenValid', () => {
    it('true con token non scaduto', () => {
      const service = makeService()
      localStorage.setItem('accessToken', validToken())
      expect(service.isTokenValid()).toBe(true)
    })

    it('false con token scaduto', () => {
      const service = makeService()
      localStorage.setItem('accessToken', makeToken({ id: 'x', exp: pastExp() }))
      expect(service.isTokenValid()).toBe(false)
    })

    it('false senza token', () => {
      expect(makeService().isTokenValid()).toBe(false)
    })

    it('false con token malformato', () => {
      const service = makeService()
      localStorage.setItem('accessToken', 'non-un-jwt')
      expect(service.isTokenValid()).toBe(false)
    })
  })

  describe('clearSession', () => {
    it('rimuove le chiavi di sessione e azzera lo stato (senza toccare altre chiavi)', () => {
      const service = makeService()
      localStorage.setItem('accessToken', 'at')
      localStorage.setItem('refreshToken', 'rt')
      localStorage.setItem('altro', 'da-preservare')

      service.clearSession()

      expect(localStorage.getItem('accessToken')).toBeNull()
      expect(localStorage.getItem('refreshToken')).toBeNull()
      expect(localStorage.getItem('altro')).toBe('da-preservare')
      expect(service.isAuthenticated()).toBe(false)
      expect(service.currentUser()).toBeNull()
    })
  })

  describe('initializeAuth (resilienza al refresh/deep-link)', () => {
    it('con token valido autentica ottimisticamente e idrata da /auth/profile', () => {
      localStorage.setItem('accessToken', validToken())
      const service = makeService()

      // Autenticazione ottimistica immediata dal token, prima della risposta.
      expect(service.isAuthenticated()).toBe(true)
      expect(service.currentUser()?.id).toBe('user-1')

      const req = httpMock.expectOne(`${api}/auth/profile`)
      req.flush(mockUser)
      expect(service.currentUser()).toEqual(mockUser)
    })

    it('su errore 5xx transitorio NON cancella la sessione (token preservati)', () => {
      localStorage.setItem('accessToken', validToken())
      localStorage.setItem('refreshToken', 'rt')
      const service = makeService()

      const req = httpMock.expectOne(`${api}/auth/profile`)
      req.flush('boom', { status: 500, statusText: 'Server Error' })

      // Il fix: nessun logout su errore non-401.
      expect(localStorage.getItem('accessToken')).not.toBeNull()
      expect(service.isAuthenticated()).toBe(true)
      expect(routerSpy.navigate).not.toHaveBeenCalled()
    })

    it('su 401 tenta il refresh e ripristina la sessione', () => {
      localStorage.setItem('accessToken', validToken())
      localStorage.setItem('refreshToken', 'rt')
      const service = makeService()

      httpMock
        .expectOne(`${api}/auth/profile`)
        .flush('unauthorized', { status: 401, statusText: 'Unauthorized' })

      const refreshReq = httpMock.expectOne(`${api}/auth/refresh`)
      expect(refreshReq.request.body).toEqual({ refreshToken: 'rt' })
      refreshReq.flush({ accessToken: 'at-nuovo', expiresIn: 900 })

      httpMock.expectOne(`${api}/auth/profile`).flush(mockUser)

      expect(service.currentUser()).toEqual(mockUser)
      expect(service.isAuthenticated()).toBe(true)
    })
  })
})
