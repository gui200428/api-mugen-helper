import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

export class AdminLoginDto {
  @IsEmail()
  email: string;

  // L3: Added @IsString() to enforce type at runtime
  @IsString()
  @IsNotEmpty()
  password: string;
}
