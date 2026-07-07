import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      slug: 'default',
      name: 'Topper Notes Institute',
      domains: ['localhost'],
      isDefault: true,
      supportEmail: 'support@example.com',
      paymentMode: 'MANUAL_UPI',
      upiVpa: 'institute@upi',
      branding: { primaryColor: '#1d4ed8', accentColor: '#f59e0b' },
    },
  });

  const notes = [
    {
      slug: 'class-10-science-ch4-carbon-and-its-compounds',
      title: 'Carbon and its Compounds',
      classLevel: 10,
      subject: 'SCIENCE',
      chapterNo: 4,
      pricePaise: 9900,
      aliases: ['carbon', 'ch 4 science', 'carbon compounds', 'carbon notes'],
    },
    {
      slug: 'class-10-maths-ch1-real-numbers',
      title: 'Real Numbers',
      classLevel: 10,
      subject: 'MATHS',
      chapterNo: 1,
      pricePaise: 7900,
      aliases: ['real numbers', 'ch 1 maths', 'euclid division'],
    },
    {
      slug: 'class-9-sst-history-ch2-socialism-in-europe',
      title: 'Socialism in Europe and the Russian Revolution',
      classLevel: 9,
      subject: 'SST',
      chapterNo: 2,
      pricePaise: 6900,
      aliases: ['russian revolution', 'sst history ch 2', 'socialism'],
    },
    {
      slug: 'class-10-english-first-flight-ch1-a-letter-to-god',
      title: 'A Letter to God (First Flight)',
      classLevel: 10,
      subject: 'ENGLISH',
      chapterNo: 1,
      pricePaise: 4900,
      aliases: ['a letter to god', 'first flight ch 1', 'english ch 1'],
    },
  ] as const;

  const noteIds: string[] = [];
  for (const n of notes) {
    const product = await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: n.slug } },
      // Rebuild aliases on every re-run so edits to the aliases list below
      // actually apply to existing seeded rows (plain `update: {}` would
      // silently keep whatever aliases were created on the first run).
      update: {
        aliases: {
          deleteMany: {},
          create: n.aliases.map((alias) => ({ alias, tenantId: tenant.id })),
        },
      },
      create: {
        tenantId: tenant.id,
        type: 'NOTE',
        slug: n.slug,
        title: n.title,
        classLevel: n.classLevel,
        subject: n.subject,
        chapterNo: n.chapterNo,
        pricePaise: n.pricePaise,
        status: 'ACTIVE',
        description: `Handwritten Class ${n.classLevel} ${n.subject} notes: ${n.title}.`,
        aliases: {
          create: n.aliases.map((alias) => ({ alias, tenantId: tenant.id })),
        },
      },
    });
    noteIds.push(product.id);
  }

  const scienceBundle = await prisma.product.upsert({
    where: {
      tenantId_slug: {
        tenantId: tenant.id,
        slug: 'class-10-science-complete-bundle',
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      type: 'BUNDLE',
      slug: 'class-10-science-complete-bundle',
      title: 'Class 10 Science — Complete Bundle',
      classLevel: 10,
      subject: 'SCIENCE',
      pricePaise: 49900,
      status: 'ACTIVE',
      description: 'Every Class 10 Science chapter, one discounted bundle.',
    },
  });

  await prisma.bundleItem.upsert({
    where: {
      bundleId_noteId: { bundleId: scienceBundle.id, noteId: noteIds[0] },
    },
    update: {},
    create: { bundleId: scienceBundle.id, noteId: noteIds[0] },
  });

  console.log(
    `Seeded tenant "${tenant.slug}" with ${notes.length} notes + 1 bundle`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
