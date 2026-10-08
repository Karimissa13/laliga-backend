import {
  NotFoundException,
  Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Param, ParseUUIDPipe, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
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
  constructor(private readonly svc: ParentPortalService, private readonly pdf: InvoicePdfService,
    private readonly reportPdf: ReportPdfService, private readonly reports: DevelopmentReportsService) {}

  @Public() @Post('auth/login')
  @ApiOperation({ summary: 'Parent sign-in (email + password from the welcome email)' })
  login(@Body() dto: ParentLoginDto) { return this.svc.login(dto.email, dto.password); }

  @Public() @UseGuards(ParentGuard) @Post('auth/change-password')
  @ApiOperation({ summary: 'Choose a new password (required after a temporary one)' })
  change(@Body() dto: ParentChangePasswordDto, @Req() req: any) {
    return this.svc.changePassword(req.parent.id, dto.currentPassword, dto.newPassword);
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
