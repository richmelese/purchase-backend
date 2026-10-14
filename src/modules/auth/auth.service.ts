import { Injectable, BadRequestException, UnauthorizedException, ForbiddenException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Repository } from '../../orm/repository.js';
import { InjectRepository } from '../../orm/decorators/inject-repository.decorator.js';
import { UserEntity } from '../../entities/user.entity.js';
import { SessionEntity } from '../../entities/session.entity.js';
import { SettingEntity } from '../../entities/setting.entity.js';

export const COOKIE = 'psm_session';
const SHORT_SESSION_MS = 12 * 3600 * 1000;
const LONG_SESSION_MS = 30 * 24 * 3600 * 1000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  private failures = new Map<string, { count: number; until: number }>();
  private readonly MAX_FAILURES = 5;
  // Per user name across all client addresses: the forwarded client address can be spoofed,
  // so this caps guessing even when every attempt claims a different address.
  private readonly MAX_FAILURES_ANY_ADDRESS = 20;
  private readonly LOCK_MS = 5 * 60 * 1000;

  constructor(
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(SessionEntity) private readonly sessionRepo: Repository<SessionEntity>,
    @InjectRepository(SettingEntity) private readonly settingRepo: Repository<SettingEntity>,
  ) {}

  public async getStatus() {
    const count = await this.userRepo.count();
    const company = await this.settingRepo.findOne({ where: { key: 'company_name' } });
    return {
      hasUsers: count > 0,
      company_name: company?.value || 'Epiccenter Trading PLC',
    };
  }

  public checkUsername(u: string): void {
    if (!/^[A-Za-z0-9._@-]{3,40}$/.test(u)) {
      throw new BadRequestException({
        message: 'Username must be 3–40 characters: letters, numbers, . _ @ -',
        fields: { username: '3–40 letters, numbers, . _ @ -' },
      });
    }
  }

  public checkPassword(pw: string): void {
    if (typeof pw !== 'string' || pw.length < 8) {
      throw new BadRequestException({
        message: 'Password must be at least 8 characters',
        fields: { password: 'At least 8 characters' },
      });
    }
    if (pw.length > 200) {
      throw new BadRequestException({
        message: 'Password is too long',
        fields: { password: 'Too long' },
      });
    }
  }

  private assertNotLocked(key: string): void {
    const f = this.failures.get(key);
    if (f && f.until > Date.now()) {
      const min = Math.ceil((f.until - Date.now()) / 60000);
      throw new HttpException(`Too many failed attempts. Try again in ${min} minute${min > 1 ? 's' : ''}.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFailure(key: string, max = this.MAX_FAILURES): void {
    const f = this.failures.get(key) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= max) {
      f.until = Date.now() + this.LOCK_MS;
      f.count = 0;
    }
    this.failures.set(key, f);
  }

  public async login({ username, password, remember }: any, ip = '') {
    const name = String(username ?? '').trim();
    const key = `${name.toLowerCase()}|${ip}`;
    const anyAddressKey = `${name.toLowerCase()}|*`;
    this.assertNotLocked(key);
    this.assertNotLocked(anyAddressKey);

    const user = name ? await this.userRepo.findOne({ where: { username: name } }) : null;
    const ok = verifyPassword(String(password ?? ''), user ? user.password_hash : DUMMY_HASH) && !!user;

    if (!ok) {
      this.recordFailure(key);
      this.recordFailure(anyAddressKey, this.MAX_FAILURES_ANY_ADDRESS);
      throw new UnauthorizedException('Incorrect username or password');
    }

    if (!user.active) {
      throw new ForbiddenException('Your account is waiting for administrator approval');
    }

    this.failures.delete(key);
    this.failures.delete(anyAddressKey);
    const token = crypto.randomBytes(32).toString('base64url');
    const ttl = remember ? LONG_SESSION_MS : SHORT_SESSION_MS;

    await this.sessionRepo.insert({
      token_hash: sha256(token),
      user_id: user.id,
      expires_at: Date.now() + ttl,
    });

    await this.userRepo.update(user.id, { last_login: new Date().toISOString() } as any);
    await this.sessionRepo.getDataSource().execute('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);

    return {
      token,
      maxAge: remember ? ttl : null,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        active: !!user.active,
        created_at: user.created_at,
        last_login: user.last_login,
        party_id: user.party_id || null,
        must_change_password: !!user.must_change_password,
      },
    };
  }

  public async signup({ username, full_name, password }: any) {
    const u = String(username ?? '').trim();
    const name = String(full_name ?? '').trim();
    this.checkUsername(u);
    if (!name) throw new BadRequestException({ message: 'Full name is required', fields: { full_name: 'Required' } });
    this.checkPassword(password);

    return this.userRepo.getDataSource().transaction(async () => {
      const usersCount = await this.userRepo.count();
      const first = usersCount === 0;

      const existing = await this.userRepo.findOne({ where: { username: u } });
      if (existing) {
        throw new ConflictException({ message: 'That username is already taken', fields: { username: 'Already taken' } });
      }

      await this.userRepo.insert({
        username: u,
        full_name: name,
        password_hash: hashPassword(password),
        role: first ? 'admin' : 'user',
        active: first ? 1 : 0,
      });

      return { first, pending: !first };
    });
  }

  public async logout(token: string) {
    if (token) {
      await this.sessionRepo.delete({ token_hash: sha256(token) });
    }
    return { ok: true };
  }

  public async changeOwnPassword(userId: number, { current_password, new_password }: any) {
    const user = await this.userRepo.findById(userId);
    if (!user || !verifyPassword(String(current_password ?? ''), user.password_hash)) {
      throw new BadRequestException({ message: 'Current password is incorrect', fields: { current_password: 'Incorrect' } });
    }
    this.checkPassword(new_password);
    if (String(new_password) === String(current_password ?? '')) {
      throw new BadRequestException({ message: 'Choose a password different from the current one', fields: { password: 'Same as the current password' } });
    }
    await this.userRepo.update(userId, { password_hash: hashPassword(new_password), must_change_password: 0 } as any);
    return { ok: true };
  }
}
