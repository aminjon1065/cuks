import { Module } from '@nestjs/common';
import { AdminRbacController } from './admin-rbac.controller';
import { AclService } from './acl.service';
import { RoleAssignmentsService } from './role-assignments.service';
import { RolesService } from './roles.service';
import { ScopeService } from './scope.service';

/**
 * RBAC administration (docs/05, docs/16 §3). AclService/ScopeService are exported
 * for other modules to enforce level-2 scopes and level-3 ACLs.
 */
@Module({
  controllers: [AdminRbacController],
  providers: [RolesService, RoleAssignmentsService, AclService, ScopeService],
  exports: [AclService, ScopeService],
})
export class AdminModule {}
