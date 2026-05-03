import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

async function test() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const admin = await prisma.admin.findUnique({ where: { email: 'admin@mugen.com' } });
  console.log('Admin found:', admin ? 'Yes' : 'No');
  
  if (admin) {
    console.log('ENV Password read as:', JSON.stringify(process.env.ADMIN_PASSWORD));
    const pwdToTest = 'Mugen@Admin#2026!';
    const isValid = await bcrypt.compare(pwdToTest, admin.password);
    console.log('Password valid for Mugen@Admin#2026! :', isValid);
    
    const pwdWithQuotes = '"Mugen@Admin#2026!"';
    const isValidQuotes = await bcrypt.compare(pwdWithQuotes, admin.password);
    console.log('Password valid for "Mugen@Admin#2026!" :', isValidQuotes);
  }

  await prisma.$disconnect();
  await pool.end();
}
test().catch(console.error);
