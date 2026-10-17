import {
  NotFoundException,
  Body, CanActivate, HttpCode, Patch, Controller, ExecutionContext, Get, Injectable, Param, ParseUUIDPipe, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParentHomeService, PARENT_DOC_TYPES } from './parent-home.service';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { InvoicePdfService } from '../finance/invoice-pdf.service';
import { ParentPortalService } from './parent-portal.service';
import { ReportPdfService } from '../development/report-pdf.service';
import { DevelopmentReportsService } from '../development/reports.service';

export class ParentLoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) password: string;
}
export class ParentChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) currentPassword: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(200) newPassword: string;
}

export class ParentProfileDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(30) mobile?: string;
  @ApiProperty({ required: false }) @IsOptional() @ValidateIf((o) => o.secondaryEmail !== null && o.secondaryEmail !== '') @IsEmail() secondaryEmail?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @ValidateIf((o) => o.secondaryEmailName !== null) @IsString() @MaxLength(120) secondaryEmailName?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @ValidateIf((o) => o.nationality !== null) @IsString() @MaxLength(60) nationality?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @ValidateIf((o) => o.area !== null) @IsString() @MaxLength(80) area?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @ValidateIf((o) => o.address !== null) @IsString() @MaxLength(300) address?: string | null;
}
export class ParentDocumentDto {
  @ApiProperty() @IsUUID() playerId: string;
  @ApiProperty({ enum: PARENT_DOC_TYPES }) @IsIn([...PARENT_DOC_TYPES]) type: string;
  @ApiProperty() @IsString() @MaxLength(200) fileName: string;
  @ApiProperty({ description: 'data:<mime>;base64,… (images shrunk by the portal first)' }) @IsString() @MaxLength(2_100_000) dataUrl: string;
}
export class ActAsDto { @ApiProperty({ example: 'Parent called about the Term 2 invoice' }) @IsString() @MinLength(5) @MaxLength(250) reason: string }

export class ParentForgotDto { @ApiProperty() @IsEmail() @MaxLength(200) email: string }
export class ParentResetDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(100) token: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(200) newPassword: string;
}

/** Accepts only parent-portal tokens (staff tokens are signed with a different key and fail here). */
@Injectable()
export class ParentGuard implements CanActivate {
  constructor(private readonly svc: ParentPortalService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers['authorization'] || '').split(' ');
    if (scheme !== 'Bearer' || !token) return false;
    req.parent = await this.svc.verify(token);
    return true;
  }
}

@ApiTags('Parent portal')
@Controller('parent')
export class ParentPortalController {
  constructor(private readonly svc: ParentPortalService, private readonly pdf: InvoicePdfService, private readonly homeSvc: ParentHomeService,
    private readonly reportPdf: ReportPdfService, private readonly reports: DevelopmentReportsService) {}

  @Public() @Post('auth/login')
  @ApiOperation({ summary: 'Parent sign-in (email + password from the welcome email)' })
  login(@Body() dto: ParentLoginDto) { return this.svc.login(dto.email, dto.password); }

  @Public() @Post('auth/forgot') @HttpCode(200)
  @ApiOperation({ summary: 'Forgot password: emails a one-time link (same answer whether or not the email has an account)' })
  forgot(@Body() dto: ParentForgotDto) { return this.svc.requestReset(dto.email); }

  @Public() @Post('auth/reset') @HttpCode(200)
  @ApiOperation({ summary: 'Choose a new password from the emailed link' })
  reset(@Body() dto: ParentResetDto) { return this.svc.resetPassword(dto.token, dto.newPassword); }

  @Public() @UseGuards(ParentGuard) @Post('auth/change-password')
  @ApiOperation({ summary: 'Choose a new password (required after a temporary one)' })
  change(@Body() dto: ParentChangePasswordDto, @Req() req: any) {
    return this.svc.changePassword(req.parent.id, dto.currentPassword, dto.newPassword, req.parent.actorId);
  }

  /** Everything the portal shows (Home, Children, Payments, Profile) in one call. */
  @Public() @UseGuards(ParentGuard) @Get('home')
  async home(@Req() req: any) {
    this.svc.requireReady(req.parent);
    const h = await this.homeSvc.home(req.parent.id);
    return { ...h, actingAs: req.parent.actorId ? { name: req.parent.actorName } : null };
  }

  @Public() @UseGuards(ParentGuard) @Patch('profile')
  profile(@Body() dto: ParentProfileDto, @Req() req: any) { return this.svc.updateProfile(req.parent, dto); }

  @Public() @UseGuards(ParentGuard) @Post('documents')
  upload(@Body() dto: ParentDocumentDto, @Req() req: any) { return this.svc.uploadDocument(req.parent, dto); }

  @Public() @UseGuards(ParentGuard) @Get('documents/:id')
  async document(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const d = await this.svc.ownDocument(req.parent, id);
    res.setHeader('Content-Type', d.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${d.fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(d.content);
  }

  /**
   * Account switch (staff): open this parent's portal acting as them — 30 minutes, reason
   * required and audited; their password can't be changed this way.
   */
  @Post('act-as/:id') @RequirePermissions('guardian.manage') @Audit('guardian.act_as', 'guardian') @HttpCode(200)
  @ApiOperation({ summary: 'Account switch: a 30-minute parent-portal sign-in for staff, acting as the parent (reason logged)' })
  actAs(@Param('id', ParseUUIDPipe) id: string, @Body() _dto: ActAsDto, @CurrentUser() user: AuthUser) {
    return this.svc.actAs(id, user.id);
  }

  /** Staff: open a document a parent uploaded. */
  @Get('staff/documents/:id') @RequirePermissions('player.view')
  async staffDocument(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const d = await this.svc.anyDocument(id);
    res.setHeader('Content-Type', d.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${d.fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(d.content);
  }

  @Public() @UseGuards(ParentGuard) @Get('me')
  me(@Req() req: any) { return this.svc.me(req.parent); }

  @Public() @UseGuards(ParentGuard) @Get('invoices/:id/pdf')
  async invoicePdf(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    await this.svc.ownInvoice(req.parent, id);
    const r = await this.pdf.render(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${r.fileName}"`);
    res.send(r.buffer);
  }

  /** The children's final term reports. */
  @Public() @UseGuards(ParentGuard) @Get('reports')
  async myReports(@Req() req: any) {
    const kids = await this.svc.myChildren(req.parent);
    const out: any[] = [];
    for (const k of kids) for (const r of await this.reports.forPlayer(k.id, true)) out.push({ ...r, child: `${k.firstName} ${k.lastName}` });
    return out;
  }

  @Public() @UseGuards(ParentGuard) @Get('reports/:id/pdf')
  async myReportPdf(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const kids = await this.svc.myChildren(req.parent);
    const r = await this.reports.get(id).catch(() => null);
    if (!r || r.status !== 'FINAL' || !kids.some((k) => k.id === r.playerId)) throw new NotFoundException('Report not found');
    const f = await this.reportPdf.render(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${f.fileName}"`);
    res.send(f.buffer);
  }
}
