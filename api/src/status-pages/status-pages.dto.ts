import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

const statusPageSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedStatusPageSlugs = new Set(['api', 'auth', 'admin', 'login', 'status', 'public']);

function IsReservedStatusPageSlug(validationOptions?: ValidationOptions) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'IsReservedStatusPageSlug',
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && !reservedStatusPageSlugs.has(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} is reserved.`;
        },
      },
    });
  };
}

function IsExplicitNull(validationOptions?: ValidationOptions) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'IsExplicitNull',
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return value === null;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be null.`;
        },
      },
    });
  };
}

export class CreateStatusPageDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Length(1, 100)
  name: string;

  @IsString()
  @Length(3, 80)
  @Matches(statusPageSlugPattern, {
    message: 'slug must use lowercase letters, numbers, and single hyphens only.',
  })
  @IsReservedStatusPageSlug({ message: 'slug is reserved.' })
  slug: string;

  @IsOptional()
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Length(1, 500)
  description?: string;

  @IsArray()
  @ArrayMaxSize(25)
  @ArrayUnique()
  @Type(() => String)
  monitorIds: string[];
}

export class UpdateStatusPageDto {
  @IsOptional()
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(3, 80)
  @Matches(statusPageSlugPattern, {
    message: 'slug must use lowercase letters, numbers, and single hyphens only.',
  })
  @IsReservedStatusPageSlug({ message: 'slug is reserved.' })
  slug?: string;

  @ValidateIf((_: object, value: unknown) => value !== undefined)
  @Transform(({ value }) => {
    if (value === null) {
      return null;
    }

    return String(value ?? '').trim();
  })
  @ValidateIf((_: object, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @Length(1, 500)
  @ValidateIf((_: object, value: unknown) => value === null)
  @IsExplicitNull()
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @ArrayUnique()
  @Type(() => String)
  monitorIds?: string[];
}
