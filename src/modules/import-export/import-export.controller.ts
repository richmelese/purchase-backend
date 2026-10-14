import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ImportExportService } from './import-export.service.js';
import { currentFiscalYear } from '../../common/lib/ethiopian.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { assertCan, withPartyRight } from '../../common/permissions.js';
import { Permission, CheckedInHandler } from '../../common/decorators/permission.decorator.js';

async function extractBuffer(req: Request): Promise<Buffer> {
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return req.body;
  }
  const rawBody = (req as any).rawBody;
  if (Buffer.isBuffer(rawBody) && rawBody.length > 0) {
    return rawBody;
  }
  if (!req.readableEnded && req.readable) {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  return Buffer.alloc(0);
}

@Controller()
export class ImportExportController {
  constructor(private readonly ieService: ImportExportService) {}

  @Permission(['products', 'create'])
  @Post('import/products')
  async importProducts(@Req() req: Request) {
    const buf = await extractBuffer(req);
    if (!buf || buf.length === 0) {
      throw new BadRequestException('Choose an .xlsx file to import');
    }
    return this.ieService.importProducts(buf);
  }

  @Permission(['parties', 'create'])
  @Post('import/parties')
  async importParties(@Req() req: Request, @Query('type') type?: string) {
    const buf = await extractBuffer(req);
    if (!buf || buf.length === 0) {
      throw new BadRequestException('Choose an .xlsx file to import');
    }
    const partyType = ['Supplier', 'Customer', 'Both'].includes(type || '') ? (type as string) : 'Supplier';
    return this.ieService.importParties(buf, partyType);
  }

  @Permission(['reports', 'export'])
  @Get('export/report/:name')
  async exportReport(
    @Param('name') name: string,
    @Query('fy') fy: string,
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    const fiscalYear = fy ? +fy : currentFiscalYear();
    const out = await this.ieService.buildReportExport(name, { fy: fiscalYear, month });
    if (!out) throw new NotFoundException('Unknown report');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.end(Buffer.from(out.buffer));
  }

  @CheckedInHandler()
  @Get('export/list/:list')
  async exportList(@Param('list') list: string, @Res() res: Response, @CurrentUser() user: any) {
    const resource = ({ products: 'products', parties: 'parties', lookups: 'lookups', 'stock-in': 'inventory', 'stock-out': 'inventory' } as Record<string, string>)[list];
    if (!resource) throw new NotFoundException('Unknown export');
    assertCan(user, [resource, 'export'], ...(resource === 'lookups' ? [['lookups', 'view'] as const] : []));
    const out = await this.ieService.buildListExport(list);
    if (!out) throw new NotFoundException('Unknown export');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.end(Buffer.from(out.buffer));
  }

  @CheckedInHandler()
  @Get('export/:type')
  async exportType(
    @Param('type') type: string,
    @Query('fy') fy: string,
    @Query('month') month: string,
    @Res() res: Response,
    @CurrentUser() user: any,
  ) {
    const resourceMap: Record<string, string> = {
      purchases: 'purchases',
      sales: 'sales',
      vat: 'vat',
      stock: 'inventory',
      all: 'reports',
      withholding: 'withholding',
      credit: 'credit',
    };
    const resource = resourceMap[type];
    if (!resource) throw new NotFoundException('Unknown export');
    if (type === 'all') {
      assertCan(user, ['reports', 'export'], ['purchases', 'export'], ['sales', 'export']);
    } else {
      assertCan(user, [resource, 'export']);
    }
    const fiscalYear = fy ? +fy : currentFiscalYear();
    const out = await this.ieService.buildExport(type, {
      fy: fiscalYear,
      month,
    }, withPartyRight(user, 'export'));
    if (!out) throw new NotFoundException('Unknown export');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.end(Buffer.from(out.buffer));
  }
}
