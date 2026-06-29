import { type CreateSignalInput } from './create-signal';

export function normalizeVoiceToSignal(input: { text: string; occurredAt?: string | Date; tags?: string[] }): CreateSignalInput {
  return {
    source: 'voice',
    type: 'observation',
    title: input.text.slice(0, 40) || '语音记录',
    payload: { text: input.text },
    occurredAt: input.occurredAt,
    confidence: 0.75,
    retentionPolicy: 'Normal',
    tags: input.tags,
    raw: input.text,
  };
}

export function normalizePhotoToSignal(input: { title: string; summary?: string; tags?: string[]; occurredAt?: string | Date; assetId?: string }): CreateSignalInput {
  return {
    source: 'photo',
    type: 'object.location',
    title: input.title,
    payload: { summary: input.summary || input.title, assetId: input.assetId || '' },
    occurredAt: input.occurredAt,
    confidence: 0.72,
    retentionPolicy: 'Normal',
    tags: input.tags,
    raw: input.summary,
  };
}

export function normalizeCalendarToSignal(input: { id?: string; title: string; start: string; end?: string; location?: string; calendarName?: string }): CreateSignalInput {
  return {
    source: 'calendar',
    type: 'event',
    title: input.title || 'Calendar Event',
    payload: {
      start: input.start,
      end: input.end || '',
      location: input.location || '',
      calendarName: input.calendarName || '',
      calendarId: input.id || input.start,
    },
    occurredAt: input.start,
    confidence: 1,
    retentionPolicy: 'Normal',
    tags: ['日历', input.calendarName || 'Google Calendar'],
    raw: `${input.title} ${input.start}`,
    externalId: input.id || input.start,
  };
}

export function normalizeGmailToSignal(input: { id?: string; subject: string; snippet?: string; occurredAt?: string | Date; from?: string }): CreateSignalInput {
  return {
    source: 'gmail',
    type: 'message',
    title: input.subject || 'Gmail message',
    payload: { snippet: input.snippet || '', from: input.from || '' },
    occurredAt: input.occurredAt,
    confidence: 0.75,
    sensitivity: 'private',
    retentionPolicy: 'LongLiving',
    tags: ['Gmail'],
    raw: input.snippet,
    externalId: input.id,
  };
}

export function normalizeHealthToSignal(input: { title: string; metricType?: string; hours?: number; energy?: number; status?: string; occurredAt?: string | Date }): CreateSignalInput {
  return {
    source: 'health',
    type: input.metricType || 'health.state',
    title: input.title,
    payload: { type: input.metricType || 'health.state', hours: input.hours ?? null, energy: input.energy ?? null, status: input.status || 'recorded' },
    occurredAt: input.occurredAt,
    confidence: 0.8,
    sensitivity: 'health',
    retentionPolicy: 'LongLiving',
    tags: ['健康', input.metricType || 'health'],
  };
}

export function normalizeTaskToSignal(input: { id?: string; title: string; dueAt?: string; priority?: string; status?: string }): CreateSignalInput {
  return {
    source: 'task',
    type: 'task.deadline',
    title: input.title,
    payload: { dueAt: input.dueAt || '', priority: input.priority || '', status: input.status || 'open' },
    occurredAt: input.dueAt,
    confidence: 0.85,
    retentionPolicy: 'Normal',
    tags: ['任务', input.priority || ''],
    externalId: input.id,
  };
}

export function normalizeWeatherToSignal(input: { temperatureC: number; condition: string; forecastNote?: string; placeName?: string; capturedAt?: string | Date }): CreateSignalInput {
  return {
    source: 'weather',
    type: 'weather.forecast',
    title: input.placeName ? `${input.placeName} 天气` : '天气信号',
    payload: { temperatureC: input.temperatureC, condition: input.condition, forecastNote: input.forecastNote || '' },
    occurredAt: input.capturedAt,
    confidence: 0.9,
    retentionPolicy: 'Disposable',
    tags: ['天气', input.condition],
    raw: input.forecastNote,
  };
}
