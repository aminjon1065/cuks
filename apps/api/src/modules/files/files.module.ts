import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { FileVersionsService } from './file-versions.service';
import { FilesController } from './files.controller';
import { FsNodesService } from './fs-nodes.service';
import { FsTreeService } from './fs-tree.service';
import { UploadsService } from './uploads.service';

/** Files module (docs/modules/12). AdminModule is imported for AclService. */
@Module({
  imports: [AdminModule],
  controllers: [FilesController],
  providers: [FsNodesService, FsTreeService, UploadsService, FileVersionsService],
})
export class FilesModule {}
