import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateDemoDto {
  @IsUUID()
  clientId: string;

  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase alphanumeric with hyphens only (e.g. "pizzaria-roma")',
  })
  slug: string;
}
