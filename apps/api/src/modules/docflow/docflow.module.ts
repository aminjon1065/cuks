import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocflowController } from './docflow.controller';
import { DocumentsController } from './documents.controller';
import { RoutesController } from './routes.controller';
import { ResolutionsController } from './resolutions.controller';
import { SignaturesController } from './signatures.controller';
import { AcknowledgementsController } from './acknowledgements.controller';
import { CorrespondentsService } from './correspondents.service';
import { DocflowDictionariesService } from './docflow-dictionaries.service';
import { DocflowNumberingService } from './docflow-numbering.service';
import { DocumentsService } from './documents.service';
import { JournalsService } from './journals.service';
import { NomenclatureService } from './nomenclature.service';
import { RoutesService } from './routes.service';
import { ResolutionsService } from './resolutions.service';
import { CaService } from './ca.service';
import { SignaturesService } from './signatures.service';
import { AcknowledgementsService } from './acknowledgements.service';

/**
 * Docflow module (docs/modules/11). Task 3.1 lands the reference-data layer
 * (journals + gap-free numbering, correspondents, nomenclature); task 3.2 adds the
 * document card, its files and the status machine; 3.3 routes; 3.4 resolutions; 3.5 the
 * internal ЭЦП (CA, device certificates, signing and verification).
 */
@Module({
  imports: [AuthModule],
  controllers: [
    DocflowController,
    DocumentsController,
    RoutesController,
    ResolutionsController,
    SignaturesController,
    AcknowledgementsController,
  ],
  providers: [
    JournalsService,
    CorrespondentsService,
    NomenclatureService,
    DocflowDictionariesService,
    DocflowNumberingService,
    DocumentsService,
    RoutesService,
    ResolutionsService,
    CaService,
    SignaturesService,
    AcknowledgementsService,
  ],
  exports: [DocflowNumberingService, JournalsService],
})
export class DocflowModule {}
