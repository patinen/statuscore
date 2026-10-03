import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

export enum NotificationType {
  DISCORD = 'DISCORD',
  WEBHOOK = 'WEBHOOK',
}

export class CreateNotificationChannelDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Length(1, 100)
  name: string;

  @IsEnum(NotificationType)
  type: NotificationType;

  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @IsUrl({ require_tld: true, protocols: ['https'], require_protocol: true })
  url: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Type(() => String)
  monitorIds: string[];
}

export class UpdateNotificationChannelDto {
  @IsOptional()
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @IsUrl({ require_tld: true, protocols: ['https'], require_protocol: true })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Type(() => String)
  monitorIds?: string[];
}

export class NotificationDeliveryQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['all', 'pending', 'sent', 'failed'])
  status?: 'all' | 'pending' | 'sent' | 'failed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
