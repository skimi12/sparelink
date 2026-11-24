export const CATEGORIES = ["plc", "inverter", "servo", "hmi", "sensor", "other"] as const;
export const CATEGORY_LABELS = { plc: "PLC", inverter: "インバータ", servo: "サーボ", hmi: "タッチパネル", sensor: "センサー", other: "その他" } as const;
export const CONDITIONS = ["new", "used", "untested", "any"] as const;
export const CONDITION_LABELS = { new: "新品・未使用", used: "中古", untested: "動作未確認", any: "指定なし" } as const;
export const PREFECTURES = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"] as const;
export type RecordKind = "request" | "listing";
export type Category = typeof CATEGORIES[number];
export type Condition = typeof CONDITIONS[number];
export type RecordStatus = "open" | "closed" | "archived";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type PublicRecord = {
  id: string; kind: RecordKind; manufacturer: string; partNumber: string;
  category: Category; quantity: number; condition: Condition; region: string;
  deadline: string | null; leadTimeDays: number | null; status: RecordStatus;
  createdAt: string; updatedAt: string; isDemo?: boolean;
};

/** Conservative normalization: preserve every part-number separator and suffix. */
export function normalizePartNumber(value: string): string {
  return value.normalize("NFKC").toUpperCase().trim()
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-");
}

const MANUFACTURER_ALIASES: Record<string, string> = {
  "オムロン": "OMRON", "OMRON": "OMRON",
  "三菱電機": "MITSUBISHI ELECTRIC", "MITSUBISHI ELECTRIC": "MITSUBISHI ELECTRIC",
  "MITSUBISHI": "MITSUBISHI ELECTRIC",
  "キーエンス": "KEYENCE", "KEYENCE": "KEYENCE",
  "安川電機": "YASKAWA", "YASKAWA": "YASKAWA",
  "パナソニック": "PANASONIC", "PANASONIC": "PANASONIC",
  "シーメンス": "SIEMENS", "SIEMENS": "SIEMENS",
  "ファナック": "FANUC", "FANUC": "FANUC",
  "富士電機": "FUJI ELECTRIC", "FUJI ELECTRIC": "FUJI ELECTRIC",
};

export function normalizeManufacturer(value: string): string {
  const key = value.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
  return MANUFACTURER_ALIASES[key] ?? key;
}

export function japaneseDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** An exact label match is a search candidate, never proof of compatibility. */
export function samePart(a: Pick<PublicRecord, "manufacturer" | "partNumber">, b: Pick<PublicRecord, "manufacturer" | "partNumber">): boolean {
  const partA = normalizePartNumber(a.partNumber), partB = normalizePartNumber(b.partNumber);
  const manufacturerA = normalizeManufacturer(a.manufacturer), manufacturerB = normalizeManufacturer(b.manufacturer);
  return Boolean(partA && partB && manufacturerA && manufacturerB && partA === partB && manufacturerA === manufacturerB);
}

export type Match = {
  requestId: string; listingId: string; manufacturer: string; partNumber: string;
  availableQuantity: number; requestedQuantity: number; quantitySufficient: boolean;
  deadlineFeasible: false | null; dispatchBeforeDeadline: boolean | null; conditionCompatible: boolean;
  requiresVerification: true; isDemo?: boolean;
};

export function matchParts(requests: PublicRecord[], listings: PublicRecord[], now = new Date()): Match[] {
  const matches: Match[] = [];
  for (const request of requests) for (const listing of listings) {
    if (request.kind !== "request" || listing.kind !== "listing" || request.status !== "open" || listing.status !== "open" || !samePart(request, listing)) continue;
    const dispatchDate = listing.leadTimeDays === null ? null : japaneseDate(new Date(now.getTime() + listing.leadTimeDays * 86_400_000));
    matches.push({ requestId: request.id, listingId: listing.id, manufacturer: listing.manufacturer, partNumber: listing.partNumber,
      availableQuantity: listing.quantity, requestedQuantity: request.quantity, quantitySufficient: listing.quantity >= request.quantity,
      // Shipping before the requested date does not prove delivery by that date.
      deadlineFeasible: request.deadline && dispatchDate && dispatchDate > request.deadline ? false : null,
      dispatchBeforeDeadline: request.deadline && dispatchDate ? dispatchDate <= request.deadline : null,
      conditionCompatible: request.condition === "any" || request.condition === listing.condition,
      requiresVerification: true, ...(request.isDemo || listing.isDemo ? { isDemo: true } : {}),
    });
  }
  return matches;
}

/** Only this explicit allowlist is safe for public catalog responses. */
export function toPublicRecord(record: PublicRecord & Record<string, unknown>): PublicRecord {
  return {
    id: record.id, kind: record.kind, manufacturer: record.manufacturer, partNumber: record.partNumber,
    category: record.category, quantity: record.quantity, condition: record.condition, region: record.region,
    deadline: record.deadline, leadTimeDays: record.leadTimeDays, status: record.status,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    ...(record.isDemo === true ? { isDemo: true } : {}),
  };
}
