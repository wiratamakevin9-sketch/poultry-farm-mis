import { describe, expect, it } from 'vitest'
import { addDays, farmDate } from './farmDate'
import { feedPerBirdGrams, hdp } from './indicators'
import { parseDecimal, validateRecord, type RecordForm } from './validation'

const TODAY = '2026-10-26'
const FORM: RecordForm = {
  eggs_good: '4000',
  eggs_cracked: '20',
  eggs_rejected: '10',
  feed_kg: '550',
  water_liters: '',
  dead: '2',
  culled: '1',
  notes: '',
}

function check(changes: Partial<RecordForm> = {}, liveBirds = 5000, date = TODAY) {
  return validateRecord({ ...FORM, ...changes }, liveBirds, date, TODAY)
}

describe('validateRecord', () => {
  it('accepts a valid record and returns numbers', () => {
    const { errors, values } = check({ feed_kg: '550,5', water_liters: '900' })
    expect(errors).toEqual({})
    expect(values).toMatchObject({ eggs_good: 4000, feed_kg: 550.5, water_liters: 900 })
  })

  it('requires every count, and allows 0', () => {
    expect(check({ dead: '' }).errors.dead).toBe('Ayam mati wajib diisi (isi 0 jika tidak ada).')
    expect(check({ dead: '0', culled: '0' }).errors).toEqual({})
  })

  it('rejects negative and decimal counts', () => {
    expect(check({ eggs_cracked: '-1' }).errors.eggs_cracked).toBe(
      'Telur retak harus bilangan bulat 0 atau lebih.',
    )
    expect(check({ culled: '1.5' }).errors.culled).toBeDefined()
  })

  it('total eggs cannot exceed live birds (same message as the server)', () => {
    expect(check({ eggs_good: '4971' }).errors.eggs_good).toBe(
      'Total telur (5.001) tidak boleh lebih dari jumlah ayam hidup (5.000).',
    )
    expect(check({ eggs_good: '4970' }).errors).toEqual({})
  })

  it('dead + culled cannot exceed live birds', () => {
    const result = check(
      { eggs_good: '0', eggs_cracked: '0', eggs_rejected: '0', dead: '60', culled: '41', feed_kg: '10' },
      100,
    )
    expect(result.errors.dead).toContain('tidak boleh lebih dari jumlah ayam hidup (100)')
  })

  it('feed must be above 0 and at most 0.2 kg per bird', () => {
    expect(check({ feed_kg: '0' }).errors.feed_kg).toBe('Pakan harus lebih dari 0 kg.')
    expect(check({ feed_kg: '1000' }).errors).toEqual({})
    expect(check({ feed_kg: '1000,01' }).errors.feed_kg).toBe(
      'Pakan maksimal 1.000 kg (0,2 kg × 5.000 ekor).',
    )
  })

  it('only today or yesterday', () => {
    expect(check({}, 5000, '2026-10-27').errors.record_date).toBe('Tanggal tidak boleh di masa depan.')
    expect(check({}, 5000, '2026-10-25').errors).toEqual({})
    expect(check({}, 5000, '2026-10-24').errors.record_date).toBeDefined()
  })
})

describe('parseDecimal', () => {
  it('reads comma and dot decimals', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal('12.5')).toBe(12.5)
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('')).toBeNull()
  })
})

describe('indicators', () => {
  it('HDP is eggs / live birds x 100', () => {
    expect(hdp(4000, 5000)).toBe(80)
    expect(hdp(10, 0)).toBe(0)
  })

  it('feed per bird in grams', () => {
    expect(feedPerBirdGrams(550, 5000)).toBe(110)
  })
})

describe('farm date', () => {
  it('uses WITA (UTC+8)', () => {
    expect(farmDate(new Date('2026-10-25T16:30:00Z'))).toBe('2026-10-26')
    expect(farmDate(new Date('2026-10-25T15:59:00Z'))).toBe('2026-10-25')
  })

  it('adds days across months', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
  })
})
