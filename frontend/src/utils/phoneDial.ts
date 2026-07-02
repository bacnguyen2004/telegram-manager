export interface DialCodeOption {
  iso: string
  dial: string
  label: string
  flag: string
}

export const DEFAULT_DIAL_CODE = '+84'

export const DIAL_CODE_OPTIONS: DialCodeOption[] = [
  { iso: 'VN', dial: '+84', label: 'Việt Nam', flag: '🇻🇳' },
  { iso: 'US', dial: '+1', label: 'Mỹ / Canada', flag: '🇺🇸' },
  { iso: 'CN', dial: '+86', label: 'Trung Quốc', flag: '🇨🇳' },
  { iso: 'JP', dial: '+81', label: 'Nhật Bản', flag: '🇯🇵' },
  { iso: 'KR', dial: '+82', label: 'Hàn Quốc', flag: '🇰🇷' },
  { iso: 'TH', dial: '+66', label: 'Thái Lan', flag: '🇹🇭' },
  { iso: 'SG', dial: '+65', label: 'Singapore', flag: '🇸🇬' },
  { iso: 'MY', dial: '+60', label: 'Malaysia', flag: '🇲🇾' },
  { iso: 'ID', dial: '+62', label: 'Indonesia', flag: '🇮🇩' },
  { iso: 'PH', dial: '+63', label: 'Philippines', flag: '🇵🇭' },
  { iso: 'KH', dial: '+855', label: 'Campuchia', flag: '🇰🇭' },
  { iso: 'LA', dial: '+856', label: 'Lào', flag: '🇱🇦' },
  { iso: 'TW', dial: '+886', label: 'Đài Loan', flag: '🇹🇼' },
  { iso: 'HK', dial: '+852', label: 'Hồng Kông', flag: '🇭🇰' },
  { iso: 'GB', dial: '+44', label: 'Anh', flag: '🇬🇧' },
  { iso: 'DE', dial: '+49', label: 'Đức', flag: '🇩🇪' },
  { iso: 'FR', dial: '+33', label: 'Pháp', flag: '🇫🇷' },
  { iso: 'AU', dial: '+61', label: 'Úc', flag: '🇦🇺' },
  { iso: 'RU', dial: '+7', label: 'Nga', flag: '🇷🇺' },
  { iso: 'IN', dial: '+91', label: 'Ấn Độ', flag: '🇮🇳' },
]

export function normalizeLocalNumber(value: string): string {
  return value.replace(/\D/g, '').replace(/^0+/, '')
}

export function buildE164(dial: string, local: string): string {
  const localDigits = normalizeLocalNumber(local)
  if (!localDigits) return ''
  const dialDigits = dial.replace(/\D/g, '')
  if (!dialDigits) return ''
  return `+${dialDigits}${localDigits}`
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

export function dialOptionLabel(option: DialCodeOption): string {
  return `${option.flag} ${option.dial} ${option.label}`
}