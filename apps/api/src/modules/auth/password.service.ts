import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from '@cuks/shared';

/** Argon2id password hashing/verification (docs/05 §1). */
@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...ARGON2_OPTIONS });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
