export type ConnectorStatus = {
  meta: boolean;
  googleAds: boolean;
  twenty: boolean;
  openai: boolean;
};

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function getConnectorStatus(): ConnectorStatus {
  return {
    meta: isSet("META_ACCESS_TOKEN") && isSet("META_AD_ACCOUNT_ID"),
    googleAds:
      isSet("GOOGLE_ADS_DEVELOPER_TOKEN") &&
      isSet("GOOGLE_ADS_CLIENT_ID") &&
      isSet("GOOGLE_ADS_CLIENT_SECRET") &&
      isSet("GOOGLE_ADS_REFRESH_TOKEN") &&
      isSet("GOOGLE_ADS_CUSTOMER_ID"),
    twenty: isSet("TWENTY_API_KEY"),
    openai: isSet("OPENAI_API_KEY"),
  };
}
