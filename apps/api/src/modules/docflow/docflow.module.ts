import { Module } from '@nestjs/common';
import { DocflowController } from './docflow.controller';
import { CorrespondentsService } from './correspondents.service';
import { DocflowDictionariesService } from './docflow-dictionaries.service';
import { DocflowNumberingService } from './docflow-numbering.service';
import { JournalsService } from './journals.service';
import { NomenclatureService } from './nomenclature.service';

/**
 * Docflow module (docs/modules/11). Task 3.1 lands the reference-data layer —
 * journals + gap-free numbering, correspondents, nomenclature and document types.
 * The numbering service is exported for the document registration flow (task 3.2+).
 */
@Module({
  controllers: [DocflowController],
  providers: [
    JournalsService,
    CorrespondentsService,
    NomenclatureService,
    DocflowDictionariesService,
    DocflowNumberingService,
  ],
  exports: [DocflowNumberingService, JournalsService],
})
export class DocflowModule {}
