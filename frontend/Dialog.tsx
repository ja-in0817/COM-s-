"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, LoaderCircle } from "lucide-react";
export type Values = Record<string, string | boolean>;
export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "select"
    | "checkbox"
    | "number"
    | "datetime-local"
    | "email";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  maxLength?: number;
  min?: number;
  max?: number;
};
export type DialogSpec = {
  title: string;
  description?: string;
  fields?: Field[];
  initial?: Values;
  submitLabel?: string;
  danger?: boolean;
  content?: ReactNode;
  submit?: (values: Values) => Promise<void>;
};
export function Dialog({
  spec,
  close,
}: {
  spec: DialogSpec;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [values, setValues] = useState<Values>(spec.initial || {}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const d = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    d?.showModal();
    return () => {
      d?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!spec.submit) return;
          setBusy(true);
          setError("");
          try {
            await spec.submit(values);
            close();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">WARGETHER</span>
            <h2>{spec.title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            disabled={busy}
            aria-label="닫기"
          >
            <X size={20} />
          </button>
        </div>
        {spec.description && (
          <p className="muted dialog-description">{spec.description}</p>
        )}
        {spec.content}
        <div className="form-fields">
          {spec.fields?.map((f) => (
            <label
              key={f.key}
              className={f.type === "checkbox" ? "check-field" : "field"}
            >
              {f.type === "checkbox" ? (
                <>
                  <input
                    type="checkbox"
                    checked={!!values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.checked })
                    }
                  />
                  <span>{f.label}</span>
                </>
              ) : (
                <>
                  <span>
                    {f.label}
                    {f.required !== false && <small> *</small>}
                  </span>
                  {f.type === "textarea" ? (
                    <textarea
                      value={String(values[f.key] ?? "")}
                      required={f.required !== false}
                      maxLength={f.maxLength || 2000}
                      placeholder={f.placeholder}
                      onChange={(e) =>
                        setValues({ ...values, [f.key]: e.target.value })
                      }
                    />
                  ) : f.type === "select" ? (
                    <select
                      value={String(values[f.key] ?? "")}
                      required={f.required !== false}
                      onChange={(e) =>
                        setValues({ ...values, [f.key]: e.target.value })
                      }
                    >
                      <option value="" disabled>
                        선택해 주세요
                      </option>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type || "text"}
                      value={String(values[f.key] ?? "")}
                      required={f.required !== false}
                      min={f.min}
                      max={f.max}
                      maxLength={f.maxLength || 200}
                      placeholder={f.placeholder}
                      onChange={(e) =>
                        setValues({ ...values, [f.key]: e.target.value })
                      }
                    />
                  )}
                </>
              )}
              {f.help && <small className="field-help">{f.help}</small>}
            </label>
          ))}
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {spec.submit && (
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={close}
            >
              취소
            </button>
            <button
              className={`button ${spec.danger ? "danger" : ""}`}
              disabled={busy}
            >
              {busy ? (
                <>
                  <LoaderCircle size={17} className="spin" /> 처리 중
                </>
              ) : (
                spec.submitLabel || "저장하기"
              )}
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
