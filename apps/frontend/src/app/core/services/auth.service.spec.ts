import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { Router } from '@angular/router'
import { AuthService, LoginResponse, User } from './auth.service'

describe('AuthService', () => {
  let service: AuthService
  let httpMock: HttpTestingController
  let routerSpy: jasmine.SpyObj<Router>

  beforeEach(() => {
    const routerSpyObj = jasmine.createSpyObj('Router', ['navigate'])

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService, { provide: Router, useValue: routerSpyObj }],
    })

    service = TestBed.inject(AuthService)
    httpMock = TestBed.inject(HttpTestingController)
    routerSpy = TestBed.inject(Router) as jasmine.SpyObj<Router>

    // Clear localStorage before each test
    localStorage.clear()
  })

  afterEach(() => {
    httpMock.verify()
    localStorage.clear()
  })

  it('should be created', () => {
    expect(service).toBeTruthy()
  })

  describe('login', () => {
    it('should login successfully and store token', done => {
      const mockResponse: LoginResponse = {
        access_token: 'test-token',
        user: {
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
          tenantId: 'tenant-1',
          role: 'admin',
        },
      }

      service.login('test@example.com', 'password').subscribe({
        next: response => {
          expect(response).toEqual(mockResponse)
          expect(service.getToken()).toBe('test-token')
          expect(service.isAuthenticated()).toBe(true)
          done()
        },
      })

      const req = httpMock.expectOne('/api/auth/login')
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual({ email: 'test@example.com', password: 'password' })
      req.flush(mockResponse)
    })

    it('should handle login error', done => {
      service.login('test@example.com', 'wrong-password').subscribe({
        error: error => {
          expect(error).toBeTruthy()
          expect(service.isAuthenticated()).toBe(false)
          done()
        },
      })

      const req = httpMock.expectOne('/api/auth/login')
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    })
  })

  describe('logout', () => {
    it('should logout and clear storage', () => {
      // Set up authenticated state
      localStorage.setItem('auth_token', 'test-token')
      localStorage.setItem(
        'auth_user',
        JSON.stringify({
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
          tenantId: 'tenant-1',
          role: 'admin',
        })
      )

      service.logout()

      expect(localStorage.getItem('auth_token')).toBeNull()
      expect(localStorage.getItem('auth_user')).toBeNull()
      expect(service.isAuthenticated()).toBe(false)
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'])
    })
  })

  describe('isAuthenticated', () => {
    it('should return true when token exists', () => {
      localStorage.setItem('auth_token', 'test-token')
      expect(service.isAuthenticated()).toBe(true)
    })

    it('should return false when no token', () => {
      expect(service.isAuthenticated()).toBe(false)
    })
  })

  describe('getCurrentUser', () => {
    it('should return current user from storage', () => {
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        tenantId: 'tenant-1',
        role: 'admin',
      }

      localStorage.setItem('auth_user', JSON.stringify(mockUser))

      // Create new service instance to load from storage
      const newService = new AuthService(TestBed.inject(HttpClientTestingModule) as any, routerSpy)

      const user = newService.getCurrentUser()
      expect(user).toEqual(mockUser)
    })

    it('should return null when no user in storage', () => {
      const user = service.getCurrentUser()
      expect(user).toBeNull()
    })
  })

  describe('currentUser$ observable', () => {
    it('should emit user changes', done => {
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        tenantId: 'tenant-1',
        role: 'admin',
      }

      service.currentUser$.subscribe({
        next: user => {
          if (user) {
            expect(user).toEqual(mockUser)
            done()
          }
        },
      })

      const mockResponse: LoginResponse = {
        access_token: 'test-token',
        user: mockUser,
      }

      service.login('test@example.com', 'password').subscribe()

      const req = httpMock.expectOne('/api/auth/login')
      req.flush(mockResponse)
    })
  })
})
