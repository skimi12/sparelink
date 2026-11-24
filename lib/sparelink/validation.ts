import { z } from "zod";
import { CATEGORIES, CONDITIONS, PREFECTURES, japaneseDate, normalizePartNumber } from "./domain.ts";

const safeText = (maximum: number, minimum = 1) => z.string().trim().min(minimum, "入力してください。").max(maximum, `${maximum}文字以内で入力してください。`).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "使用できない制御文字が含まれています。");
const common = {
  manufacturer: safeText(80).refine(value => !/[@<>\r\n]/.test(value), "メーカー名を入力してください。連絡先は入力できません。"),
  partNumber: safeText(100).refine(value => /^[A-Z0-9][A-Z0-9 ._\/+()\-]*$/.test(normalizePartNumber(value)), "型番は英数字と . - _ / + ( ) で入力してください。"),
  category: z.enum(CATEGORIES),
  quantity: z.number().int("数量は整数で入力してください。").min(1).max(100_000),
  condition: z.enum(CONDITIONS),
  region: z.enum(PREFECTURES),
  description: safeText(1200, 0).default(""),
  companyName: safeText(120),
  contactName: safeText(80),
  consent: z.literal(true, { errorMap: () => ({ message: "利用条件と個人情報の取扱いへの同意が必要です。" }) }),
};

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const requestSchema = z.object({
  ...common,
  deadline: z.string().refine(validDate, "正しい希望日を入力してください。").refine(value => value >= japaneseDate(), "希望日は本日以降にしてください。"),
  leadTimeDays: z.null().optional(),
}).strict();

export const listingSchema = z.object({
  ...common,
  condition: z.enum(["new", "used", "untested"]),
  leadTimeDays: z.number().int().min(0).max(365),
  deadline: z.null().optional(),
}).strict();

export const statusSchema = z.object({ status: z.enum(["closed", "archived"]) }).strict();
export const moderationSchema = z.object({ reviewStatus: z.enum(["approved", "rejected"]) }).strict();
