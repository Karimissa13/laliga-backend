import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

export class EmailInvoiceDto {
  @ApiPropertyOptional({ description: 'Send to a different address this once (defaults to the parent)' })
  @IsOptional() @IsEmail() to?: string;
}
const EMAIL_KINDS = ['welcome', 'registered', 'invoice', 'report', 'payment_link'];
export class EmailLogQueryDto {
  @ApiPropertyOptional({ enum: EMAIL_KINDS }) @IsOptional() @IsIn(EMAIL_KINDS) kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() guardianId?: string;
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt() @Min(1) @Max(500) limit?: number;
}

@ApiTags('Email')
@Controller()
export class NotificationsController {
  constructor(private readonly n: NotificationsService) {}

  @Get('email/status') @RequirePermissions('communication.view')
  @ApiOperation({ summary: 'Is a mail server connected?' })
  status() { return this.n.status(); }

  @Get('email/log') @RequirePermissions('communication.view')
  @ApiOperation({ summary: 'Welcome and invoice emails, newest first' })
  log(@Query() q: EmailLogQueryDto) { return this.n.emailLog(q); }

  @Get('email/log/:id/body') @RequirePermissions('communication.view')
  async body(@Param('id') id: string) { return { html: await this.n.emailBody(id) }; }

  @Post('invoices/:id/email') @RequirePermissions('invoice.edit') @Audit('invoice.email', 'invoice')
  @ApiOperation({ summary: 'Email the invoice PDF to the parent (resend)' })
  emailInvoice(@Param('id') id: string, @Body() dto: EmailInvoiceDto, @CurrentUser() u: AuthUser) {
    return this.n.sendInvoice(id, { to: dto.to, actorId: u?.id });
  }

  @Post('guardians/:id/send-login') @RequirePermissions('guardian.manage') @Audit('guardian.send_login', 'guardian')
  @ApiOperation({ summary: 'Email the parent new sign-in details (a fresh temporary password)' })
  sendLogin(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.n.sendWelcome(id, { resetLogin: true, actorId: u?.id });
  }
}
