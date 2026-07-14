import { beforeAll, describe, expect, it } from 'vitest';
import { createInstance, type TFunction } from 'i18next';
import type { NotificationDto } from '@cuks/shared';
import ruIncidents from '@/locales/ru/incidents.json';
import ruNotifications from '@/locales/ru/notifications.json';
import { notificationHref, notificationText } from './lib';

const notification = {
  id: '01900000-0000-7000-8000-000000000001',
  type: 'incidents.incident.created',
  group: 'incidents',
  title: 'Incident',
  body: 'Created',
  entityType: 'incident',
  entityId: '01900000-0000-7000-8000-000000000002',
  payload: { number: 'ЧС-2026-0001', severity: 3 },
  isRead: false,
  readAt: null,
  createdAt: '2026-07-14T00:00:00.000Z',
} satisfies NotificationDto;

describe('notificationHref', () => {
  it('deep-links incident notifications to the permanent card', () => {
    expect(notificationHref(notification)).toBe(
      '/app/incidents/01900000-0000-7000-8000-000000000002',
    );
  });

  it('does not invent a route for an unsupported entity', () => {
    expect(notificationHref({ ...notification, entityType: null, entityId: null })).toBeNull();
  });
});

describe('notificationText', () => {
  let t: TFunction;
  beforeAll(async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'ru',
      fallbackLng: 'ru',
      resources: { ru: { notifications: ruNotifications, incidents: ruIncidents } },
      interpolation: { escapeValue: false },
    });
    t = i18n.getFixedT('ru', 'notifications');
  });

  it('keeps same-type incidents distinguishable by number and severity', () => {
    const first = notificationText(t, notification);
    const second = notificationText(t, {
      ...notification,
      payload: { number: 'ЧС-2026-0002', severity: 5 },
    });

    expect(first).toEqual({
      title: 'Зарегистрирована ЧС ЧС-2026-0001',
      body: 'Уровень ЧС: 3. Откройте карточку для оперативных данных.',
    });
    expect(second.title).toContain('ЧС-2026-0002');
    expect(second.body).toContain('5');
  });

  it('localizes both sides of a status transition', () => {
    expect(
      notificationText(t, {
        ...notification,
        type: 'incidents.incident.status_changed',
        payload: {
          number: 'ЧС-2026-0001',
          severity: 3,
          fromStatus: 'reported',
          toStatus: 'active',
        },
      }),
    ).toEqual({
      title: 'Изменён статус ЧС ЧС-2026-0001',
      body: 'Донесение → В работе',
    });
  });

  it('uses contextual server copy for legacy rows without a payload', () => {
    expect(
      notificationText(t, {
        ...notification,
        title: 'Зарегистрирована ЧС ЧС-2026-0099',
        body: 'Уровень ЧС: 4',
        payload: {},
      }),
    ).toEqual({
      title: 'Зарегистрирована ЧС ЧС-2026-0099',
      body: 'Уровень ЧС: 4',
    });
  });
});
