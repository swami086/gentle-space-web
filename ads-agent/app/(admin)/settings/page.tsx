import { getCronSettings } from "@/lib/db/settings";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  const settings = await getCronSettings();
  return (
    <main>
      <h1>Settings</h1>
      <SettingsForm settings={settings} />
    </main>
  );
}
