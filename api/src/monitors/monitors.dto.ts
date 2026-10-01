import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

const monitorMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

export class CreateMonitorDto {
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(1, 255)
  name: string;

  @Transform(({ value }) => String(value).trim())
  @IsString()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  url: string;

  @IsString()
  @IsIn(monitorMethods)
  method: string = 'GET';

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  expectedStatusCode: number = 200;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(86400)
  intervalSeconds: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(60000)
  timeoutMs: number = 10000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  failureThreshold: number = 3;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateMonitorDto {
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(1, 255)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  url?: string;

  @IsOptional()
  @IsString()
  @IsIn(monitorMethods)
  method?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  expectedStatusCode?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(86400)
  intervalSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(60000)
  timeoutMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  failureThreshold?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
