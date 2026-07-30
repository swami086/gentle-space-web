export type NearbyCategory = {
  key: string;
  label: string;
  includedTypes: string[];
};

export type NearbyPlace = {
  name: string;
  distanceMeters: number;
};

export type NearbyGroup = {
  category: string;
  label: string;
  places: { name: string; distanceLabel: string }[];
};
