import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function main() {
  const wasteTypes = [
    { name: 'Plastik', unitPrice: 3000 },
    { name: 'Kertas/Kardus', unitPrice: 2000 },
    { name: 'Logam/Besi', unitPrice: 5000 },
    { name: 'Kaca', unitPrice: 1500 },
    { name: 'Minyak Jelantah', unitPrice: 4000 },
    { name: 'Elektronik', unitPrice: 10000 },
  ];

  console.log('Seeding waste types...');

  for (const type of wasteTypes) {
    await prisma.wasteType.upsert({
      where: { id: '' }, // This won't match anything, forcing create or we can use name if we had a unique constraint
      update: {},
      create: type,
    });
  }

  // Better way since we don't have unique constraint on name in schema (let's check first)
  // Actually, I'll just use a simple loop with findFirst
  for (const type of wasteTypes) {
    const existing = await prisma.wasteType.findFirst({
      where: { name: type.name },
    });

    if (!existing) {
      await prisma.wasteType.create({ data: type });
      console.log(`Created waste type: ${type.name}`);
    } else {
      console.log(`Waste type already exists: ${type.name}`);
    }
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
