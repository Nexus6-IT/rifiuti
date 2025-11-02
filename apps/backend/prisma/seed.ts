/**
 * Prisma Seed Script
 * Popola database con dati iniziali (CER codes ISPRA completo)
 */

import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

interface CERRecord {
  code: string
  description: string
  isPericoloso: boolean
  category: string
  subcategory: string
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}

async function readCERCodesFromCSV(): Promise<CERRecord[]> {
  const csvPath = path.join(__dirname, 'cer-codes-ispra.csv')
  const fileContent = fs.readFileSync(csvPath, 'utf-8')
  const lines = fileContent.split('\n').filter(line => line.trim().length > 0)

  // Skip header
  const dataLines = lines.slice(1)

  const records: CERRecord[] = []

  for (const line of dataLines) {
    const fields = parseCsvLine(line)
    if (fields.length < 5) continue

    const [code, description, isPericolosoStr, category, subcategory] = fields

    records.push({
      code: code.trim(),
      description: description.trim(),
      isPericoloso: isPericolosoStr.trim().toLowerCase() === 'true',
      category: category.trim(),
      subcategory: subcategory.trim(),
    })
  }

  return records
}

async function main() {
  console.log('🌱 Seeding database with full ISPRA CER catalog...')

  // Read CER codes from CSV
  const cerCodes = await readCERCodesFromCSV()
  console.log(`📦 Found ${cerCodes.length} CER codes in CSV file`)

  // Import in batches to avoid memory issues
  const BATCH_SIZE = 100
  let imported = 0

  for (let i = 0; i < cerCodes.length; i += BATCH_SIZE) {
    const batch = cerCodes.slice(i, i + BATCH_SIZE)

    await prisma.$transaction(
      batch.map(cer =>
        prisma.cERCode.upsert({
          where: { code: cer.code },
          update: cer,
          create: cer,
        })
      )
    )

    imported += batch.length
    console.log(`   ⏳ Imported ${imported}/${cerCodes.length} CER codes...`)
  }

  console.log(`✅ Successfully seeded ${imported} CER codes from ISPRA catalog`)

  // Get statistics
  const stats = await prisma.cERCode.groupBy({
    by: ['isPericoloso'],
    _count: true,
  })

  const pericolosi = stats.find(s => s.isPericoloso)?._count || 0
  const nonPericolosi = stats.find(s => !s.isPericoloso)?._count || 0

  console.log(`📊 Statistics:`)
  console.log(`   - Pericolosi: ${pericolosi}`)
  console.log(`   - Non pericolosi: ${nonPericolosi}`)
  console.log(`   - Total: ${pericolosi + nonPericolosi}`)

  console.log('🎉 Seeding completed!')
}

// Import permission and role seeds
import { seedPermissions } from './seeds/permissions.seed'
import { seedRoles } from './seeds/roles.seed'

async function seedAll() {
  await main() // Seed CER codes
  await seedPermissions() // Seed permissions
  await seedRoles() // Seed roles
}

seedAll()
  .catch(e => {
    console.error('❌ Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
