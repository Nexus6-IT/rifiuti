/**
 * NotificationsController — unit test
 *
 * Verifica che req.user.id (non req.user.userId) venga usato
 * in tutti gli endpoint: fix bug 502 su GET /notifications/unread-count.
 */
import { Test, TestingModule } from '@nestjs/testing'
import { NotificationsController } from './notifications.controller'
import { NotificationService } from '../../application/notifications/notification.service'

describe('NotificationsController', () => {
  let controller: NotificationsController
  let notificationService: jest.Mocked<NotificationService>

  const mockUser = { id: 'user-uuid-123', tenantId: 'tenant-uuid-456' }
  const mockReq = { user: mockUser }

  beforeEach(async () => {
    const mockNotificationService: jest.Mocked<Partial<NotificationService>> = {
      getUserNotifications: jest.fn().mockResolvedValue([]),
      getUnreadCount: jest.fn().mockResolvedValue(3),
      markAsRead: jest.fn().mockResolvedValue(undefined),
      markAllAsRead: jest.fn().mockResolvedValue(undefined),
      deleteNotification: jest.fn().mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationService, useValue: mockNotificationService }],
    }).compile()

    controller = module.get<NotificationsController>(NotificationsController)
    notificationService = module.get(NotificationService)
  })

  describe('getUnreadCount', () => {
    it('dovrebbe restituire il conteggio non letti usando req.user.id (non userId)', async () => {
      const result = await controller.getUnreadCount(mockReq)

      expect(result).toEqual({ count: 3 })
      expect(notificationService.getUnreadCount).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.tenantId
      )
    })
  })

  describe('getNotifications', () => {
    it('dovrebbe restituire le notifiche usando req.user.id', async () => {
      await controller.getNotifications(mockReq, false, 10)

      expect(notificationService.getUserNotifications).toHaveBeenCalledWith({
        userId: mockUser.id,
        tenantId: mockUser.tenantId,
        unreadOnly: false,
        limit: 10,
      })
    })
  })

  describe('markAsRead', () => {
    it('dovrebbe segnare come letta usando req.user.id', async () => {
      const result = await controller.markAsRead('notif-id', mockReq)

      expect(result).toEqual({ success: true })
      expect(notificationService.markAsRead).toHaveBeenCalledWith('notif-id', mockUser.id)
    })
  })

  describe('markAllAsRead', () => {
    it('dovrebbe segnare tutte come lette usando req.user.id e tenantId', async () => {
      const result = await controller.markAllAsRead(mockReq)

      expect(result).toEqual({ success: true })
      expect(notificationService.markAllAsRead).toHaveBeenCalledWith(mockUser.id, mockUser.tenantId)
    })
  })

  describe('deleteNotification', () => {
    it('dovrebbe eliminare la notifica usando req.user.id', async () => {
      const result = await controller.deleteNotification('notif-id', mockReq)

      expect(result).toEqual({ success: true })
      expect(notificationService.deleteNotification).toHaveBeenCalledWith('notif-id', mockUser.id)
    })
  })
})
