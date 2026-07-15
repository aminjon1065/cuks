import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { dictionaries, type Database } from '@cuks/db';
import type { CorrespondentCategoryDto, DocumentTypeDto } from '@cuks/shared';
import { DB } from '../../common/db/db.module';

/** Read-only dictionary options for the docflow forms — document types and
 *  correspondent categories (docs/07 §dictionaries). The dictionaries themselves are
 *  managed through the admin dictionaries CRUD; here we just expose the active list. */
@Injectable()
export class DocflowDictionariesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  documentTypes(): Promise<DocumentTypeDto[]> {
    return this.activeOptions('doc_type');
  }

  correspondentCategories(): Promise<CorrespondentCategoryDto[]> {
    return this.activeOptions('correspondent_category');
  }

  private async activeOptions(type: 'doc_type' | 'correspondent_category') {
    return this.db
      .select({ code: dictionaries.code, nameRu: dictionaries.nameRu, nameTg: dictionaries.nameTg })
      .from(dictionaries)
      .where(and(eq(dictionaries.type, type), eq(dictionaries.isActive, true)))
      .orderBy(asc(dictionaries.sort), asc(dictionaries.nameRu));
  }
}
