import type { ReactNode } from "react";
import type {
  ArrayNode,
  PrimitiveSpec,
  SchemaNode,
  StringNode,
} from "../../types";

interface NodeFieldsProps {
  node: SchemaNode;
  onUpdate: (id: string, updated: Partial<SchemaNode>) => void;
}

const INPUT_CLASS =
  "w-full bg-(--bg-input) border border-(--border) text-(--text-primary) px-2 py-1 rounded outline-none focus:border-(--accent)";
const SELECT_CLASS =
  "w-full bg-(--bg-input) border border-(--border) text-(--text-primary) px-1.5 py-1 rounded outline-none focus:border-(--accent)";
const LABEL_CLASS = "block text-[10px] text-[var(--text-muted)] mb-1";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      />
    </Field>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={SELECT_CLASS}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function BooleanField({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-(--text-secondary) mb-1">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onToggle(e.target.checked)}
      />
      {label}
    </label>
  );
}

function OptionalTextField<T>({
  label,
  value,
  onToggle,
  disabledReason,
  children,
}: {
  label: string;
  value: T | undefined;
  onToggle: (enabled: boolean) => void;
  disabledReason?: string;
  children: ReactNode;
}) {
  const enabled = value !== undefined;

  return (
    <div className="border-t border-(--border) pt-2 mt-2">
      <label className="flex items-center gap-2 text-[10px] text-(--text-muted) mb-1">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!!disabledReason}
          onChange={(e) => onToggle(e.target.checked)}
        />
        {label}
        {disabledReason && <span className="italic">({disabledReason})</span>}
      </label>
      {enabled && children}
    </div>
  );
}

function PrimitiveFields({
  spec,
  onChange,
}: {
  spec: PrimitiveSpec;
  onChange: (updated: PrimitiveSpec) => void;
}) {
  if (spec.kind === "int") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Min"
          value={spec.min}
          onChange={(v) => onChange({ ...spec, min: v })}
        />
        <TextField
          label="Max"
          value={spec.max}
          onChange={(v) => onChange({ ...spec, max: v })}
        />
      </div>
    );
  }
  if (spec.kind === "float") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Min"
          value={spec.min}
          onChange={(v) => onChange({ ...spec, min: v })}
        />
        <TextField
          label="Max"
          value={spec.max}
          onChange={(v) => onChange({ ...spec, max: v })}
        />
      </div>
    );
  }
  if (spec.kind === "string") {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Length"
            value={spec.length}
            onChange={(v) => onChange({ ...spec, length: v })}
          />
          <SelectField<StringNode["charset"]>
            label="Charset"
            value={spec.charset}
            onChange={(v) => onChange({ ...spec, charset: v })}
            options={[
              { value: "lowercase", label: "a-z (Lowercase)" },
              { value: "uppercase", label: "A-Z (Uppercase)" },
              { value: "alphanumeric", label: "a-Z, 0-9" },
              { value: "digits", label: "0-9 (Digits)" },
              { value: "custom", label: "Custom..." },
            ]}
          />
        </div>

        {spec.charset === "custom" && (
          <TextField
            label="Custom Characters"
            value={spec.customCharset || ""}
            placeholder="e.g. ATGC"
            onChange={(v) => onChange({ ...spec, customCharset: v })}
          />
        )}
      </div>
    );
  }
}

export default function NodeFields({ node, onUpdate }: NodeFieldsProps) {
  const update = (patch: Partial<SchemaNode>) => onUpdate(node.id, patch);

  if (node.kind === "loop") {
    return (
      <TextField
        label="Count / Repeat Var (e.g. T or 10)"
        value={node.count || ""}
        placeholder="e.g. T or 10"
        onChange={(v) => update({ count: v })}
      />
    );
  }

  if (node.kind === "int" || node.kind === "float" || node.kind === "string") {
    const isNumeric = node.kind === "int" || node.kind === "float";

    return (
      <div className="space-y-2">
        <PrimitiveFields spec={node} onChange={(spec) => update(spec)} />

        {isNumeric && (
          <OptionalTextField
            label="Output Format"
            value={node.outputFormat}
            disabledReason={
              !node.varName ? "needs a var name first" : undefined
            }
            onToggle={(checked) =>
              update({
                outputFormat: checked
                  ? node.kind === "float"
                    ? `{${node.varName}:.2}\\n`
                    : `{${node.varName}}\\n`
                  : undefined,
              })
            }
          >
            <input
              type="text"
              value={node.outputFormat ?? ""}
              placeholder={`e.g. {${node.varName || "var"}}: {other_var}`}
              onChange={(e) => update({ outputFormat: e.target.value })}
              className={INPUT_CLASS}
            />
          </OptionalTextField>
        )}
      </div>
    );
  }

  if (node.kind === "array") {
    const defaultElements: Record<PrimitiveSpec["kind"], PrimitiveSpec> = {
      int: { kind: "int", min: "1", max: "100" },
      float: { kind: "float", min: "0.0", max: "1.0" },
      string: { kind: "string", length: "10", charset: "lowercase" },
    };

    return (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <TextField
            label="Length / Var"
            value={node.length}
            onChange={(v) => update({ length: v })}
          />
          <SelectField<PrimitiveSpec["kind"]>
            label="Element Type"
            value={node.element.kind}
            onChange={(kind) => update({ element: defaultElements[kind] })}
            options={[
              { value: "int", label: "Integer" },
              { value: "float", label: "Float" },
              { value: "string", label: "String" },
            ]}
          />
          <SelectField<ArrayNode["separator"]>
            label="Separator"
            value={node.separator}
            onChange={(v) => update({ separator: v })}
            options={[
              { value: "space", label: 'Space (" ")' },
              { value: "newline", label: "Newline (\\n)" },
              { value: "comma", label: 'Comma (",")' },
            ]}
          />
        </div>

        <PrimitiveFields
          spec={node.element}
          onChange={(element) => update({ element })}
        />
        <BooleanField
          label="Unique"
          value={node.unique}
          onToggle={(enabled) => update({ unique: enabled })}
        />
      </div>
    );
  }

  return null;
}
