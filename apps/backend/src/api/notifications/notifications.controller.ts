import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { NotificationService } from '../../application/notifications/notification.service'

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get user notifications' })
  async getNotifications(
    @Req() req: any,
    @Query('unreadOnly') unreadOnly?: boolean,
    @Query('limit') limit?: number
  ) {
    // Il JWT strategy popola req.user.id (non req.user.userId)
    return await this.notificationService.getUserNotifications({
      userId: req.user.id,
      tenantId: req.user.tenantId,
      unreadOnly: unreadOnly === true,
      limit: limit ? parseInt(String(limit)) : 50,
    })
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  async getUnreadCount(@Req() req: any) {
    const count = await this.notificationService.getUnreadCount(req.user.id, req.user.tenantId)
    return { count }
  }

  @Post(':id/mark-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notification as read' })
  async markAsRead(@Param('id') id: string, @Req() req: any) {
    await this.notificationService.markAsRead(id, req.user.id)
    return { success: true }
  }

  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(@Req() req: any) {
    await this.notificationService.markAllAsRead(req.user.id, req.user.tenantId)
    return { success: true }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete notification' })
  async deleteNotification(@Param('id') id: string, @Req() req: any) {
    await this.notificationService.deleteNotification(id, req.user.id)
    return { success: true }
  }
}
