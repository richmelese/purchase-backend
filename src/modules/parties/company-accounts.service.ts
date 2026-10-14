import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DataSource } from '../../orm/data-source.js';
import { hashPassword } from '../auth/auth.service.js';

// No look-alike characters (0/O, 1/l/I), so a password read from paper or a phone is typed correctly.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';

export interface CompanyCredentials {
  username: string;
  password: string;
  created: boolean;
}

/**
 * One sign-in per supplier / customer. The account only sees that company's own information
 * (enforced by AccountScopeGuard + the portal endpoints) and must change the generated password
 * at first sign-in.
 */
@Injectable()
export class CompanyAccountsService {
  constructor(private readonly ds: DataSource) {}

  private generatePassword(length = 10): string {
    const all = LETTERS + DIGITS;
    const chars = [LETTERS[crypto.randomInt(LETTERS.length)], DIGITS[crypto.randomInt(DIGITS.length)]];
    while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  /** The company's TIN, or a short form of its name; made unique against existing user names. */
  private usernameFor(party: { tin: string | null; name: string }): string {
    const fromName = party.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 24);
    let base = (party.tin || '').replace(/\D/g, '') || fromName || 'company';
    if (base.length < 3) base = `co.${base}`;
    const taken = (u: string) => !!this.ds.queryOne('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE', [u]);
    let name = base;
    for (let n = 2; taken(name); n++) name = `${base}-${n}`;
    return name;
  }

  public getAccount(partyId: number) {
    return this.ds.queryOne<{ id: number; username: string; active: number }>(
      'SELECT id, username, active FROM users WHERE party_id = ?',
      [partyId],
    );
  }

  /** Creates the company's login, or issues a new password for an existing one. */
  public createOrReset(partyId: number): CompanyCredentials {
    const party = this.ds.queryOne<{ id: number; tin: string | null; name: string }>('SELECT id, tin, name FROM parties WHERE id = ?', [partyId]);
    if (!party) throw new NotFoundException('Company not found');
    const password = this.generatePassword();
    const existing = this.getAccount(partyId);

    return this.ds.transaction(() => {
      if (existing) {
        this.ds.execute('UPDATE users SET password_hash = ?, must_change_password = 1, active = 1 WHERE id = ?', [hashPassword(password), existing.id]);
        this.ds.execute('DELETE FROM sessions WHERE user_id = ?', [existing.id]); // sign out everywhere
        return { username: existing.username, password, created: false };
      }
      const username = this.usernameFor(party);
      const { lastInsertRowid } = this.ds.execute(
        `INSERT INTO users (username, full_name, password_hash, role, role_id, access_all_parties, active, party_id, must_change_password)
         VALUES (?, ?, ?, 'user', NULL, 0, 1, ?, 1)`,
        [username, party.name, hashPassword(password), party.id],
      );
      this.ds.execute('INSERT OR IGNORE INTO user_parties (user_id, party_id) VALUES (?, ?)', [Number(lastInsertRowid), party.id]);
      return { username, password, created: true };
    });
  }
}
