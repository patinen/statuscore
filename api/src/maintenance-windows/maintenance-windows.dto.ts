import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateMaintenanceWindowDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Length(1, 100)
  title: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    return value;
  })
  @IsString()
  @Length(1, 500)
  description?: string | null;

  @Transform(({ value }) => String(value ?? ''))
  @IsString()
  startsAt: string;

  @Transform(({ value }) => String(value ?? ''))
  @IsString()
  endsAt: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Type(() => String)
  monitorIds: string[];
}

export class UpdateMaintenanceWindowDto {
  @IsOptional()
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Length(1, 100)
  title?: string;

  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    return value;
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string | null;

  @IsOptional()
  @Transform(({ value }) => String(value ?? ''))
  @IsString()
  startsAt?: string;

  @IsOptional()
  @Transform(({ value }) => String(value ?? ''))
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Type(() => String)
  monitorIds?: string[];
}
