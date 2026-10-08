import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { DevelopmentReportsService } from './reports.service';
import { ADVANCED_POSITION_WORD, DEVELOPMENT_SCALE, PITCH_POSITIONS } from './report-templates';

const C = {
  blue: '#4a86c8', blueLight: '#cfe0f3', grey: '#d9d9d9', greyDark: '#4b4b4b', ink: '#222222', muted: '#666666',
  red: '#e8264b', white: '#ffffff', green: '#2f8f3e', advHead: '#8eaadb', advRow: '#d4d4d4',
};
const W = 595.28, H = 841.89;
const fmt1 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1));

/**
 * The two term reports as PDFs, laid out like the academy's own:
 * the Development report (1–5 grid, pitch, observations) and the Advanced
 * report (photo, number, position, 0–5 areas with the coach's comments).
 */
@Injectable()
export class ReportPdfService {
  constructor(private readonly reports: DevelopmentReportsService) {}

  async render(id: string): Promise<{ buffer: Buffer; fileName: string; report: any }> {
    const r = await this.reports.get(id);
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${r.player?.name} — ${r.term} report`, Author: 'LaLiga Academy Abu Dhabi' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
    if (r.reportType === 'DEVELOPMENT') this.development(doc, r); else this.advanced(doc, r);
    doc.end();
    const safe = (r.player?.name ?? 'Player').replace(/[^A-Za-z0-9]+/g, '-');
    return { buffer: await done, fileName: `${safe}-${(r.term ?? 'Term').replace(/\s+/g, '')}-${r.reportType === 'DEVELOPMENT' ? 'Development' : 'Advanced'}-report.pdf`, report: r };
  }

  private logo(doc: PDFKit.PDFDocument, x: number, y: number, w: number) {
    doc.font('Helvetica-Bold').fontSize(20).fillColor(C.red).text('LALIGA', x, y, { width: w, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(C.ink).text('ACADEMY', x, y + 22, { width: w, align: 'center', characterSpacing: 2 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.red).text('ABU DHABI', x, y + 37, { width: w, align: 'center', characterSpacing: 2 });
  }

  // ------------------------------------------------------------ Development
  private development(doc: PDFKit.PDFDocument, r: any) {
    const M = 34;
    // key
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.blue).text('KEY:', M, 34);
    doc.font('Helvetica').fontSize(7.5);
    Object.entries(DEVELOPMENT_SCALE.labels).forEach(([n, l], i) => doc.fillColor(C.blue).text(`${n}. ${l}`, M, 48 + i * 11));
    // info table
    const tx = 140, lw = 72, vw = 190;
    const info: Array<[string, string]> = [['PLAYER', r.player?.name ?? ''], ['COACH', r.coach ?? r.writtenBy ?? ''], ['CATEGORY', `${r.player?.category ?? ''}${r.player?.team ? ' · ' + r.player.team : ''}`],
      ['LOCATION', r.player?.location ?? ''], ['TERM', `${r.season ?? ''} ${r.term ?? ''}`.trim()]];
    info.forEach(([k, v], i) => {
      const y = 32 + i * 18;
      doc.rect(tx, y, lw, 15).fill(C.blue); doc.rect(tx + lw + 4, y, vw, 15).fill(C.grey);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(C.white).text(k, tx + 5, y + 4.5);
      doc.font('Helvetica').fontSize(8).fillColor(C.ink).text(v, tx + lw + 9, y + 4, { width: vw - 10, height: 10, ellipsis: true });
    });
    // logo + pitch
    const px = 430, pw = 128;
    this.logo(doc, px, 26, pw);
    const py = 80, ph = 150;
    this.pitch(doc, px, py, pw, ph, r.positions || []);
    const posWord = (k?: string) => PITCH_POSITIONS.find((p) => p.key === k)?.label ?? '—';
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink).text('Position 1', px, py + ph + 6).text('Position 2', px + pw / 2 + 2, py + ph + 6);
    doc.font('Helvetica').fontSize(8).fillColor(C.ink).text(posWord(r.positions?.[0]), px, py + ph + 17, { width: pw / 2 - 4 })
      .text(posWord(r.positions?.[1]), px + pw / 2 + 2, py + ph + 17, { width: pw / 2 - 4 });
    // attendance / overall
    let iy = 132;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink).text('OVERALL', tx, iy);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(C.blue).text(fmt1(r.averages.overall), tx, iy + 10);
    doc.font('Helvetica').fontSize(7).fillColor(C.muted).text('out of 5', tx + 34, iy + 18);
    if (r.attendance) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink).text('ATTENDANCE THIS TERM', tx + 100, iy);
      doc.font('Helvetica-Bold').fontSize(18).fillColor(r.attendance.rate >= 80 ? C.green : C.red).text(`${r.attendance.rate}%`, tx + 100, iy + 10);
      doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(`${r.attendance.present} of ${r.attendance.marked} sessions`, tx + 152, iy + 18);
    }
    if (r.previous) doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(`Compared with ${r.previous.term}: ${this.delta(r.averages.overall, r.previous.averages.overall)}`, tx, iy + 34);

    // areas
    let y = 192;
    const lx = M, cx = 250, cw = 22, gap = 9;
    for (const a of r.areas) {
      const av = r.averages.areas[a.key];
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.blue).text(a.label.toUpperCase(), lx, y + 3, { width: 200 });
      // average bar like the old report
      const barW = Math.max(0, (av ?? 0) / 5) * (5 * (cw + gap) - gap);
      doc.rect(cx, y, 5 * (cw + gap) - gap, 12).fill('#eeeeee');
      if (av) doc.rect(cx, y, barW, 12).fill(av >= 4 ? C.green : av >= 3 ? '#e58a1f' : '#8e2f8a');
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(av ? C.white : C.muted).text(av ? fmt1(av) : '—', cx + 4, y + 3);
      if (r.previous?.averages?.areas?.[a.key] != null && av != null) {
        doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(this.delta(av, r.previous.averages.areas[a.key]), cx + 5 * (cw + gap) + 4, y + 3, { width: 110 });
      }
      y += 16;
      for (const i of a.items) {
        const v = r.scores[`${a.key}.${i.key}`];
        doc.font('Helvetica').fontSize(8).fillColor('#3a6ea8').text(i.label, lx + 8, y + 3, { width: 205 });
        for (let n = 1; n <= 5; n++) {
          const x = cx + (n - 1) * (cw + gap);
          const on = v === n;
          doc.rect(x, y, cw, 12).fill(on ? C.blue : C.blueLight);
          if (on) doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white).text('X', x, y + 2.5, { width: cw, align: 'center' });
        }
        y += 14.5;
      }
      y += 5;
    }
    // number heads
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted);
    for (let n = 1; n <= 5; n++) doc.text(String(n), cx + (n - 1) * (cw + gap), 182, { width: cw, align: 'center' });
    // observations
    y += 4;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.blue).text('OBSERVATIONS', M, y);
    y += 13;
    const boxH = Math.max(70, H - y - 44);
    doc.rect(M, y, W - 2 * M, boxH).fill('#efefef');
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink).text(r.notes || '', M + 12, y + 10, { width: W - 2 * M - 24, height: boxH - 16, lineGap: 1.5, ellipsis: true });
    this.footer(doc, r, `DEVELOPMENT REPORT · ${(r.term ?? '').toUpperCase()} · SEASON ${r.seasonYears ?? r.season ?? ''}`);
  }

  private pitch(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, picked: string[]) {
    doc.rect(x, y, w, h).fill('#2e8b3a');
    for (let i = 0; i < 8; i++) if (i % 2) doc.rect(x, y + (i * h) / 8, w, h / 8).fill('#329a40');
    doc.lineWidth(0.8).strokeColor(C.white);
    doc.rect(x + 4, y + 4, w - 8, h - 8).stroke();
    doc.moveTo(x + 4, y + h / 2).lineTo(x + w - 4, y + h / 2).stroke();
    doc.circle(x + w / 2, y + h / 2, 12).stroke();
    doc.rect(x + w * 0.27, y + 4, w * 0.46, h * 0.13).stroke();
    doc.rect(x + w * 0.27, y + h - 4 - h * 0.13, w * 0.46, h * 0.13).stroke();
    for (const p of PITCH_POSITIONS) {
      const cx = x + 4 + p.x * (w - 8), cy = y + 4 + p.y * (h - 8);
      const i = picked.indexOf(p.key);
      doc.circle(cx, cy, 5.2).lineWidth(0.9).fillAndStroke(i === 0 ? C.red : i === 1 ? '#f2b705' : '#2e8b3a', C.white);
    }
  }

  private delta(now: number | null, before: number | null) {
    if (now == null || before == null) return '';
    const d = Math.round((now - before) * 10) / 10;
    return d === 0 ? 'same as last term' : `${d > 0 ? '+' : ''}${d.toFixed(1)} since last term`;
  }

  // ---------------------------------------------------------------- Advanced
  private advanced(doc: PDFKit.PDFDocument, r: any) {
    const M = 26;
    // watermark
    doc.save().opacity(0.07).font('Helvetica-Bold').fontSize(82).fillColor(C.red).text('LALIGA', M, 150, { width: W - 2 * M, align: 'left' })
      .fillColor('#000000').text('ACADEMY', M + 180, 150).restore();
    // photo
    if (r.photo) {
      try { doc.image(Buffer.from(r.photo.split(',')[1], 'base64'), M, 22, { fit: [92, 104], align: 'center', valign: 'center' }); }
      catch { doc.rect(M, 22, 92, 104).fill('#eeeeee'); }
    } else {
      doc.rect(M, 22, 92, 104).fill('#eeeeee');
      doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('No photo', M, 70, { width: 92, align: 'center' });
    }
    this.logo(doc, M + 98, 40, 100);
    doc.font('Helvetica-Bold').fontSize(19).fillColor(C.ink).text((r.player?.name ?? '').toUpperCase(), 236, 34, { width: 230 });
    doc.font('Helvetica-Bold').fontSize(11).text(`Season ${r.seasonYears ?? r.season ?? ''}`, 236, 82);
    doc.font('Helvetica-Bold').fontSize(11).text(ADVANCED_POSITION_WORD[r.position as keyof typeof ADVANCED_POSITION_WORD] ?? '', 360, 82);
    // number ring
    const rx = 520, ry = 74;
    doc.lineWidth(7).strokeColor('#6f6f6f');
    for (let k = 0; k < 6; k++) { const a0 = (k * 60 + 8) * Math.PI / 180, a1 = (k * 60 + 52) * Math.PI / 180; doc.path(this.arc(rx, ry, 40, a0, a1)).stroke(); }
    doc.font('Helvetica-Bold').fontSize(26).fillColor('#3a6ea8').text(r.shirtNumber != null ? String(r.shirtNumber) : '', rx - 40, ry - 20, { width: 80, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(r.player?.category ?? '', rx - 40, ry + 12, { width: 80, align: 'center' });
    // general comment
    let y = 140;
    const gH = 62;
    doc.rect(M, y, W - 2 * M, gH).fill(C.greyDark);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white).text(r.notes || '', M + 10, y + 9, { width: W - 2 * M - 20, height: gH - 14, align: 'center', ellipsis: true });
    y += gH + 12;
    // areas
    const tw = 340, cw = 20.5, lw = tw - 6 * cw, bx = M + tw + 6, bw = W - M - bx;
    for (const a of r.areas) {
      const top = y;
      doc.rect(M, y, tw, 15).fill(C.advHead);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(a.label.toUpperCase(), M, y + 4, { width: tw, align: 'center' });
      y += 16;
      for (const i of a.items) {
        const v = r.scores[`${a.key}.${i.key}`];
        doc.rect(M, y, lw - 1, 16).fill(C.advRow);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink).text(`${i.label}.`, M + 5, y + 4.5, { width: lw - 10, height: 10, ellipsis: true });
        for (let n = 0; n <= 5; n++) {
          const x = M + lw + n * cw;
          doc.rect(x, y, cw - 1, 16).fill(v === n ? C.advHead : (n % 2 ? '#e6e6e6' : '#dcdcdc'));
          doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink).text(String(n), x, y + 4.5, { width: cw - 1, align: 'center' });
        }
        y += 17;
      }
      const bh = y - top - 1;
      doc.rect(bx, top, bw, bh).fill(C.greyDark);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white).text((r.comments || {})[a.key] || '', bx + 9, top + 10, { width: bw - 18, height: bh - 16, align: 'justify', ellipsis: true });
      y += 10;
    }
    this.footer(doc, r, `${(r.term ?? 'TERM').toUpperCase()} REPORT - SEASON ${r.seasonYears ?? r.season ?? ''}`);
  }

  private arc(cx: number, cy: number, rad: number, a0: number, a1: number) {
    const p = (a: number) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
    return `M ${p(a0)} A ${rad} ${rad} 0 0 1 ${p(a1)}`;
  }

  private footer(doc: PDFKit.PDFDocument, r: any, title: string) {
    const y = H - 34;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(title, 0, y, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(6.5).fillColor(C.muted)
      .text(`${r.player?.reference ?? ''} · ${r.coach ? 'Coach ' + r.coach + ' · ' : ''}${r.status === 'FINAL' ? 'Final' : 'Draft — not final'}`, 30, y + 14, { width: W - 60, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.red).text('LALIGA', W - 100, y - 2, { continued: true }).fillColor(C.ink).font('Helvetica').text(' ACADEMY');
  }
}
