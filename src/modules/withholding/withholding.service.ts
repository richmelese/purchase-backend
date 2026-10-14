import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoicesService } from '../invoices/invoices.service.js';
import { taxPeriod } from '../../common/lib/ethiopian.js';

@Injectable()
export class WithholdingService {
  constructor(private readonly invoicesService: InvoicesService) {}

  public async withholdingReport({ kind, fy, month, onlyApplicable = true }: any, user?: any) {
    if (!['P', 'S'].includes(kind)) throw new NotFoundException('Unknown resource');
    const invoices = await this.invoicesService.listInvoices({ kind, fy, month }, user);

    return invoices
      .filter((i) => !onlyApplicable || i.wh.applicable)
      .map((i) => {
        let monthCheck = '';
        let penalty = '';
        if (i.wh_receipt_date) {
          const p = taxPeriod(i.wh_receipt_date);
          const same = p && p.fy === i.fy && p.idx === i.fy_month;
          monthCheck = same ? 'Same month' : 'Different month';
          penalty = same ? 'Paid on the month' : 'Penalty risk';
        } else if (i.wh.expected > 0) {
          penalty = 'Pending';
        }
        return {
          ...i,
          wh_month: i.wh_receipt_date ? taxPeriod(i.wh_receipt_date)?.month : '',
          month_check: monthCheck,
          penalty,
        };
      });
  }
}
