import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { invoices, customers, revenue, users } from '../lib/placeholder-data';

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require' });

async function seedUsers() {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    );
  `;

  const insertedUsers = await Promise.all(
    users.map(async (user) => {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      return sql`
        INSERT INTO users (name, email, password)
        VALUES (${user.name}, ${user.email}, ${hashedPassword})
        ON CONFLICT (email) DO NOTHING
        RETURNING id;
      `;
    }),
  );

  return insertedUsers;
}

async function seedCustomers() {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  await sql`
    CREATE TABLE IF NOT EXISTS customers (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      image_url VARCHAR(255) NOT NULL
    );
  `;

  // Map the placeholder customers to their new IDs
  const insertedCustomers = await Promise.all(
    customers.map(async (customer) => {
      const result = await sql`
        INSERT INTO customers (name, email, image_url)
        VALUES (${customer.name}, ${customer.email}, ${customer.image_url})
        ON CONFLICT (email) DO NOTHING
        RETURNING id;
      `;
      return { oldId: customer.id, newId: result[0]?.id };
    }),
  );

  return insertedCustomers;
}

async function seedInvoices(customerIdMap: { oldId: string; newId: string }[]) {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  await sql`
    CREATE TABLE IF NOT EXISTS invoices (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      customer_id UUID NOT NULL,
      amount INT NOT NULL,
      status VARCHAR(255) NOT NULL,
      date DATE NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
  `;

  const insertedInvoices = await Promise.all(
    invoices.map(async (invoice) => {
      // Find the new customer ID based on the old ID
      const newCustomerId = customerIdMap.find(map => map.oldId === invoice.customer_id)?.newId;
      if (!newCustomerId) {
        console.warn(`No matching customer found for invoice with customer_id: ${invoice.customer_id}`);
        return null;
      }

      return sql`
        INSERT INTO invoices (customer_id, amount, status, date)
        VALUES (${newCustomerId}, ${invoice.amount}, ${invoice.status}, ${invoice.date})
        ON CONFLICT DO NOTHING
        RETURNING id;
      `;
    }),
  );

  return insertedInvoices.filter(result => result !== null);
}

async function seedRevenue() {
  await sql`
    CREATE TABLE IF NOT EXISTS revenue (
      month VARCHAR(4) NOT NULL UNIQUE,
      revenue INT NOT NULL
    );
  `;

  const insertedRevenue = await Promise.all(
    revenue.map(
      (rev) => sql`
        INSERT INTO revenue (month, revenue)
        VALUES (${rev.month}, ${rev.revenue})
        ON CONFLICT (month) DO NOTHING
        RETURNING month;
      `,
    ),
  );

  return insertedRevenue;
}

export async function GET() {
  try {
    await sql.begin(async (sql) => {
      await seedUsers();
      const customerIdMap = await seedCustomers();
      await seedInvoices(customerIdMap);
      await seedRevenue();
    });

    return Response.json({ message: 'Database seeded successfully' });
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}