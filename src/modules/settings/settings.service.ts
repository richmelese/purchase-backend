import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Response } from 'express';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { SettingEntity } from '../../entities/setting.entity.js';
import { DEFAULT_RULES } from '../../common/lib/calc.js';
import { currentFiscalYear } from '../../common/lib/ethiopian.js';

const SETTING_KEYS = ['company_name', 'company_tin', 'company_address', ...Object.keys(DEFAULT_RULES)];
const str = (v: any) => (v == null ? '' : String(v).trim());

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(SettingEntity) private readonly settingRepo: Repository<SettingEntity>,
  ) {
    this.seedDefaults();
  }

  private seedDefaults() {
    const ds = this.settingRepo.getDataSource();
    const DEFAULT_SETTINGS = {
      company_name: 'Epiccenter Trading PLC',
      company_tin: '',
      company_address: '',
      ...Object.fromEntries(Object.entries(DEFAULT_RULES).map(([k, v]) => [k, String(v)])),
    };
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      ds.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v]);
    }
  }

  public async getSettings(): Promise<Record<string, any>> {
    const rows = await this.settingRepo.find();
    // The company profile document has its own endpoint (/company-profile).
    const map = Object.fromEntries(rows.filter((r) => r.key !== 'company_profile').map((r) => [r.key, r.value]));
    return {
      ...map,
      current_fy: currentFiscalYear(),
    };
  }

  public async getRules(): Promise<typeof DEFAULT_RULES> {
    const s = await this.getSettings();
    const rules: any = {};
    for (const k of Object.keys(DEFAULT_RULES)) {
      const n = Number(s[k]);
      rules[k] = Number.isFinite(n) ? n : (DEFAULT_RULES as any)[k];
    }
    return rules;
  }

  public async updateSettings(body: any): Promise<Record<string, any>> {
    const ds = this.settingRepo.getDataSource();
    for (const k of SETTING_KEYS) {
      if (!(k in body)) continue;
      const v = str(body[k]);
      if (k in DEFAULT_RULES) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          throw new BadRequestException({ message: `Invalid value for ${k}`, fields: { [k]: 'Must be a positive number' } });
        }
      }
      ds.execute('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]);
    }
    return this.getSettings();
  }

  public downloadBackup(res: Response): void {
    const ds = this.settingRepo.getDataSource();
    const dbPath = (ds as any).options.databasePath;
    const dir = path.dirname(dbPath);
    const file = path.join(dir, `backup-${Date.now()}.db`);

    ds.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    res.download(file, `psm-backup-${new Date().toISOString().slice(0, 10)}.db`, () => {
      fs.rm(file, () => {});
    });
  }
}
