"use client";

import type { ChangeEvent } from "react";
import type { RobinhoodLaunchFormData } from "./launchTypes";

interface Props {
  value: RobinhoodLaunchFormData;
  errors: Partial<Record<keyof RobinhoodLaunchFormData, string>>;
  isDisabled: boolean;
  onChange: (next: RobinhoodLaunchFormData) => void;
}

const SOCIAL_FIELDS = [
  { key: "twitter", label: "X / Twitter", placeholder: "https://x.com/project" },
  { key: "telegram", label: "Telegram", placeholder: "https://t.me/project" },
  { key: "website", label: "Website", placeholder: "https://project.xyz" },
] as const;

export default function RobinhoodLaunchForm({ value, errors, isDisabled, onChange }: Props) {
  const update = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => onChange({ ...value, [event.target.name]: event.target.value });

  return (
    <section aria-labelledby="asset-heading" className="card overflow-hidden">
      <div className="border-b border-line-default px-5 py-4 sm:px-6">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
          01 / Asset manifest
        </p>
        <h2 id="asset-heading" className="mt-1 text-xl font-semibold tracking-[-0.02em]">
          Define the token
        </h2>
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <Field label="Token name" name="name" value={value.name} error={errors.name}
          placeholder="Vault Protocol" disabled={isDisabled} onChange={update} />
        <Field label="Symbol" name="symbol" value={value.symbol} error={errors.symbol}
          placeholder="VLT" disabled={isDisabled} onChange={update} />

        <div className="sm:col-span-2">
          <label htmlFor="rh-description" className="form-label">Description</label>
          <textarea id="rh-description" name="description" value={value.description}
            className="form-input" placeholder="What this token represents and who is building it."
            maxLength={500} disabled={isDisabled} aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? "rh-description-error" : undefined}
            onChange={update} />
          <FieldError id="rh-description-error" message={errors.description} />
          <p className="mt-1 text-right font-mono text-[10px] text-text-4">{value.description.length}/500</p>
        </div>

        <div className="sm:col-span-2">
          <Field label="Logo URI" name="logo" value={value.logo} error={errors.logo}
            placeholder="https://... or ipfs://..." disabled={isDisabled} onChange={update} />
          <p className="mt-1 font-mono text-[10px] text-text-4">Public HTTPS or IPFS URI. The URI is written into launch metadata.</p>
        </div>

        <div className="sm:col-span-2 grid gap-4 border-t border-line-default pt-5 sm:grid-cols-3">
          {SOCIAL_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} name={field.key} value={value[field.key]}
              error={errors[field.key]} placeholder={field.placeholder} disabled={isDisabled} onChange={update} />
          ))}
        </div>

        <div>
          <Field label="Initial buy" name="initialBuyEth" value={value.initialBuyEth}
            error={errors.initialBuyEth} placeholder="0.005" inputMode="decimal" suffix="ETH"
            disabled={isDisabled} onChange={update} />
          <p className="mt-1 font-mono text-[10px] text-text-4">Set 0 to launch without an initial buy.</p>
        </div>
        <div>
          <Field label="Fee and initial-buy recipient" name="feeWallet" value={value.feeWallet}
            error={errors.feeWallet} placeholder="0x..." disabled={isDisabled} onChange={update} />
          <p className="mt-1 font-mono text-[10px] text-text-4">Receives the 70% creator LP-fee share and every token purchased by the initial buy.</p>
        </div>

        <label className="sm:col-span-2 flex cursor-pointer gap-3 rounded-control border border-accent/20 bg-accent-dim p-4">
          <input type="checkbox" checked={value.hasAcceptedPermanentLock} disabled={isDisabled}
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            onChange={(event) => onChange({ ...value, hasAcceptedPermanentLock: event.target.checked })} />
          <span>
            <span className="block text-sm font-semibold text-text-1">I understand the LP position is permanently locked</span>
            <span className="mt-1 block font-mono text-[10px] leading-5 text-text-3">
              The Uniswap v3 position cannot be withdrawn. LP trading fees continue to route 70% to the fee wallet and 30% to the protocol.
            </span>
            <FieldError id="rh-lock-error" message={errors.hasAcceptedPermanentLock} />
          </span>
        </label>
      </div>
    </section>
  );
}

interface FieldProps {
  label: string;
  name: keyof RobinhoodLaunchFormData;
  value: string;
  error?: string;
  placeholder: string;
  disabled: boolean;
  inputMode?: "decimal";
  suffix?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

function Field({ label, name, value, error, placeholder, disabled, inputMode, suffix, onChange }: FieldProps) {
  const id = `rh-${name}`;
  return (
    <div>
      <label htmlFor={id} className="form-label">{label}</label>
      <div className="relative">
        <input id={id} name={name} value={value} type="text" inputMode={inputMode}
          className={`form-input ${suffix ? "pr-14" : ""}`} placeholder={placeholder}
          disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
          onChange={onChange} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-3">{suffix}</span>}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} role="alert" className="mt-1 font-mono text-[10px] text-danger">{message}</p>;
}
