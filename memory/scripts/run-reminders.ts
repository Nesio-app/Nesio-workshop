/**
 * Manual cron: npx tsx scripts/run-reminders.ts
 * Production: curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/reminders
 */

async function main() {
  const url = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("CRON_SECRET required");
    process.exit(1);
  }

  const res = await fetch(`${url}/api/cron/reminders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = await res.json();
  console.log(json);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
