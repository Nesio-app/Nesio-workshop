import { type CreateSignalInput } from './create-signal';

// CARD SPEC:语音标题 = 首分句(干净标题),全文仍在 payload.text/raw(详情「原始记录」可读)。
// 此前 slice(0,40) 生生把长转写截成半句乱码当标题。
function firstClause(text: string, max = 24): string {
  const t = text.trim();
  const head = (t.split(/[。！？!?\n;；,，]/).find((s) => s.trim()) || t).trim();
  return head.length > max ? `${head.slice(0, max)}…` : head;
}

export function normalizeVoiceToSignal(input: { text: string; occurredAt?: string | Date; tags?: string[] }): CreateSignalInput {
  return {
    source: 'voice',
    type: 'observation',
    title: firstClause(input.text) || '语音记录',
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

export function normalizeTeslaDriveToSignal(input: { vehicleId: string; at: string; shiftState?: string; speedMph?: number | null; odometerMi?: number | null; latitude?: number | null; longitude?: number | null; displayName?: string }): CreateSignalInput {
  const driving = input.shiftState === 'D' || (typeof input.speedMph === 'number' && (input.speedMph || 0) > 0);
  return {
    source: 'tesla',
    type: driving ? 'vehicle.drive' : 'vehicle.state',
    title: driving ? `${input.displayName || '车'}行驶中` : `${input.displayName || '车'}停放`,
    payload: {
      shiftState: input.shiftState || '',
      speedMph: input.speedMph ?? null,
      odometerMi: input.odometerMi ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      vehicleId: input.vehicleId,
    },
    occurredAt: input.at,
    confidence: 0.9,
    retentionPolicy: 'Normal',
    tags: ['出行', 'Tesla'],
    externalId: `tesla-drive-${input.vehicleId}-${input.at}`,
  };
}

export function normalizeTeslaChargeToSignal(input: { vehicleId: string; at: string; costUsd?: number | null; energyAddedKwh?: number | null; batteryLevel?: number | null; chargingState?: string; location?: string; displayName?: string }): CreateSignalInput {
  const hasCost = typeof input.costUsd === 'number' && (input.costUsd || 0) > 0;
  return {
    source: 'tesla',
    type: 'vehicle.charge',
    title: hasCost
      ? `充电 $${(input.costUsd as number).toFixed(2)}`
      : `充电${typeof input.energyAddedKwh === 'number' ? ` +${input.energyAddedKwh}kWh` : ''}`,
    payload: {
      costUsd: input.costUsd ?? null,
      energyAddedKwh: input.energyAddedKwh ?? null,
      batteryLevel: input.batteryLevel ?? null,
      chargingState: input.chargingState || '',
      location: input.location || '',
      vehicleId: input.vehicleId,
    },
    occurredAt: input.at,
    confidence: 0.9,
    // Charging cost is financial — tags '财务'/'finance' route it into the
    // finance life-state dimension + financial sensitivity/retention.
    sensitivity: hasCost ? 'financial' : 'normal',
    retentionPolicy: hasCost ? 'LongLiving' : 'Normal',
    tags: hasCost ? ['财务', 'finance', '充电', 'Tesla'] : ['充电', 'Tesla'],
    externalId: `tesla-charge-${input.vehicleId}-${input.at}`,
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
