import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from '@cuks/shared';

/** Argon2id password hashing/verification (docs/05 §1). */
@Injectable()
export class PasswordService {
  // A throwaway hash of a random value, computed once, used to spend the same
  // argon2 time on a missing user as on a real one (anti-enumeration timing).
  private readonly dummyHash = this.hash(randomUUID());

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

  /** Constant-cost verify against a throwaway hash; result is always false. */
  async verifyDummy(password: string): Promise<void> {
    await this.verify(await this.dummyHash, password);
  }
}
