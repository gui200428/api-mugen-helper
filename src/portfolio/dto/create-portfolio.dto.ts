import { IsString, Matches, MaxLength } from 'class-validator';

export class CreatePortfolioDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'Slug must be lowercase alphanumeric with hyphens only (e.g. "restaurante-italiano")',
  })
  slug: string;

  @IsString()
  @MaxLength(200)
  title: string;
}
