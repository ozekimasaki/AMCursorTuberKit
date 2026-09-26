import { useState } from 'react'
import { CheckIcon, KeyRoundIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { SECRET_LABELS, type SecretKey } from '@amctk/shared'
import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { api } from '@/lib/api'
import { setSecrets, useStore } from '@/lib/store'

/**
 * Token入力欄。値はMain ProcessのSecretServiceへ送るだけで、画面側には保持も表示もしない。
 */
export function SecretField({
  secret,
  label,
  description,
  placeholder,
}: {
  secret: SecretKey
  label?: string
  description?: React.ReactNode
  placeholder?: string
}) {
  const saved = useStore((s) => s.secrets?.[secret] ?? false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const id = `secret-${secret}`

  const save = async () => {
    if (!value.trim()) return
    setBusy(true)
    try {
      setSecrets(await api.secrets.set(secret, value))
      setValue('')
      toast.success(`${label ?? SECRET_LABELS[secret]} を保存しました`)
    } catch (err) {
      toast.error(`保存できませんでした: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setSecrets(await api.secrets.clear(secret))
    toast(`${label ?? SECRET_LABELS[secret]} を削除しました`)
  }

  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label ?? SECRET_LABELS[secret]}</FieldLabel>
        {saved ? (
          <Badge variant="secondary" className="border-transparent bg-candy-mint-soft font-bold text-ok">
            <CheckIcon data-icon="inline-start" />
            設定済み
          </Badge>
        ) : (
          <Badge variant="outline" className="font-bold text-muted-foreground">
            未設定
          </Badge>
        )}
      </div>
      <InputGroup>
        <InputGroupAddon>
          <KeyRoundIcon />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={saved ? '新しい値で上書きする場合のみ入力' : (placeholder ?? '貼り付けてください')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <InputGroupAddon align="inline-end">
          {saved && (
            <InputGroupButton size="icon-xs" aria-label="削除" onClick={() => void clear()}>
              <Trash2Icon />
            </InputGroupButton>
          )}
          <InputGroupButton variant="default" disabled={!value.trim() || busy} onClick={() => void save()}>
            保存
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FieldDescription>
        {description}
        {description ? ' ' : ''}OSの暗号化ストレージに保存され、画面やログには表示されません。
      </FieldDescription>
    </Field>
  )
}
