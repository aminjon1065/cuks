import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { AdminModule } from '../admin/admin.module';
import { FileVersionsService } from './file-versions.service';
import { FilesController } from './files.controller';
import { FsNodesService } from './fs-nodes.service';
import { FsTreeService } from './fs-tree.service';
import { UploadsService } from './uploads.service';

/**
 * Files module (docs/modules/12). AdminModule is imported for AclService.
 * Producer-only registration of `av-scan` (task 1.3) — the worker owns the
 * processor; this just needs `@InjectQueue` access in UploadsService.
 */
@Module({
  imports: [AdminModule, BullModule.registerQueue({ name: QUEUE.avScan })],
  controllers: [FilesController],
  providers: [FsNodesService, FsTreeService, UploadsService, FileVersionsService],
})
export class FilesModule {}
