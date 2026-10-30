import type { Currency } from './enums';

/** ISO 4217 minor-unit exponent per supported currency. */
export const CURRENCY_EXPONENT: Readonly<Record<Currency, number>> = { EUR: 2, USD: 2, GBP: 2 };

/** Fixed display locale so server output and tests are deterministic. */
export const DISPLAY_LOCALE = 'en-US';

/**
 * Format an amount in integer minor units (number, bigint or base-10 integer string,
 * e.g. an aggregate sum) as a currency string, e.g. (123456, 'EUR') -> "€1,234.56".
 * Never goes through floating point.
 */
export function formatMinorUnits(amountMinor: number | bigint | string, currencyCode: Currency): string {
  const exp = CURRENCY_EXPONENT[currencyCode];
  const minor = BigInt(amountMinor);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const base = 10n ** BigInt(exp);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(exp, '0');
  const decimal = `${negative ? '-' : ''}${whole}${exp > 0 ? `.${frac}` : ''}`;
  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(decimal as Intl.StringNumericLiteral);
}
