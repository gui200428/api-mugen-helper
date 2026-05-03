import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function validatePasswordStrength(password: string): void {
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error('ADMIN_PASSWORD must contain at least one uppercase letter');
  }
  if (!/[0-9]/.test(password)) {
    throw new Error('ADMIN_PASSWORD must contain at least one digit');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    throw new Error('ADMIN_PASSWORD must contain at least one special character');
  }
}

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
  }

  // H3/C2: Validate password strength before seeding
  validatePasswordStrength(password);

  // I1: Increased salt rounds to 12 for admin accounts
  const hashedPassword = await bcrypt.hash(password, 12);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: {
      password: hashedPassword,
    },
    create: {
      email,
      password: hashedPassword,
      name: 'Admin',
    },
  });

  console.log(`✅ Admin seed complete: ${admin.email} (id: ${admin.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
