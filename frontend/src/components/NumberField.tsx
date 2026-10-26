interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  decimal?: boolean
  unit?: string
  optional?: boolean
}

/** Text input with the phone's number keyboard (works with comma decimals too). */
export default function NumberField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  decimal = false,
  unit,
  optional = false,
}: Props) {
  const errorId = `${id}-error`
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {unit && <span className="muted"> ({unit})</span>}
        {optional && <span className="muted"> – opsional</span>}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        pattern={decimal ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
        autoComplete="off"
        enterKeyHint="next"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
    </div>
  )
}
