import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { AdminModule } from '../admin/admin.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FileSharingService } from './file-sharing.service';
import { FileVersionsService } from './file-versions.service';
import { FilesController } from './files.controller';
import { FsNodesService } from './fs-nodes.service';
import { FsTreeService } from './fs-tree.service';
import { UploadsService } from './uploads.service';

/**
 * Files module (docs/modules/12). AdminModule is imported for AclService,
 * NotificationsModule for the share-notification (task 1.4). Producer-only
 * registration of `av-scan` (task 1.3) — the worker owns the processor; this
 * just needs `@InjectQueue` access in UploadsService/FileVersionsService.
 */
@Module({
  imports: [AdminModule, NotificationsModule, BullModule.registerQueue({ name: QUEUE.avScan })],
  controllers: [FilesController],
  providers: [
    FsNodesService,
    FsTreeService,
    UploadsService,
    FileVersionsService,
    FileSharingService,
  ],
})
export class FilesModule {}
