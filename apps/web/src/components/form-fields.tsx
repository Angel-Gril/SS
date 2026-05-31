'use client';

import { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export interface FormFieldProps {
  label: string;
  required?: boolean;
  children?: ReactNode;
  description?: string;
}

/**
 * 通用表单字段容器
 * 封装 Label + 字段 + 描述的布局
 */
export function FormField({ label, required, children, description }: FormFieldProps) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'number' | 'email' | 'password';
  description?: string;
}

/**
 * 通用文本输入字段
 */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = 'text',
  description,
}: TextFieldProps) {
  return (
    <FormField label={label} required={required} description={description}>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </FormField>
  );
}

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  description?: string;
}

/**
 * 通用下拉选择字段
 */
export function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  description,
}: SelectFieldProps) {
  return (
    <FormField label={label} required={required} description={description}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

export interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

/**
 * 通用复选框字段
 */
export function CheckboxField({ label, checked, onChange, description }: CheckboxFieldProps) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded mt-0.5"
      />
      <div className="flex-1">
        <span className="text-sm">{label}</span>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </div>
    </label>
  );
}
