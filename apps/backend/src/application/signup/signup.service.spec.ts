/**
 * SignupService — test unitari (WS-G)
 *
 * Copertura:
 *  1. Signup completato → restituisce { message, tenantId }
 *  2. P.IVA già registrata → ConflictException
 *  3. Codice fiscale non valido → BadRequestException
 *  4. Keycloak fallisce → rollback tenant DB / throw BadRequestException
 *  5. Keycloak 409 (email/CF duplicati) → ConflictException
 *  6. Transazione DB fallisce → rollback KC user / InternalServerErrorException
 *  7. Transazione DB fallisce P2002 → ConflictException
 *  8. sendVerifyEmail fallisce → NON blocca il signup (best-effort)
 *  9. Seed ruoli fallisce → NON blocca il signup (best-effort)
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SubscriptionTier, SubscriptionStatus, UserRole, Prisma } from '@prisma/client';
import { SignupService } from './signup.service';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { KeycloakUserAdapter } from '../../infrastructure/keycloak/keycloak-user.adapter';
import { LoggerService } from '../../core/logger/logger.service';
import { SignupDto } from '../../api/signup/dto/signup.dto';

// ── Mock PrismaService ────────────────────────────────────────────────────────

const mockTx = {
  tenant: {
    create: jest.fn(),
    update: jest.fn(),
  },
  user: {
    create: jest.fn(),
  },
};

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  role: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  consultantTenantAssociation: {
    upsert: jest.fn(),
  },
  permission: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  rolePermission: {
    upsert: jest.fn(),
  },
  $transaction: jest.fn(),
} as unknown as PrismaService;

// ── Mock KeycloakUserAdapter ───────────────────────────────────────────────────

const mockKeycloak = {
  createUser: jest.fn(),
  deleteUser: jest.fn(),
  sendVerifyEmail: jest.fn(),
} as unknown as KeycloakUserAdapter;

// ── Mock LoggerService ─────────────────────────────────────────────────────────

const mockLogger = {
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as LoggerService;

// ── DTO helper ─────────────────────────────────────────────────────────────────

function makeDto(overrides: Partial<SignupDto> = {}): SignupDto {
  return {
    ragioneSociale: 'Alfa Ambiente Srl',
    partitaIva: '01234567890',
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario.rossi@alfa-ambiente.it',
    fiscalCode: 'RSSMRA80A01H501U',
    tosAccepted: true,
    privacyAccepted: true,
    ...overrides,
  } as SignupDto;
}

// ── Tenant/User fixture ────────────────────────────────────────────────────────

function makeTenantFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-uuid-1234',
    partitaIva: '01234567890',
    ragioneSociale: 'Alfa Ambiente Srl',
    subscriptionTier: SubscriptionTier.TRIAL,
    subscriptionStatus: SubscriptionStatus.TRIAL,
    ...overrides,
  };
}

function makeUserFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-uuid-5678',
    keycloakId: 'kc-uuid-1234',
    tenantId: 'tenant-uuid-1234',
    fiscalCode: 'RSSMRA80A01H501U',
    email: 'mario.rossi@alfa-ambiente.it',
    firstName: 'Mario',
    lastName: 'Rossi',
    role: UserRole.ADMIN,
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SignupService', () => {
  let service: SignupService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KeycloakUserAdapter, useValue: mockKeycloak },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<SignupService>(SignupService);
  });

  // ── 1. Signup completato ────────────────────────────────────────────────────
  describe('signup() — percorso felice', () => {
    it('crea tenant + utente e restituisce tenantId + message', async () => {
      const tenantFixture = makeTenantFixture();
      const userFixture = makeUserFixture();

      (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce(null); // P.IVA non duplicata
      (mockKeycloak.createUser as jest.Mock).mockResolvedValueOnce('kc-uuid-1234');
      (mockPrisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: Function) => {
        mockTx.tenant.create.mockResolvedValueOnce(tenantFixture);
        mockTx.user.create.mockResolvedValueOnce(userFixture);
        mockTx.tenant.update.mockResolvedValueOnce(tenantFixture);
        await fn(mockTx);
        return { tenantId: tenantFixture.id, userId: userFixture.id };
      });
      // Best-effort: seed ruoli (nessun permesso trovato → 0 ruoli, non lancia)
      (mockPrisma.permission.findMany as jest.Mock).mockResolvedValue([]);
      // Best-effort: associazione owner → ruolo ADMIN non trovato (non lancia)
      (mockPrisma.role.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // Best-effort: sendVerifyEmail ok
      (mockKeycloak.sendVerifyEmail as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await service.signup(makeDto());

      expect(result.tenantId).toBe('tenant-uuid-1234');
      expect(result.message).toContain('Controlla la tua email');
      expect(mockKeycloak.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerified: false,
          requiredActions: ['VERIFY_EMAIL'],
          fiscalCode: 'RSSMRA80A01H501U',
          email: 'mario.rossi@alfa-ambiente.it',
        }),
      );
    });
  });

  // ── 2. P.IVA duplicata ─────────────────────────────────────────────────────
  describe('signup() — P.IVA duplicata', () => {
    it('lancia ConflictException se la P.IVA è già registrata', async () => {
      (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'existing-id' });

      await expect(service.signup(makeDto())).rejects.toThrow(ConflictException);
      expect(mockKeycloak.createUser).not.toHaveBeenCalled();
    });
  });

  // ── 3. Codice fiscale non valido ────────────────────────────────────────────
  describe('signup() — CF non valido', () => {
    it('lancia BadRequestException per un CF malformato', async () => {
      await expect(service.signup(makeDto({ fiscalCode: 'INVALIDO123456' }))).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
      expect(mockKeycloak.createUser).not.toHaveBeenCalled();
    });
  });

  // ── 4. Keycloak fallisce (errore generico) ─────────────────────────────────
  describe('signup() — errore Keycloak generico', () => {
    it('lancia BadRequestException e NON tocca il DB', async () => {
      (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (mockKeycloak.createUser as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('KC timeout'), { response: { status: 503 } }),
      );

      await expect(service.signup(makeDto())).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ── 5. Keycloak 409 (email/CF già presenti) ────────────────────────────────
  describe('signup() — KC 409 (conflitto)', () => {
    it('mappa KC 409 in ConflictException', async () => {
      (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (mockKeycloak.createUser as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('User exists'), { response: { status: 409 } }),
      );

      await expect(service.signup(makeDto())).rejects.toThrow(ConflictException);
    });
  });

  // ── 6. Transazione DB fallisce (errore generico) ───────────────────────────
  describe('signup() — transazione DB fallisce', () => {
    it('elimina l\'utente KC (rollback) e lancia InternalServerErrorException', async () => {
      (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (mockKeycloak.createUser as jest.Mock).mockResolvedValueOnce('kc-uuid-9999');
      (mockPrisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
      (mockKeycloak.deleteUser as jest.Mock).mockResolvedValueOnce(undefined);

      await expect(service.signup(makeDto())).rejects.toThrow(InternalServerErrorException);
      expect(mockKeycloak.deleteUser).toHaveBeenCalledWith('kc-uuid-9999');
    });
  });

  // ── 7. Transazione DB — violazione unique (P2002) ─────────────────────────
  describe('signup() — transazione DB P2002', () => {
    it('elimina l\'utente KC e lancia ConflictException per P2002', async () => {
      (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (mockKeycloak.createUser as jest.Mock).mockResolvedValueOnce('kc-uuid-p2002');
      const prismaError = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      (mockPrisma.$transaction as jest.Mock).mockRejectedValueOnce(prismaError);
      (mockKeycloak.deleteUser as jest.Mock).mockResolvedValueOnce(undefined);

      await expect(service.signup(makeDto())).rejects.toThrow(ConflictException);
      expect(mockKeycloak.deleteUser).toHaveBeenCalledWith('kc-uuid-p2002');
    });
  });

  // ── 8. sendVerifyEmail fallisce (best-effort) ──────────────────────────────
  describe('signup() — sendVerifyEmail fallisce', () => {
    it('non blocca il signup se l\'invio mail di verifica fallisce', async () => {
      const tenantFixture = makeTenantFixture();
      const userFixture = makeUserFixture();

      (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (mockKeycloak.createUser as jest.Mock).mockResolvedValueOnce('kc-uuid-ve');
      (mockPrisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: Function) => {
        mockTx.tenant.create.mockResolvedValueOnce(tenantFixture);
        mockTx.user.create.mockResolvedValueOnce(userFixture);
        mockTx.tenant.update.mockResolvedValueOnce(tenantFixture);
        await fn(mockTx);
        return { tenantId: tenantFixture.id, userId: userFixture.id };
      });
      (mockPrisma.permission.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.role.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // sendVerifyEmail lancia errore — NON deve propagarsi
      (mockKeycloak.sendVerifyEmail as jest.Mock).mockRejectedValueOnce(
        new Error('SMTP not configured'),
      );

      const result = await service.signup(makeDto());
      expect(result.tenantId).toBe(tenantFixture.id);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invio mail di verifica via Keycloak fallito'),
        expect.anything(),
      );
    });
  });

  // ── 9. Seed ruoli fallisce (best-effort) ───────────────────────────────────
  describe('signup() — seed ruoli fallisce', () => {
    it('non blocca il signup se il seeding dei ruoli fallisce', async () => {
      const tenantFixture = makeTenantFixture();
      const userFixture = makeUserFixture();

      (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (mockKeycloak.createUser as jest.Mock).mockResolvedValueOnce('kc-uuid-seed');
      (mockPrisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: Function) => {
        mockTx.tenant.create.mockResolvedValueOnce(tenantFixture);
        mockTx.user.create.mockResolvedValueOnce(userFixture);
        mockTx.tenant.update.mockResolvedValueOnce(tenantFixture);
        await fn(mockTx);
        return { tenantId: tenantFixture.id, userId: userFixture.id };
      });
      // Seed ruoli fallisce
      (mockPrisma.permission.findMany as jest.Mock).mockRejectedValueOnce(
        new Error('DB error during seed'),
      );
      (mockKeycloak.sendVerifyEmail as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await service.signup(makeDto());
      expect(result.tenantId).toBe(tenantFixture.id);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Seeding ruoli fallito'),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
