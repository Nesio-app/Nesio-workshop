const MEETING_KEYWORD_PATTERN = /meeting|会议|zoom|meet|call|产品/i;

export function looksLikeMeetingEvent(event) {
  const eventText = [
    event?.title,
    event?.calendarName,
    event?.source,
    event?.description,
    event?.location,
    event?.url,
  ].filter(Boolean).join(' ');

  return MEETING_KEYWORD_PATTERN.test(eventText);
}

