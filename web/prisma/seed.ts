import { PrismaClient, RegionLevel } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BPS_API_BASE = "https://sig.bps.go.id/rest-bridging/getwilayah";

interface BPSRegion {
  kode_bps: string;
  nama_bps: string;
  kode_dagri: string;
  nama_dagri: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRegions(
  level?: string,
  parent?: string
): Promise<BPSRegion[]> {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  if (parent) params.set("parent", parent);

  const url = params.toString()
    ? `${BPS_API_BASE}?${params.toString()}`
    : BPS_API_BASE;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`BPS API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data as BPSRegion[];
}

async function seedRegions(): Promise<void> {
  console.log("Fetching provinces...");
  const provinces = await fetchRegions();
  console.log(`Found ${provinces.length} provinces`);

  for (const province of provinces) {
    const provinceRecord = await prisma.region.upsert({
      where: { code: province.kode_bps },
      update: {
        name: province.nama_bps,
        level: RegionLevel.province,
      },
      create: {
        code: province.kode_bps,
        name: province.nama_bps,
        level: RegionLevel.province,
      },
    });

    console.log(`  Province: ${province.nama_bps} (${province.kode_bps})`);

    // Delay between province API calls
    await delay(500);

    // Fetch regencies for this province
    console.log(`  Fetching regencies for ${province.nama_bps}...`);
    let regencies: BPSRegion[] = [];
    try {
      regencies = await fetchRegions("kabupaten", province.kode_bps);
    } catch (error) {
      console.error(
        `  Failed to fetch regencies for ${province.nama_bps}:`,
        error
      );
      continue;
    }
    console.log(`  Found ${regencies.length} regencies`);

    for (const regency of regencies) {
      const regencyRecord = await prisma.region.upsert({
        where: { code: regency.kode_bps },
        update: {
          name: regency.nama_bps,
          level: RegionLevel.regency,
          parentId: provinceRecord.id,
        },
        create: {
          code: regency.kode_bps,
          name: regency.nama_bps,
          level: RegionLevel.regency,
          parentId: provinceRecord.id,
        },
      });

      // Delay between regency API calls
      await delay(300);

      // Fetch districts for this regency
      let districts: BPSRegion[] = [];
      try {
        districts = await fetchRegions("kecamatan", regency.kode_bps);
      } catch (error) {
        console.error(
          `    Failed to fetch districts for ${regency.nama_bps}:`,
          error
        );
        continue;
      }

      console.log(
        `    Regency: ${regency.nama_bps} - ${districts.length} districts`
      );

      // Batch upsert districts in small groups
      const BATCH_SIZE = 10;
      for (let i = 0; i < districts.length; i += BATCH_SIZE) {
        const batch = districts.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map((district) =>
            prisma.region.upsert({
              where: { code: district.kode_bps },
              update: {
                name: district.nama_bps,
                level: RegionLevel.district,
                parentId: regencyRecord.id,
              },
              create: {
                code: district.kode_bps,
                name: district.nama_bps,
                level: RegionLevel.district,
                parentId: regencyRecord.id,
              },
            })
          )
        );

        // Small delay between batches
        await delay(100);
      }

      // Delay between district API calls
      await delay(300);
    }
  }

  console.log("Region seeding completed!");
}

async function seedAdminUser(): Promise<void> {
  console.log("Seeding admin user...");

  const passwordHash = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: "admin@bps.go.id" },
    update: {
      name: "Administrator",
      passwordHash,
      role: "admin",
    },
    create: {
      name: "Administrator",
      email: "admin@bps.go.id",
      passwordHash,
      role: "admin",
    },
  });

  console.log("Admin user seeded (admin@bps.go.id)");
}

async function main(): Promise<void> {
  console.log("Starting seed...");

  await seedAdminUser();
  await seedRegions();

  console.log("Seed completed successfully!");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
