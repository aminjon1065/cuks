import { Injectable, Logger } from '@nestjs/common';
import type { DispatchChannel } from '@cuks/shared';
import { ConfigService } from '../../../config/config.service';
import { FolderExchangeAdapter } from './folder-exchange.adapter';
import type { DocumentExchangePort, ExchangeProbeResult } from './document-exchange-port';

/** What the admin screen is told about one adapter. Deliberately contains no configuration. */
export interface ExchangeAdapterStatus {
  id: string;
  channel: DispatchChannel;
  title: string;
  reachable: boolean;
  detail: string;
}

/**
 * The adapter registry (plan этап 10 «adapter registry через конфигурацию»).
 *
 * Adapters are built at boot from the environment and nowhere else. There is no runtime
 * settings table and no endpoint that installs one: a transport that could be attached through
 * the API would be a way to make the register send documents somewhere by editing a form, and
 * an isolated installation is isolated because its egress is a deployment decision.
 *
 * Empty is the SHIPPED state, not a failure. With no `DOCFLOW_EXCHANGE_DIR` the machine
 * channels stay refused up front — «принять отправку, которой не будет, хуже, чем отказать»
 * (docs/modules/11 §12.6) — and the manual channels, which are the ones the chancellery
 * actually uses today, are unaffected.
 */
@Injectable()
export class ExchangeRegistryService {
  private readonly logger = new Logger(ExchangeRegistryService.name);
  private readonly adapters = new Map<DispatchChannel, DocumentExchangePort>();

  constructor(private readonly config: ConfigService) {
    const dir = this.config.get('DOCFLOW_EXCHANGE_DIR');
    if (dir) {
      const maxBytes = this.config.get('DOCFLOW_EXCHANGE_MAX_ATTACHMENT_MB') * 1024 * 1024;
      const adapter = new FolderExchangeAdapter('folder', dir, maxBytes);
      this.adapters.set(adapter.channel, adapter);
      this.logger.log(`document exchange adapter «${adapter.title}» registered for ${dir}`);
    } else {
      this.logger.log('document exchange is not configured; machine channels stay refused');
    }
  }

  /** The channels that actually have a transport — what `assertChannelUsable` is given. */
  get configuredChannels(): DispatchChannel[] {
    return [...this.adapters.keys()];
  }

  get(channel: DispatchChannel): DocumentExchangePort | undefined {
    return this.adapters.get(channel);
  }

  get all(): DocumentExchangePort[] {
    return [...this.adapters.values()];
  }

  get isConfigured(): boolean {
    return this.adapters.size > 0;
  }

  /**
   * Probe every adapter for the admin screen. A probe that throws is reported as unreachable
   * rather than propagated: the health page exists to survive a broken transport, and a
   * status endpoint that 500s because one folder is unmounted answers nothing about the rest.
   */
  async status(): Promise<ExchangeAdapterStatus[]> {
    return Promise.all(
      this.all.map(async (adapter) => {
        const probe = await adapter.probe().catch((error: unknown): ExchangeProbeResult => ({
          reachable: false,
          detail: String(error).slice(0, 200),
        }));
        return {
          id: adapter.id,
          channel: adapter.channel,
          title: adapter.title,
          reachable: probe.reachable,
          detail: probe.detail,
        };
      }),
    );
  }
}
