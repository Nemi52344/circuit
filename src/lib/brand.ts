import { getSetting } from "@/lib/db";

export type Brand = { name: string; tagline: string; tone: string; colors: string; claims: string; audience: string; website: string };

export const DEFAULT_BRAND: Brand = {
  name: "BNC Motors",
  tagline: "Electric motorcycles built in India",
  tone: "Confident, precise, no hype. Short sentences. Talk range, build quality and ownership cost, not buzzwords.",
  colors: "Emerald, graphite, bone",
  claims: "",
  audience: "Urban commuters 22 to 40 in Indian metros; fleet buyers; dealers",
  website: "",
};

export function getBrand(): Brand {
  const raw = getSetting("brand");
  if (!raw) return DEFAULT_BRAND;
  try {
    return { ...DEFAULT_BRAND, ...(JSON.parse(raw) as Partial<Brand>) };
  } catch {
    return DEFAULT_BRAND;
  }
}
