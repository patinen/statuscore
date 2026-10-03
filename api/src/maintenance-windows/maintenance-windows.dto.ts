import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  Matches,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

const ISO_8601_DATE_TIME_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

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

  @IsString()
  @Matches(ISO_8601_DATE_TIME_WITH_ZONE, {
    message: 'startsAt must be an ISO-8601 date-time string with timezone.',
  })
  startsAt: string;

  @IsString()
  @Matches(ISO_8601_DATE_TIME_WITH_ZONE, {
    message: 'endsAt must be an ISO-8601 date-time string with timezone.',
  })
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
  @IsString()
  @Matches(ISO_8601_DATE_TIME_WITH_ZONE, {
    message: 'startsAt must be an ISO-8601 date-time string with timezone.',
  })
  startsAt?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_8601_DATE_TIME_WITH_ZONE, {
    message: 'endsAt must be an ISO-8601 date-time string with timezone.',
  })
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
