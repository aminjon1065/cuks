-- Privileged users who have NOT enabled 2FA (docs/09 §7, task 7.5). The TotpEnrollmentGuard already forces
-- enrollment at login for anyone holding a 2FA-required permission, so in a healthy system this returns 0
-- rows — it is the audit that proves it. Any row is a finding (an admin bypassing the gate somehow).
--
--   docker compose --env-file .env -f infra/docker/compose.prod.yaml exec -T postgres \
--     psql -U cuks -d cuks -f - < infra/security/admins-without-2fa.sql
--
-- The permission set mirrors PERMISSIONS_REQUIRING_2FA (packages/shared) plus the superadmin wildcard.
SELECT DISTINCT u.username, u.full_name, string_agg(DISTINCT rp.permission, ', ') AS privileged_perms
FROM app.users u
JOIN app.user_roles ur ON ur.user_id = u.id
JOIN app.roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
JOIN app.role_permissions rp ON rp.role_id = ur.role_id
WHERE u.deleted_at IS NULL
  AND u.totp_enabled = false
  AND rp.permission IN (
    '*',
    'admin.users.manage',
    'admin.org.manage',
    'admin.roles.manage',
    'admin.dicts.manage',
    'admin.settings.manage',
    'admin.audit.view',
    'admin.system.monitor',
    'docflow.sign',
    'gis.pg.access'
  )
GROUP BY u.username, u.full_name
ORDER BY u.username;
