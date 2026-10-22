/**
 * MembershipController — switch di azienda.
 *
 * Il refresh token emesso dallo switch porta l'azienda scelta e va registrato come quelli del
 * login: senza registrazione `POST /auth/refresh` lo rifiuta come revocato, e se il frontend
 * usasse ancora quello del login il refresh riporterebbe l'utente sull'azienda primaria.
 */

import { MembershipController } from './membership.controller'

describe('MembershipController.switchTenant', () => {
  const utente = {
    id: 'user-1',
    email: 'c@studio.it',
    tenantId: 'tenant-studio',
    role: 'ADMIN',
    permissions: [],
  }

  it('registra il refresh token dello switch (7 giorni) e restituisce i token', async () => {
    const tokens = {
      accessToken: 'a',
      refreshToken: 'r-switch',
      expiresIn: 900,
      tenantId: 'tenant-cliente',
    }
    const membership = { switchTenant: jest.fn().mockResolvedValue(tokens) }
    const redis = { storeRefreshToken: jest.fn().mockResolvedValue(undefined) }
    const controller = new MembershipController(membership as any, redis as any)

    await expect(controller.switchTenant(utente, { tenantId: 'tenant-cliente' })).resolves.toEqual(
      tokens
    )

    expect(membership.switchTenant).toHaveBeenCalledWith(utente, 'tenant-cliente')
    expect(redis.storeRefreshToken).toHaveBeenCalledWith('user-1', 'r-switch', 7 * 24 * 60 * 60)
  })

  it('se lo switch è rifiutato non registra nulla', async () => {
    const membership = { switchTenant: jest.fn().mockRejectedValue(new Error('403')) }
    const redis = { storeRefreshToken: jest.fn() }
    const controller = new MembershipController(membership as any, redis as any)

    await expect(controller.switchTenant(utente, { tenantId: 'x' })).rejects.toThrow('403')
    expect(redis.storeRefreshToken).not.toHaveBeenCalled()
  })
})
