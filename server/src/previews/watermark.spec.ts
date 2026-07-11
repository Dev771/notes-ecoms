import sharp from 'sharp';
import { applyWatermark } from './watermark';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8]);

async function makeInputPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
}

describe('applyWatermark', () => {
  it('(a) outputs a JPEG buffer', async () => {
    const input = await makeInputPng(400, 300);

    const out = await applyWatermark(input, 'Acme Tuition Centre');

    expect(out.subarray(0, 2)).toEqual(JPEG_MAGIC);
  });

  it('(b) resizes a wide input down to a max width of 900', async () => {
    const input = await makeInputPng(2000, 1000);

    const out = await applyWatermark(input, 'Acme Tuition Centre');

    const meta = await sharp(out).metadata();
    expect(meta.width).toBeLessThanOrEqual(900);
  });

  it('(c) actually composites a watermark rather than just resizing', async () => {
    const input = await makeInputPng(900, 600);

    const watermarked = await applyWatermark(input, 'Acme Tuition Centre');
    const plainResize = await sharp(input)
      .resize({ width: 900, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();

    expect(Buffer.compare(watermarked, plainResize)).not.toBe(0);
  });

  // Regression lock for escapeXml: tenant names are user-controlled and land
  // inside the generated SVG's <text> node — unescaped `&`/`<` make sharp's
  // SVG parser reject the overlay outright, so a name like "R&D" would break
  // preview generation for that tenant. (`'` needs no escaping in element
  // content or double-quoted attributes; it's exercised here anyway.)
  it('(d) tolerates XML-special characters in the watermark text', async () => {
    const input = await makeInputPng(400, 300);

    const out = await applyWatermark(input, `R&D <Sri's> "Notes"`);

    expect(out.subarray(0, 2)).toEqual(JPEG_MAGIC);
  });
});
