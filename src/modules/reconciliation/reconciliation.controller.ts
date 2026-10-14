import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReconciliationService } from './reconciliation.service.js';
import { Permission } from '../../common/decorators/permission.decorator.js';

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

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly recService: ReconciliationService) {}

  @Permission(['reconciliation', 'view'])
  @Get('banks')
  async listBanks() {
    return this.recService.listBankAccounts();
  }

  @Permission(['reconciliation', 'create'])
  @Post('banks')
  async createBank(@Body() body: any) {
    return this.recService.saveBankAccount(body);
  }

  @Permission(['reconciliation', 'edit'])
  @Put('banks/:id')
  async updateBank(@Param('id') id: string, @Body() body: any) {
    return this.recService.updateBankAccount(+id, body);
  }

  @Permission(['reconciliation', 'delete'])
  @Delete('banks/:id')
  async deleteBank(@Param('id') id: string) {
    return this.recService.deleteBankAccount(+id);
  }

  @Permission(['reconciliation', 'view'])
  @Get('transactions')
  async listTransactions(
    @Query('bankAccountId') bankAccountId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.recService.listBankTransactions({
      bank_account_id: bankAccountId ? +bankAccountId : null,
      search: search || '',
      limit: limit ? +limit : 200,
      offset: offset ? +offset : 0,
    });
  }

  @Permission(['reconciliation', 'create'])
  @Get('transactions/next-code/:bankAccountId')
  async nextBankCode(@Param('bankAccountId') bankAccountId: string) {
    return this.recService.nextBankCode(+bankAccountId);
  }

  @Permission(['reconciliation', 'create'])
  @Post('transactions')
  async createTransaction(@Body() body: any) {
    return this.recService.saveBankTransaction(body);
  }

  @Permission(['reconciliation', 'edit'])
  @Put('transactions/:id')
  async updateTransaction(@Param('id') id: string, @Body() body: any) {
    return this.recService.updateBankTransaction(+id, body);
  }

  @Permission(['reconciliation', 'delete'])
  @Delete('transactions/:id')
  async deleteTransaction(@Param('id') id: string) {
    return this.recService.deleteBankTransaction(+id);
  }

  @Permission(['reconciliation', 'view'])
  @Get('purchases')
  async getPurchasesReconciliation(@Query('status') status?: string, @Query('search') search?: string) {
    return this.recService.getPurchasesReconciliation({ status, search });
  }

  @Permission(['reconciliation', 'view'])
  @Get('sales')
  async getSalesReconciliation(@Query('status') status?: string, @Query('search') search?: string) {
    return this.recService.getSalesReconciliation({ status, search });
  }

  @Permission(['reconciliation', 'view'])
  @Get('summary')
  async getSummary() {
    return this.recService.getReconciliationSummary();
  }

  @Permission(['reconciliation', 'edit'])
  @Post('auto-match')
  async autoMatch() {
    return this.recService.autoMatchTransactions();
  }

  @Permission(['reconciliation', 'create'])
  @Post('import')
  async importWorkbook(@Req() req: Request) {
    if ((req.body as any)?.filePath) {
      return this.recService.importReconciliationWorkbook((req.body as any).filePath);
    }
    const buf = await extractBuffer(req);
    if (!buf || buf.length === 0) {
      throw new BadRequestException('Choose an .xlsx file to import');
    }
    return this.recService.importReconciliationWorkbook(buf);
  }

  @Permission(['reconciliation', 'export'])
  @Get('export')
  async exportWorkbook(@Res() res: Response) {
    const buffer = await this.recService.exportReconciliationWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="EC_Bank_Reconciliation_Form.xlsx"');
    res.send(buffer);
  }
}
