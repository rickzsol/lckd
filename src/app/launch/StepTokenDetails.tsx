"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import type { WizardContext } from "@/hooks/useLaunchWizard";

export default function StepTokenDetails({ w }: { w: WizardContext }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div>
      <h2 className="mb-5 font-mono text-[13px] font-bold text-accent">
        01 / Token details
      </h2>

      <div className="flex flex-col gap-4">
        {/* Image upload */}
        <div>
          <label htmlFor="token-image" className="form-label">
            Token Image *
          </label>
          <input
            id="token-image"
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            aria-describedby={w.errors.image ? "token-image-error token-image-help" : "token-image-help"}
            aria-invalid={Boolean(w.errors.image)}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) w.handleImageUpload(file);
            }}
          />

          {w.imagePreview ?? w.config.imageUri ? (
            <div className="group relative inline-block">
              <Image
                src={w.imagePreview ?? w.config.imageUri!}
                alt="Token preview"
                width={90}
                height={90}
                className="h-[90px] w-[90px] rounded-card border border-line-default object-cover"
                unoptimized
              />
              <button
                type="button"
                onClick={w.removeImage}
                className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger text-xs font-bold text-text-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                aria-label="Remove image"
              >
                X
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose a token image"
              aria-describedby={w.errors.image ? "token-image-error token-image-help" : "token-image-help"}
              className={`upload-box ${isDragging ? "border-accent/50 bg-accent-dim" : ""}`}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) w.handleImageUpload(file);
              }}
            >
              <span className="text-2xl">+</span>
              <span className="font-mono text-[10px] text-text-3">
                {isDragging ? "drop here" : "drag or click"}
              </span>
            </div>
          )}

          {w.errors.image && (
            <div id="token-image-error" role="alert" className="mt-1 font-mono text-[10px] text-danger">
              {w.errors.image}
            </div>
          )}
          <div id="token-image-help" className="mt-1 font-mono text-[10px] text-text-4">
            PNG, JPG, GIF, WebP &middot; max 4MB
          </div>
        </div>

        {/* Name + Ticker */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <div className="flex-[2]">
            <label htmlFor="token-name" className="form-label">
              Name *
            </label>
            <input
              id="token-name"
              placeholder="e.g. NeuralSwap"
              className={`form-input ${w.errors.name ? "form-input-error" : ""}`}
              maxLength={32}
              value={w.config.name}
              aria-invalid={Boolean(w.errors.name)}
              aria-describedby={w.errors.name ? "token-name-error" : undefined}
              onChange={(e) => w.updateConfig("name", e.target.value)}
            />
            {w.errors.name && (
              <div id="token-name-error" role="alert" className="mt-1 font-mono text-[11px] text-danger">
                {w.errors.name}
              </div>
            )}
          </div>
          <div className="flex-1">
            <label htmlFor="token-ticker" className="form-label">
              Ticker *
            </label>
            <input
              id="token-ticker"
              placeholder="$NSWAP"
              className={`form-input uppercase ${w.errors.ticker ? "form-input-error" : ""}`}
              maxLength={10}
              value={w.config.ticker}
              aria-invalid={Boolean(w.errors.ticker)}
              aria-describedby={w.errors.ticker ? "token-ticker-error" : undefined}
              onChange={(e) =>
                w.updateConfig("ticker", e.target.value.toUpperCase())
              }
            />
            {w.errors.ticker && (
              <div id="token-ticker-error" role="alert" className="mt-1 font-mono text-[11px] text-danger">
                {w.errors.ticker}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="token-desc" className="form-label mb-0">
              Description *
            </label>
            <span
              id="token-desc-count"
              className={`font-mono text-[10px] tabular-nums ${w.config.description.length > 500 ? "text-danger" : "text-text-4"}`}
            >
              {w.config.description.length} / 500
            </span>
          </div>
          <textarea
            id="token-desc"
            placeholder="What are you building?"
            rows={3}
            maxLength={500}
            className={`form-input resize-y ${w.errors.description ? "form-input-error" : ""}`}
            value={w.config.description}
            aria-invalid={Boolean(w.errors.description)}
            aria-describedby={w.errors.description ? "token-desc-error" : "token-desc-count"}
            onChange={(e) => w.updateConfig("description", e.target.value)}
          />
          {w.errors.description && (
            <div id="token-desc-error" role="alert" className="mt-1 font-mono text-[11px] text-danger">
              {w.errors.description}
            </div>
          )}
        </div>

        {/* Social links */}
        <div className="flex flex-col gap-2.5">
          <div id="social-links-label" className="form-label mb-0">
            Social Links (optional)
          </div>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <div className="flex-1">
              <label htmlFor="twitter-url" className="sr-only">X profile URL</label>
              <input
                id="twitter-url"
                type="url"
                inputMode="url"
                placeholder="X profile URL"
                className={`form-input ${w.errors.twitterUrl ? "form-input-error" : ""}`}
                value={w.config.twitterUrl ?? ""}
                aria-invalid={Boolean(w.errors.twitterUrl)}
                aria-describedby={w.errors.twitterUrl ? "twitter-url-error" : undefined}
                onChange={(e) =>
                  w.updateConfig("twitterUrl", e.target.value || null)
                }
              />
              {w.errors.twitterUrl && (
                <div id="twitter-url-error" role="alert" className="mt-1 font-mono text-[11px] text-danger">
                  {w.errors.twitterUrl}
                </div>
              )}
            </div>
            <div className="flex-1">
              <label htmlFor="telegram-url" className="sr-only">Telegram URL</label>
              <input
                id="telegram-url"
                type="url"
                inputMode="url"
                placeholder="Telegram URL"
                className={`form-input ${w.errors.telegramUrl ? "form-input-error" : ""}`}
                value={w.config.telegramUrl ?? ""}
                aria-invalid={Boolean(w.errors.telegramUrl)}
                aria-describedby={w.errors.telegramUrl ? "telegram-url-error" : undefined}
                onChange={(e) =>
                  w.updateConfig("telegramUrl", e.target.value || null)
                }
              />
              {w.errors.telegramUrl && (
                <div id="telegram-url-error" role="alert" className="mt-1 font-mono text-[11px] text-danger">
                  {w.errors.telegramUrl}
                </div>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="website-url" className="sr-only">Website URL</label>
            <input
              id="website-url"
              type="url"
              inputMode="url"
              placeholder="Website URL"
              className={`form-input ${w.errors.websiteUrl ? "form-input-error" : ""}`}
              value={w.config.websiteUrl ?? ""}
              aria-invalid={Boolean(w.errors.websiteUrl)}
              aria-describedby={w.errors.websiteUrl ? "website-url-error" : undefined}
              onChange={(e) =>
                w.updateConfig("websiteUrl", e.target.value || null)
              }
            />
            {w.errors.websiteUrl && (
              <div id="website-url-error" role="alert" className="mt-1 font-mono text-[11px] text-danger">
                {w.errors.websiteUrl}
              </div>
            )}
          </div>
        </div>
      </div>

      <button type="button" onClick={w.goNext} className="btn-primary mt-6 w-full py-3">
        continue &rarr;
      </button>
    </div>
  );
}
