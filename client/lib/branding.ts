const HEX = /^#[0-9a-f]{3,8}$/i;

const DEFAULTS = {
  '--brand-primary': '#1d4ed8',
  '--brand-accent': '#f59e0b',
} as const;

export function brandingToCssVars(branding: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULTS };
  if (branding && typeof branding === 'object') {
    const b = branding as Record<string, unknown>;
    if (typeof b.primaryColor === 'string' && HEX.test(b.primaryColor)) {
      out['--brand-primary'] = b.primaryColor;
    }
    if (typeof b.accentColor === 'string' && HEX.test(b.accentColor)) {
      out['--brand-accent'] = b.accentColor;
    }
  }
  return out;
}
