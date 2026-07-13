import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  directorySearchSchema,
  type DirectoryOrgUnitDto,
  type DirectorySearchQuery,
  type DirectoryUserDto,
} from '@cuks/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DirectoryService } from './directory.service';

/**
 * Authenticated-only directory (no extra permission — exposes just names, like
 * an intranet org chart). Backs people/unit pickers across modules (task 1.5).
 */
@ApiTags('directory')
@Controller('directory')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get('users')
  users(
    @Query(new ZodValidationPipe(directorySearchSchema)) query: DirectorySearchQuery,
  ): Promise<DirectoryUserDto[]> {
    return this.directory.searchUsers(query.q);
  }

  @Get('org-units')
  orgUnits(): Promise<DirectoryOrgUnitDto[]> {
    return this.directory.listOrgUnits();
  }
}
