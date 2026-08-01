import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE } from '@cuks/shared';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { DocflowController } from './docflow.controller';
import { DocumentsController } from './documents.controller';
import { RoutesController } from './routes.controller';
import { ResolutionsController } from './resolutions.controller';
import { SignaturesController } from './signatures.controller';
import { AcknowledgementsController } from './acknowledgements.controller';
import { DocumentLinksController } from './document-links.controller';
import { ControlController } from './control.controller';
import { ReportsController } from './reports.controller';
import { SubstitutionsController } from './substitutions.controller';
import { CorrespondentsService } from './correspondents.service';
import { DocflowDictionariesService } from './docflow-dictionaries.service';
import { DocflowFilesService } from './docflow-files.service';
import { DocflowNumberingService } from './docflow-numbering.service';
import { DocumentCollaboratorsService } from './document-collaborators.service';
import { DocumentTemplatesController } from './document-templates.controller';
import { DocumentTemplatesService } from './document-templates.service';
import { AcquaintanceGateService } from './acquaintance-gate.service';
import { ResolutionProposalsController } from './resolution-proposals.controller';
import { ResolutionProposalsService } from './resolution-proposals.service';
import { ResolutionTypesService } from './resolution-types.service';
import { ArchiveController } from './archive.controller';
import { DocumentSearchController } from './document-search.controller';
import { DocumentSearchService } from './document-search.service';
import { AttentionService } from './attention.service';
import { RegisterReportsService } from './register-reports.service';
import { DocumentViewsController } from './document-views.controller';
import { DocumentViewsService } from './document-views.service';
import { ExchangeRegistryService } from './exchange/exchange-registry.service';
import { ExchangeSenderService } from './exchange/exchange-sender.service';
import { ExchangeReceiverService } from './exchange/exchange-receiver.service';
import { InboundReviewController } from './exchange/inbound-review.controller';
import { InboundReviewService } from './exchange/inbound-review.service';
import { ArchiveService } from './archive.service';
import { DispatchesController } from './dispatches.controller';
import { DistributionsController } from './distributions.controller';
import { DistributionsService } from './distributions.service';
import { DispatchesService } from './dispatches.service';
import { DocumentResponsesService } from './document-responses.service';
import { DocumentsService } from './documents.service';
import { JournalsService } from './journals.service';
import { NomenclatureService } from './nomenclature.service';
import { RoutesService } from './routes.service';
import { ResolutionsService } from './resolutions.service';
import { CaService } from './ca.service';
import { SignaturesService } from './signatures.service';
import { AcknowledgementsService } from './acknowledgements.service';
import { DocumentLinksService } from './document-links.service';
import { ControlService } from './control.service';
import { ReportsService } from './reports.service';
import { ReadLogService } from './read-log.service';
import { SubstitutionsService } from './substitutions.service';
import { DocflowDeadlineOutboxService } from './docflow-deadline-outbox.service';

/**
 * Docflow module (docs/modules/11). Task 3.1 lands the reference-data layer
 * (journals + gap-free numbering, correspondents, nomenclature); task 3.2 adds the
 * document card, its files and the status machine; 3.3 routes; 3.4 resolutions; 3.5 the
 * internal ЭЦП (CA, device certificates, signing and verification).
 */
@Module({
  // The exchange receiver puts inbound attachments through the SAME antivirus queue as an
  // ordinary upload — a second scanner would eventually give a second verdict.
  imports: [AuthModule, EventsModule, BullModule.registerQueue({ name: QUEUE.avScan })],
  controllers: [
    DocflowController,
    DocumentsController,
    DocumentTemplatesController,
    RoutesController,
    ResolutionsController,
    ResolutionProposalsController,
    DispatchesController,
    DistributionsController,
    ArchiveController,
    DocumentSearchController,
    DocumentViewsController,
    InboundReviewController,
    SignaturesController,
    AcknowledgementsController,
    DocumentLinksController,
    ControlController,
    ReportsController,
    SubstitutionsController,
  ],
  providers: [
    JournalsService,
    CorrespondentsService,
    NomenclatureService,
    DocflowDictionariesService,
    DocflowNumberingService,
    DocumentsService,
    DocumentResponsesService,
    DispatchesService,
    DistributionsService,
    ArchiveService,
    DocumentSearchService,
    AttentionService,
    RegisterReportsService,
    DocumentViewsService,
    ExchangeRegistryService,
    ExchangeSenderService,
    ExchangeReceiverService,
    InboundReviewService,
    DocflowFilesService,
    DocumentCollaboratorsService,
    DocumentTemplatesService,
    RoutesService,
    ResolutionsService,
    ResolutionProposalsService,
    ResolutionTypesService,
    AcquaintanceGateService,
    CaService,
    SignaturesService,
    AcknowledgementsService,
    DocumentLinksService,
    ControlService,
    ReportsService,
    ReadLogService,
    SubstitutionsService,
    DocflowDeadlineOutboxService,
  ],
  exports: [DocflowNumberingService, JournalsService],
})
export class DocflowModule {}
