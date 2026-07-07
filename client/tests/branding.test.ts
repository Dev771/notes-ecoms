import { describe, it, expect } from 'vitest'
import { brandingToCssVars } from '@/lib/branding'

describe('brandingToCssVars', () => {
  it('maps known keys to CSS variables', () => {
    expect(brandingToCssVars({ primaryColor: '#112233', accentColor: '#445566' })).toEqual({
      '--brand-primary': '#112233',
      '--brand-accent': '#445566',
    })
  })

  it('applies defaults for missing keys and non-object input', () => {
    const defaults = { '--brand-primary': '#1d4ed8', '--brand-accent': '#f59e0b' }
    expect(brandingToCssVars({})).toEqual(defaults)
    expect(brandingToCssVars(null)).toEqual(defaults)
    expect(brandingToCssVars('junk')).toEqual(defaults)
  })

  it('ignores values that are not hex colors', () => {
    expect(brandingToCssVars({ primaryColor: 'javascript:alert(1)' })['--brand-primary']).toBe('#1d4ed8')
  })
})
