import { IsString, IsNotEmpty } from 'class-validator';

export class AdminRefreshDto {
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}
