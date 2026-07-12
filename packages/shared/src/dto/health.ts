/** Health check contracts (docs/01 §Health). */

export type HealthState = 'ok' | 'degraded' | 'down';
export type DependencyState = 'up' | 'down';

export interface LivenessResult {
  status: 'ok';
  uptimeSeconds: number;
}

export interface ReadinessResult {
  status: HealthState;
  dependencies: {
    postgres: DependencyState;
    redis: DependencyState;
    minio: DependencyState;
  };
}
