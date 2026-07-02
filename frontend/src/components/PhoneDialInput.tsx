import {
  DIAL_CODE_OPTIONS,
  DEFAULT_DIAL_CODE,
  dialOptionLabel,
  normalizeLocalNumber,
} from '../utils/phoneDial'
import './PhoneDialInput.css'

interface PhoneDialInputProps {
  dialCode: string
  localNumber: string
  onDialCodeChange: (value: string) => void
  onLocalNumberChange: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
  id?: string
}

export function PhoneDialInput({
  dialCode,
  localNumber,
  onDialCodeChange,
  onLocalNumberChange,
  disabled = false,
  autoFocus = false,
  id = 'auth-phone-local',
}: PhoneDialInputProps) {
  const selectedDial = DIAL_CODE_OPTIONS.some((item) => item.dial === dialCode)
    ? dialCode
    : DEFAULT_DIAL_CODE

  return (
    <div className="phone-dial-input">
      <label className="phone-dial-prefix" htmlFor="auth-phone-dial">
        <span className="phone-dial-prefix-label">Đầu số</span>
        <select
          id="auth-phone-dial"
          className="phone-dial-select"
          value={selectedDial}
          onChange={(e) => onDialCodeChange(e.target.value)}
          disabled={disabled}
          aria-label="Chọn đầu số quốc gia"
        >
          {DIAL_CODE_OPTIONS.map((option) => (
            <option key={option.iso} value={option.dial}>
              {dialOptionLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <label className="phone-dial-number" htmlFor={id}>
        <span className="phone-dial-number-label">Số điện thoại</span>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          className="phone-dial-local"
          placeholder="901234567"
          value={localNumber}
          onChange={(e) => onLocalNumberChange(normalizeLocalNumber(e.target.value))}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="tel-national"
          required
        />
      </label>
    </div>
  )
}