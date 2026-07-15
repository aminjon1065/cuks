import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  activateCertificateSchema,
  signDocumentSchema,
  type ActivateCertificateInput,
  type CertificateDto,
  type SignatureDto,
  type SignDocumentInput,
  type SignPayloadDto,
  type VerifyResultDto,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { SignaturesService } from './signatures.service';

const uuidSchema = z.string().uuid();

/**
 * Digital signatures (docs/modules/11 §6, docs/09-security.md §4, task 3.5): device
 * certificate activation and signing require `docflow.sign` (a 2FA-gated permission — a
 * conscious action); reading the card's signatures and verifying a signature use the
 * common `docflow.use` (verification is open to any authenticated docflow user).
 */
@ApiTags('docflow')
@Controller()
export class SignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Post('signatures/activate')
  @RequirePermission('docflow.sign')
  @ApiOperation({ summary: 'Issue a device signing certificate from a browser-generated key' })
  activate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(activateCertificateSchema)) body: ActivateCertificateInput,
  ): Promise<CertificateDto> {
    return this.signatures.activate(body, user);
  }

  @Get('signatures/certificates')
  @RequirePermission('docflow.sign')
  @ApiOperation({ summary: "The caller's own signing certificates" })
  myCertificates(@CurrentUser() user: AuthUser): Promise<CertificateDto[]> {
    return this.signatures.myCertificates(user);
  }

  @Get('docflow/documents/:id/signatures')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Signatures on a document (with a live validity check)' })
  forDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<SignatureDto[]> {
    return this.signatures.forDocument(id, user);
  }

  @Get('docflow/documents/:id/sign-payload')
  @RequirePermission('docflow.sign')
  @ApiOperation({ summary: 'The canonical payload to sign for the current file version' })
  signPayload(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<SignPayloadDto> {
    return this.signatures.signPayload(id, user);
  }

  @Post('docflow/documents/:id/actions/sign')
  @RequirePermission('docflow.sign')
  @ApiOperation({ summary: 'Sign the document at its active signing step' })
  sign(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(signDocumentSchema)) body: SignDocumentInput,
  ): Promise<SignatureDto[]> {
    return this.signatures.sign(id, body, user);
  }

  @Get('verify/:signatureId')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Verify a signature (validity, CA chain, revocation, file hash)' })
  verify(
    @CurrentUser() user: AuthUser,
    @Param('signatureId', new ZodValidationPipe(uuidSchema)) signatureId: string,
  ): Promise<VerifyResultDto> {
    return this.signatures.verify(signatureId, user);
  }
}
