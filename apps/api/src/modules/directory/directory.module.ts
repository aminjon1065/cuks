import { Module } from '@nestjs/common';
import { DirectoryController } from './directory.controller';
import { DirectoryService } from './directory.service';

/** People/org-unit directory for cross-module pickers (task 1.5). */
@Module({
  controllers: [DirectoryController],
  providers: [DirectoryService],
})
export class DirectoryModule {}
