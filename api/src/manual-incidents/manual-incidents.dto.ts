import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { ManualIncidentImpact, ManualIncidentStatus } from '@prisma/client';

const trimIfString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateManualIncidentDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 150)
  title: string;

  @IsEnum(ManualIncidentImpact)
  impact: ManualIncidentImpact;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Type(() => String)
  monitorIds: string[];

  @Transform(trimIfString)
  @IsString()
  @Length(1, 2000)
  message: string;
}

export class UpdateManualIncidentDto {
  @IsOptional()
  @Transform(trimIfString)
  @IsString()
  @Length(1, 150)
  title?: string;

  @IsOptional()
  @IsEnum(ManualIncidentImpact)
  impact?: ManualIncidentImpact;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Type(() => String)
  monitorIds?: string[];
}

export class CreateManualIncidentUpdateDto {
  @IsEnum(ManualIncidentStatus)
  status: ManualIncidentStatus;

  @Transform(trimIfString)
  @IsString()
  @Length(1, 2000)
  message: string;
}
