import {
    IsString,
    IsEmail,
    IsOptional,
    IsUrl,
    IsEnum,
    MaxLength,
} from 'class-validator';
import { ClientStatus } from '@prisma/client';

export class CreateClientDto {
    @IsString()
    @MaxLength(255)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    ownerName?: string;

    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    phone?: string;

    @IsUrl()
    website: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    country?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    language?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    negotiator?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    notes?: string;

    @IsOptional()
    @IsEnum(ClientStatus)
    status?: ClientStatus;
}
