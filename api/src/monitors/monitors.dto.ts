import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Max, Min } from 'class-validator';

const monitorMethods = ['GET', 'HEAD'];

export class CreateMonitorDto {
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(1, 100)
  name: string;

  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(1, 2048)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
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
  @Min(60)
  @Max(86400)
  intervalSeconds: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(30000)
  timeoutMs: number = 10000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  failureThreshold: number = 3;

  @IsBoolean()
  enabled: boolean = true;
}

export class UpdateMonitorDto {
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @Length(1, 2048)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
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
  @Min(60)
  @Max(86400)
  intervalSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(30000)
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
