"use client";

import { CompanyProfileV2 } from "@/components/settings/v2/CompanyProfileV2";
import { useSettingsV2 } from "@/components/settings/v2/SettingsV2Page";
import { CompanyProfileClassic } from "../page.client";

/** The company profile's own address (SETTINGS_V2: the hub takes /settings). Without the flag it shows the classic page. */
export default function CompanyProfilePage() {
  return useSettingsV2() ? <CompanyProfileV2 /> : <CompanyProfileClassic />;
}
