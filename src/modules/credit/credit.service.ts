import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoicesService } from '../invoices/invoices.service.js';

/** Aging buckets for open credit invoices, oldest last; `max` is the last day in the bucket. */
export const AGING_BUCKETS: { label: string; max: number | null }[] = [
  { label: '0–30', max: 30 },
  { label: '31–60', max: 60 },
  { label: '61–90', max: 90 },
  { label: '90+', max: null },
];

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
        const bucket = AGING_BUCKETS.find((b) => b.max === null || days <= b.max)!.label;
        return { ...i, age_days: days, age_bucket: bucket };
      });
  }
}
