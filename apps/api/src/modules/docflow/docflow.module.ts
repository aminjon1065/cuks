import { Module } from '@nestjs/common';
import { DocflowController } from './docflow.controller';
import { DocumentsController } from './documents.controller';
import { RoutesController } from './routes.controller';
import { ResolutionsController } from './resolutions.controller';
import { CorrespondentsService } from './correspondents.service';
import { DocflowDictionariesService } from './docflow-dictionaries.service';
import { DocflowNumberingService } from './docflow-numbering.service';
import { DocumentsService } from './documents.service';
import { JournalsService } from './journals.service';
import { NomenclatureService } from './nomenclature.service';
import { RoutesService } from './routes.service';
import { ResolutionsService } from './resolutions.service';

/**
 * Docflow module (docs/modules/11). Task 3.1 lands the reference-data layer
 * (journals + gap-free numbering, correspondents, nomenclature); task 3.2 adds the
 * document card, its files and the status machine, wiring the numbering into
 * registration. Routes/resolutions/signatures follow in tasks 3.3–3.5.
 */
@Module({
  controllers: [DocflowController, DocumentsController, RoutesController, ResolutionsController],
  providers: [
    JournalsService,
    CorrespondentsService,
    NomenclatureService,
    DocflowDictionariesService,
    DocflowNumberingService,
    DocumentsService,
    RoutesService,
    ResolutionsService,
  ],
  exports: [DocflowNumberingService, JournalsService],
})
export class DocflowModule {}
