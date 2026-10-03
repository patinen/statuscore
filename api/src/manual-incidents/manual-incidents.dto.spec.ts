import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ManualIncidentImpact, ManualIncidentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  CreateManualIncidentDto,
  CreateManualIncidentUpdateDto,
  UpdateManualIncidentDto,
} from './manual-incidents.dto.js';

const validationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

const monitorId = '11111111-1111-4111-8111-111111111111';

const transformBody = <T>(metatype: new () => T, payload: unknown) =>
  validationPipe.transform(payload, {
    type: 'body',
    metatype,
    data: '',
  }) as Promise<T>;

describe('Manual incident DTO validation and normalization', () => {
  it('rejects whitespace-only title and message fields', async () => {
    await expect(
      transformBody(CreateManualIncidentDto, {
        title: '   ',
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: [monitorId],
        message: 'Investigating',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      transformBody(CreateManualIncidentDto, {
        title: 'Login outage',
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: [monitorId],
        message: '   ',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(transformBody(UpdateManualIncidentDto, { title: '   ' })).rejects.toThrow(BadRequestException);

    await expect(
      transformBody(CreateManualIncidentUpdateDto, {
        status: ManualIncidentStatus.IDENTIFIED,
        message: '   ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('trims valid string fields while preserving value constraints', async () => {
    const created = await transformBody(CreateManualIncidentDto, {
      title: '  Login outage  ',
      impact: ManualIncidentImpact.MAJOR_OUTAGE,
      monitorIds: [monitorId],
      message: '  Root cause identified  ',
    });

    expect(created.title).toBe('Login outage');
    expect(created.message).toBe('Root cause identified');

    const update = await transformBody(CreateManualIncidentUpdateDto, {
      status: ManualIncidentStatus.MONITORING,
      message: '  Mitigation deployed  ',
    });

    expect(update.message).toBe('Mitigation deployed');
  });

  it('rejects non-string title and message values', async () => {
    await expect(
      transformBody(CreateManualIncidentDto, {
        title: 123,
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: [monitorId],
        message: 'Investigating',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      transformBody(CreateManualIncidentDto, {
        title: 'Valid title',
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: [monitorId],
        message: { text: 'Investigating' },
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(transformBody(UpdateManualIncidentDto, { title: { bad: true } })).rejects.toThrow(BadRequestException);

    await expect(
      transformBody(CreateManualIncidentUpdateDto, {
        status: ManualIncidentStatus.IDENTIFIED,
        message: 500,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('enforces maximum lengths after trimming', async () => {
    await expect(
      transformBody(CreateManualIncidentDto, {
        title: 'x'.repeat(151),
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: [monitorId],
        message: 'Investigating',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      transformBody(CreateManualIncidentDto, {
        title: 'Valid title',
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: [monitorId],
        message: 'x'.repeat(2001),
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(transformBody(UpdateManualIncidentDto, { title: 'x'.repeat(151) })).rejects.toThrow(BadRequestException);

    await expect(
      transformBody(CreateManualIncidentUpdateDto, {
        status: ManualIncidentStatus.MONITORING,
        message: 'x'.repeat(2001),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
