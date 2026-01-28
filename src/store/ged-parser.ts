import { GedcomParser } from 'gedcom-parser'
import { Data, Datum } from '../types/data'

/**
 * Options for parsing GEDCOM files
 */
export interface ParseGedcomOptions {
  /**
   * Maximum age in years to consider a person as living
   * Default: 110
   */
  maxAge?: number
  /**
   * If true, living persons will be anonymized instead of removed
   * Default: true (anonymize)
   */
  anonymizeLiving?: boolean
}

/**
 * Metadata about the parsing result
 */
export interface ParseGedcomResult {
  data: Data
  stats: {
    totalPersons: number
    livingPersons: number
    anonymized: number
    removed: number
    kept: number
  }
}

/**
 * Extract year from GEDCOM date string
 */
function extractYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null

  // Match 4-digit year pattern
  const match = String(dateStr).match(/\b(1\d{3}|20\d{2})\b/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Check if a person is likely living based on death records and birth year
 */
function isLiving(person: any, maxAge: number = 110): boolean {
  // If person has a death event, they're not living
  if (person.DEAT) {
    return false
  }

  // Check birth year
  const birthObj = person.BIRT
  let birthYear: number | null = null

  if (birthObj && birthObj.DATE) {
    birthYear = extractYear(birthObj.DATE)
  }

  // If no birth year found, conservatively assume living
  if (birthYear === null) {
    return true
  }

  // Check if person is within maxAge threshold
  const currentYear = new Date().getFullYear()
  const age = currentYear - birthYear

  return age <= maxAge
}

/**
 * Anonymize a person's data by removing sensitive information
 */
function anonymizePerson(person: any): void {
  // Replace name with generic "Living Person"
  if (person.NAME) {
    person.NAME = 'Living /Person/'
  }

  // Remove sensitive personal information
  delete person.BIRT
  delete person.DEAT
  delete person.OCCU
  delete person.RESI
  delete person.EDUC
  delete person.NOTE
  delete person.OBJE
  delete person.SOUR
  delete person.GIVN
  delete person.SURN
}

/**
 * Convert GEDCOM data to internal Data format
 */
function convertGedcomToData(gedcomData: any, options: ParseGedcomOptions = {}): ParseGedcomResult {
  const { maxAge = 110, anonymizeLiving = true } = options

  const dataMap = new Map<string, Datum>()
  const livingIds = new Set<string>()

  const stats = {
    totalPersons: 0,
    livingPersons: 0,
    anonymized: 0,
    removed: 0,
    kept: 0,
  }

  // First pass: extract all individuals (records with @I prefix)
  Object.entries(gedcomData).forEach(([id, person]: [string, any]) => {
    // Only process individuals
    if (!id.startsWith('@I')) return

    stats.totalPersons++

    const isPersonLiving = isLiving(person, maxAge)

    if (isPersonLiving) {
      stats.livingPersons++
      livingIds.add(id)

      if (anonymizeLiving) {
        stats.anonymized++
        anonymizePerson(person)
      } else {
        stats.removed++
        return // Skip this person entirely
      }
    } else {
      stats.kept++
    }

    // Extract name
    const nameStr = typeof person.NAME === 'string' ? person.NAME : person.NAME || 'Unknown'

    // Extract gender
    const gender = String(person.SEX).toUpperCase() === 'M' ? 'M' : 'F'

    // Create datum
    const datum: Datum = {
      id,
      data: {
        gender,
        name: nameStr,
      },
      rels: {
        parents: [],
        spouses: [],
        children: [],
      },
    }

    dataMap.set(id, datum)
  })

  // Second pass: build relationships using FAM records
  Object.entries(gedcomData).forEach(([id, family]: [string, any]) => {
    // Only process families
    if (!id.startsWith('@F')) return

    // Get spouse IDs
    const husbId = family.HUSB
    const wifId = family.WIFE

    // Link spouses
    if (husbId && wifId && dataMap.has(husbId) && dataMap.has(wifId)) {
      const husb = dataMap.get(husbId)!
      const wife = dataMap.get(wifId)!

      if (!husb.rels.spouses.includes(wifId)) {
        husb.rels.spouses.push(wifId)
      }
      if (!wife.rels.spouses.includes(husbId)) {
        wife.rels.spouses.push(husbId)
      }
    }

    // Get children (can be array or single value)
    const children = Array.isArray(family.CHIL) ? family.CHIL : family.CHIL ? [family.CHIL] : []

    children.forEach((childId: string) => {
      if (!dataMap.has(childId)) return

      const childDatum = dataMap.get(childId)!

      // Add parents to child
      if (husbId && dataMap.has(husbId) && !childDatum.rels.parents.includes(husbId)) {
        childDatum.rels.parents.push(husbId)
      }
      if (wifId && dataMap.has(wifId) && !childDatum.rels.parents.includes(wifId)) {
        childDatum.rels.parents.push(wifId)
      }

      // Add child to parents
      if (husbId && dataMap.has(husbId)) {
        const parent = dataMap.get(husbId)!
        if (!parent.rels.children.includes(childId)) {
          parent.rels.children.push(childId)
        }
      }
      if (wifId && dataMap.has(wifId)) {
        const parent = dataMap.get(wifId)!
        if (!parent.rels.children.includes(childId)) {
          parent.rels.children.push(childId)
        }
      }
    })
  })

  const data = Array.from(dataMap.values())

  return {
    data,
    stats,
  }
}

/**
 * Parse a GEDCOM file and convert it to the internal Data format
 *
 * @param gedcomContent - The GEDCOM file content as string
 * @param options - Parsing options
 * @returns ParseGedcomResult with data and statistics
 *
 * @example
 * const result = parseGEDCOM(gedcomFileContent, { maxAge: 110, anonymizeLiving: true })
 * console.log(result.data) // Array of Datum objects
 * console.log(result.stats) // Parsing statistics
 */
export function parseGEDCOM(gedcomContent: string, options: ParseGedcomOptions = {}): ParseGedcomResult {
  const parser = new GedcomParser(gedcomContent)
  const gedcom = parser.data

  return convertGedcomToData(gedcom, options)
}
