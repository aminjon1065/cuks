import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';
import { AdminRbacController } from './admin-rbac.controller';
import { AdminUsersController } from './admin-users.controller';
import { AuditController } from './audit.controller';
import { AclService } from './acl.service';
import { AdminUsersService } from './admin-users.service';
import { AuditQueryService } from './audit-query.service';
import { RoleAssignmentsService } from './role-assignments.service';
import { RolesService } from './roles.service';
import { ScopeService } from './scope.service';

/**
 * RBAC administration (docs/05, docs/16 §3). AclService/ScopeService are exported
 * for other modules to enforce level-2 scopes and level-3 ACLs.
 */
@Module({
  imports: [UsersModule, AuthModule, EventsModule],
  controllers: [AdminRbacController, AuditController, AdminUsersController],
  providers: [
    RolesService,
    RoleAssignmentsService,
    AclService,
    ScopeService,
    AuditQueryService,
    AdminUsersService,
  ],
  exports: [AclService, ScopeService],
})
export class AdminModule {}
