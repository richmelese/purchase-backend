import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoicesService } from '../invoices/invoices.service.js';

@Injectable()
export class CreditService {
  constructor(private readonly invoicesService: InvoicesService) {}

  public async creditReport({ kind, open = true }: any, user?: any) {
    if (!['P', 'S'].includes(kind)) throw new NotFoundException('Unknown resource');
    const invoices = await this.invoicesService.listInvoices({ kind, payment: 'Credit' }, user);
    const today = new Date();

    return invoices
      .filter((i) => !open || i.balance > 0.004)
      .map((i) => {
        const days = Math.floor((today.getTime() - new Date(i.date).getTime()) / 86400000);
        const bucket = days <= 30 ? '0–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+';
        return { ...i, age_days: days, age_bucket: bucket };
      });
  }
}
