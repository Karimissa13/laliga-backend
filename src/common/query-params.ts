import { TransformFnParams } from 'class-transformer';

/**
 * Converters for query-string (and form) parameters, for @Transform(…).
 *
 * The global ValidationPipe runs with `enableImplicitConversion`, which converts a
 * value by its declared type BEFORE @Transform runs — so a boolean parameter sent as
 * "false" would already be `true` (any non-empty text is truthy). These read the
 * value exactly as it was sent (`obj[key]`) instead.
 */
const sent = ({ obj, key, value }: TransformFnParams) => (obj && typeof obj === 'object' && key in obj ? obj[key] : value);

/** "true" / "1" / "yes" / "on" → true; anything else → false; missing or empty → not given. */
export const boolParam = (p: TransformFnParams): boolean | undefined => {
  const v = sent(p);
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
};

/** A number; missing or empty → not given (NaN is left for @IsNumber to refuse). */
export const numParam = (p: TransformFnParams): number | undefined => {
  const v = sent(p);
  return v === undefined || v === null || v === '' ? undefined : Number(v);
};

/** "a,b,c" or a repeated parameter → ['a', 'b', 'c']; missing or empty → not given. */
export const listParam = (p: TransformFnParams): string[] | undefined => {
  const v = sent(p);
  if (v === undefined || v === null || v === '') return undefined;
  return (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
};

/** An empty text field → not given. */
export const emptyToUndefined = (p: TransformFnParams) => {
  const v = sent(p);
  return v === '' ? undefined : p.value;
};
