import { parseGEDCOM } from '../../src/store/ged-parser'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('GEDCOM Parser', () => {
  let gedcomContent: string

  before(() => {
    const gedcomPath = resolve(__dirname, '../../tmp/myheritage_api_2026-01-27_203619.ged')
    gedcomContent = readFileSync(gedcomPath, 'utf-8')
  })

  it('should parse GEDCOM file and return valid data structure', () => {
    const result = parseGEDCOM(gedcomContent, { anonymizeLiving: true })

    expect(result).to.have.property('data')
    expect(result).to.have.property('stats')
    expect(Array.isArray(result.data)).to.be.true
    expect(result.data.length).to.be.greaterThan(0)
  })

  it('should extract basic person information', () => {
    const result = parseGEDCOM(gedcomContent, { anonymizeLiving: true })
    const person = result.data[0]

    expect(person).to.have.property('id')
    expect(person).to.have.property('data')
    expect(person).to.have.property('rels')
    expect(person.data).to.have.property('gender')
    expect(['M', 'F']).to.include(person.data.gender)
  })

  it('should anonymize living persons when option enabled', () => {
    const result = parseGEDCOM(gedcomContent, { anonymizeLiving: true, maxAge: 110 })

    expect(result.stats.anonymized).to.be.greaterThan(0)
    expect(result.stats.totalPersons).to.equal(
      result.stats.anonymized + result.stats.kept
    )

    // Check that some persons were anonymized
    const anonymizedPersons = result.data.filter(p => p.data.name === 'Living /Person/')
    expect(anonymizedPersons.length).to.equal(result.stats.anonymized)
  })

  it('should not remove living persons when anonymizeLiving is true', () => {
    const result = parseGEDCOM(gedcomContent, { anonymizeLiving: true })

    expect(result.stats.removed).to.equal(0)
    expect(result.data.length).to.equal(result.stats.totalPersons)
  })

  it('should respect maxAge option for determining living persons', () => {
    const resultWith110Years = parseGEDCOM(gedcomContent, { anonymizeLiving: true, maxAge: 110 })
    const resultWith50Years = parseGEDCOM(gedcomContent, { anonymizeLiving: true, maxAge: 50 })

    // With a smaller maxAge, more people should be considered living
    expect(resultWith50Years.stats.anonymized).to.be.greaterThanOrEqual(
      resultWith110Years.stats.anonymized
    )
  })

  it('should establish family relationships', () => {
    const result = parseGEDCOM(gedcomContent, { anonymizeLiving: true })

    // Find someone with relationships
    const personWithRelationships = result.data.find(
      p => p.rels.parents.length > 0 || p.rels.spouses.length > 0 || p.rels.children.length > 0
    )

    if (personWithRelationships) {
      expect(personWithRelationships.rels.parents).to.be.an('array')
      expect(personWithRelationships.rels.spouses).to.be.an('array')
      expect(personWithRelationships.rels.children).to.be.an('array')
    }
  })

  it('should provide accurate statistics', () => {
    const result = parseGEDCOM(gedcomContent, { anonymizeLiving: true })
    const { stats } = result

    expect(stats.totalPersons).to.be.greaterThan(0)
    expect(stats.livingPersons).to.be.greaterThanOrEqual(0)
    expect(stats.anonymized + stats.kept).to.equal(stats.totalPersons)
  })
})
