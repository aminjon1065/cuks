import { Injectable } from '@nestjs/common';
import { type AppConfig, validateEnv } from './env';

/** Typed access to validated environment configuration. */
@Injectable()
export class ConfigService {
  private readonly config: AppConfig;

  constructor() {
    this.config = validateEnv();
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  get all(): Readonly<AppConfig> {
    return this.config;
  }
}
