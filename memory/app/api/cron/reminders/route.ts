import { prisma } from "@/lib/db";
import { assertCronAuth, jsonError, jsonOk } from "@/lib/api-response";
import { buildMemorialSchedule, dueRemindersToday, formatZhDate } from "@/lib/dates";
import { sendGmailReminder } from "@/lib/composio";

export async function POST(request: Request) {
  if (!assertCronAuth(request)) return jsonError("Unauthorized", 401);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const memorials = await prisma.memorial.findMany({
    include: { reminders: true },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const memorial of memorials) {
    const schedule = buildMemorialSchedule(memorial.deathDate);
    const due = dueRemindersToday(schedule, 7);

    for (const event of due) {
      for (const sub of memorial.reminders) {
        const eventDate = event.date.toISOString().slice(0, 10);
        const eventKey = `${event.id}_${eventDate}`;

        const already = await prisma.reminderDispatch.findUnique({
          where: {
            memorialId_email_eventKey_eventDate: {
              memorialId: memorial.id,
              email: sub.email,
              eventKey,
              eventDate: event.date,
            },
          },
        });
        if (already) {
          skipped++;
          continue;
        }

        const result = await sendGmailReminder({
          to: sub.email,
          memorialName: memorial.name,
          eventLabel: event.label,
          eventDate: formatZhDate(event.date),
          memorialUrl: `${appUrl}/index.html#profile-${memorial.slug}`,
        });

        if (result.ok) {
          await prisma.reminderDispatch.create({
            data: {
              memorialId: memorial.id,
              email: sub.email,
              eventKey,
              eventDate: event.date,
            },
          });
          sent++;
        } else {
          errors.push(`${sub.email}/${eventKey}: ${result.error}`);
        }
      }
    }
  }

  return jsonOk({ sent, skipped, errors });
}

export async function GET(request: Request) {
  return POST(request);
}
