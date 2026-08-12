export async function sendAlert(signal: string, message: string): Promise<void> {
  const line = `[alert] ${signal}: ${message}`;
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    console.error(line);
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: line }),
    });
    if (!res.ok) console.error(`${line} (webhook ${res.status})`);
  } catch (err) {
    // An alert that throws takes down the job it was meant to report on.
    console.error(line, err);
  }
}
