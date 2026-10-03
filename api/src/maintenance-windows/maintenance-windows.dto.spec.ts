import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateMaintenanceWindowDto, UpdateMaintenanceWindowDto } from './maintenance-windows.dto.js';

const validationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

describe('Maintenance window DTO ValidationPipe', () => {
  it('accepts ISO-8601 date-time strings with timezone for create and update', async () => {
    await expect(
      validationPipe.transform(
        {
          title: 'Window',
          startsAt: '2026-10-03T18:00:00.000Z',
          endsAt: '2026-10-03T20:00:00+02:00',
          monitorIds: ['11111111-1111-4111-8111-111111111111'],
        },
        { type: 'body', metatype: CreateMaintenanceWindowDto } as never,
      ),
    ).resolves.toBeInstanceOf(CreateMaintenanceWindowDto);

    await expect(
      validationPipe.transform(
        {
          startsAt: '2026-10-03T18:00:00.000Z',
          endsAt: '2026-10-03T20:00:00+02:00',
        },
        { type: 'body', metatype: UpdateMaintenanceWindowDto } as never,
      ),
    ).resolves.toBeInstanceOf(UpdateMaintenanceWindowDto);
  });

  it.each([
    123,
    {},
    'tomorrow',
    '10/03/2026',
  ])('rejects invalid create startsAt value: %p', async (startsAt) => {
    await expect(
      validationPipe.transform(
        {
          title: 'Window',
          startsAt,
          endsAt: '2026-10-03T20:00:00.000Z',
          monitorIds: ['11111111-1111-4111-8111-111111111111'],
        },
        { type: 'body', metatype: CreateMaintenanceWindowDto } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    123,
    {},
    'tomorrow',
    '10/03/2026',
  ])('rejects invalid update endsAt value: %p', async (endsAt) => {
    await expect(
      validationPipe.transform(
        {
          endsAt,
        },
        { type: 'body', metatype: UpdateMaintenanceWindowDto } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
